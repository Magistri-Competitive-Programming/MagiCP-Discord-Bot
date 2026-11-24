import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js'
import { isSnowflake } from './config.js'
import { handleTrainingCommand, trainingCommands } from './training-commands.js'
import {
  applicationModal, noMentions, profiles, requiresClass, reviewPost, roleModal,
  statusLabels, verificationPost
} from './verification-ui.js'

const P = PermissionFlagsBits
const staffPermissions = [
  P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.ManageWebhooks,
  P.ManageMessages, P.ManageThreads, P.KickMembers, P.BanMembers, P.ModerateMembers, P.ViewAuditLog
]
const messagePermissions = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]
const appearance = ({ current, me }) => ({ color: me.displayColor, icon: current.iconURL({ size: 128 }) })

export class InputError extends Error {}

export function logError(context, error) {
  console.error(context, error?.code ?? error?.name ?? 'Errore')
}

function validateIds(values) {
  if (!Array.isArray(values) || values.length > 25 || !values.every(isSnowflake) ||
      new Set(values).size !== values.length) {
    throw new InputError('Seleziona al massimo 25 ruoli distinti.')
  }
  return values
}

export function createBot({ guildId, token }, store, client = new Client({
  intents: [GatewayIntentBits.Guilds], allowedMentions: noMentions,
  presence: { activities: [{ type: ActivityType.Playing, name: 'Risolvere problemi' }] }
})) {
  let work
  let timer
  let publishing = false
  let stopping = false

  function guild() {
    const current = client.isReady() && client.guilds.cache.get(guildId)
    if (!current?.available) throw new InputError('Il bot non è collegato al server Discord configurato.')
    return current
  }

  async function serverState() {
    const current = guild()
    const [roles, me] = await Promise.all([current.roles.fetch(), current.members.fetchMe({ force: true })])
    return { current, roles, me }
  }

  function canAssign(state, role) {
    return role && state.me.permissions.has(P.ManageRoles) && role.id !== guildId && !role.managed &&
      state.me.roles.highest.comparePositionTo(role) > 0 && !role.permissions.any(staffPermissions)
  }

  function checkChannel(channel, state, reviewers = null) {
    if (channel?.type !== ChannelType.GuildText || channel.guildId !== guildId) {
      throw new InputError('Scegli un canale di testo del server MagiCP.')
    }
    if (!channel.permissionsFor(state.me).has(messagePermissions)) {
      throw new InputError(`Il bot deve poter leggere la cronologia e inviare messaggi con embed in #${channel.name}.`)
    }
    if (reviewers === null) return channel

    if (channel.permissionsFor(state.roles.get(guildId)).has(P.ViewChannel)) {
      throw new InputError(`Rendi privato #${channel.name} disabilitando la visualizzazione per @everyone.`)
    }
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (!overwrite.allow.has(P.ViewChannel)) continue
      const role = state.roles.get(overwrite.id)
      const trusted = reviewers.includes(overwrite.id) || role?.tags?.botId === state.me.id ||
        role?.permissions.has(P.Administrator) || [state.me.id, state.current.ownerId].includes(overwrite.id)
      if (!trusted) throw new InputError(`Consenti l’accesso a #${channel.name} solo ai ruoli revisori e al bot.`)
    }
    return channel
  }

  function isReviewer(interaction) {
    const memberRoles = interaction.member.roles
    const hasRole = id => Array.isArray(memberRoles) ? memberRoles.includes(id) : memberRoles.cache.has(id)
    return interaction.memberPermissions.has(P.Administrator) || store.settings().reviewerRoles.some(hasRole)
  }

  async function options() {
    const state = await serverState()
    const channels = await state.current.channels.fetch()
    return {
      channels: [...channels.values()].filter(channel => channel?.type === ChannelType.GuildText)
        .map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'it')),
      roles: [...state.roles.values()].filter(role => role.id !== guildId && !role.managed)
        .sort((a, b) => b.comparePositionTo(a))
        .map(role => ({ id: role.id, name: role.name, assignable: canAssign(state, role) }))
    }
  }

  async function saveSettings(input) {
    const { verificationChannel, reviewChannel, externalRole } = input
    if (![verificationChannel, reviewChannel, externalRole].every(isSnowflake) ||
        verificationChannel === reviewChannel) {
      throw new InputError('Seleziona due canali distinti e un ruolo esterno.')
    }
    const approvalRoles = validateIds(input.approvalRoles)
    const reviewerRoles = validateIds(input.reviewerRoles)
    if (!approvalRoles.length || approvalRoles.includes(externalRole) ||
        reviewerRoles.some(id => approvalRoles.includes(id) || id === externalRole || id === guildId)) {
      throw new InputError('Scegli almeno un ruolo di approvazione e tieni distinti i ruoli da assegnare e da revisore.')
    }

    const state = await serverState()
    const [verification, review] = await Promise.all([
      state.current.channels.fetch(verificationChannel, { force: true }),
      state.current.channels.fetch(reviewChannel, { force: true })
    ])
    checkChannel(verification, state)
    checkChannel(review, state, reviewerRoles)
    if ([...approvalRoles, externalRole].some(id => !canAssign(state, state.roles.get(id)))) {
      throw new InputError('Il bot può assegnare solo ruoli senza privilegi di staff e sotto il proprio ruolo.')
    }
    if (reviewerRoles.some(id => {
      const role = state.roles.get(id)
      return !role || role.managed || !review.permissionsFor(role).has(P.ViewChannel)
    })) {
      throw new InputError('Ogni ruolo revisore deve poter vedere il canale delle richieste.')
    }
    store.saveSettings({ verificationChannel, reviewChannel, externalRole, approvalRoles, reviewerRoles })
    return store.settings()
  }

  async function publish({ existingOnly = false } = {}) {
    const { verificationChannel } = store.settings()
    const previous = store.panel()
    if (existingOnly && (publishing || !previous || previous.channel !== verificationChannel)) return
    if (publishing) throw new InputError('Pubblicazione già in corso.')
    if (!verificationChannel) throw new InputError('Salva i canali e i ruoli prima di pubblicare.')
    publishing = true
    try {
      const state = await serverState()
      const channel = checkChannel(await state.current.channels.fetch(verificationChannel, { force: true }), state)
      const content = verificationPost(appearance(state))
      let message
      if (previous?.channel === channel.id) {
        message = await channel.messages.edit(previous.message, content).catch(error => {
          if (error.code !== 10008) throw error
        })
      }
      if (existingOnly && !message) return
      message ??= await channel.send(content)
      const panel = { channel: channel.id, message: message.id }
      store.savePanel(panel)
      if (previous && previous.channel !== panel.channel) {
        try {
          const oldChannel = await state.current.channels.fetch(previous.channel)
          await oldChannel?.messages?.edit(previous.message, { components: [] })
        } catch (error) {
          logError('Aggiornamento del vecchio messaggio di verifica', error)
        }
      }
      return panel
    } finally {
      publishing = false
    }
  }

  async function processRequest(request) {
    if (request.status === 'processing') {
      if (request.decision !== 'rejected') {
        const state = await serverState()
        const roles = JSON.parse(request.role_ids)
        if (roles.some(id => !canAssign(state, state.roles.get(id)))) {
          throw new InputError('Ripristina i ruoli scelti e la gerarchia Discord per completare la decisione.')
        }
        const member = await state.current.members.fetch({ user: request.user_id, force: true })
        for (const id of roles) {
          await member.roles.add(id, 'Verifica MagiCP')
        }
      }
      store.finished(request.id)
      return
    }

    const state = await serverState()
    const settings = store.settings()
    const destination = request.review_channel ?? settings.reviewChannel
    if (!destination) throw new InputError('Configura il canale delle richieste.')
    if (request.needs_sync) {
      try {
        const channel = await state.current.channels.fetch(destination, { force: true })
        if (channel) {
          const privateChannel = checkChannel(channel, state, settings.reviewerRoles)
          await privateChannel.messages.edit(request.review_message, reviewPost(request, appearance(state)))
        }
      } catch (error) {
        if (![10003, 10008].includes(error.code)) throw error
      }
      store.synced(request.id)
      return
    }

    const channel = checkChannel(
      await state.current.channels.fetch(destination, { force: true }), state, settings.reviewerRoles
    )
    const message = await channel.send({ ...reviewPost(request, appearance(state)), nonce: request.id, enforceNonce: true })
    store.delivered(request.id, channel.id, message.id)
  }

  async function deleteReviewMessage(request) {
    if (!request.review_message) return
    const current = guild()
    try {
      const channel = await current.channels.fetch(request.review_channel, { force: true })
      if (channel?.guildId === guildId && channel.type === ChannelType.GuildText) {
        await channel.messages.delete(request.review_message)
      } else {
        throw new InputError('Il canale Discord della candidatura non è accessibile.')
      }
    } catch (error) {
      if ([10003, 10008].includes(error.code)) return
      if ([50001, 50013].includes(error.code)) {
        throw new InputError('Il bot deve poter accedere al messaggio Discord per eliminare la candidatura.')
      }
      throw error
    }
  }

  function runWork() {
    if (work || stopping || !client.isReady()) return
    work = (async () => {
      for (const request of store.work()) {
        if (stopping) break
        try {
          await processRequest(request)
        } catch (error) {
          const detail = error instanceof InputError ? error.message : ({
            10003: 'Il canale Discord è stato eliminato.',
            10007: 'Il candidato non è più nel server.',
            50001: 'Il bot non ha accesso al canale.',
            50013: 'Controlla i permessi del bot e la gerarchia dei ruoli.'
          })[error.code] ?? 'Discord non ha completato l’operazione. Il bot riproverà.'
          store.failed(request.id, detail)
          logError('Elaborazione richiesta Discord', error)
        }
      }
    })().catch(error => logError('Coda verifiche', error)).finally(() => { work = undefined })
  }

  const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral })
  async function intake(interaction, action, previousProfile) {
    const panel = store.panel()
    if (!panel || panel.channel !== interaction.channelId || panel.channel !== store.settings().verificationChannel ||
        (!previousProfile && interaction.message?.id !== panel.message)) {
      return reply(interaction, 'Usa il messaggio di verifica attuale.')
    }
    const application = store.current(interaction.user.id)
    if (application) return reply(interaction, `Hai già una richiesta. Stato: ${statusLabels[application.status]}.`)

    if (action === 'start' && interaction.isButton()) {
      return interaction.showModal(applicationModal())
    }
    if (action !== 'apply' || !interaction.isModalSubmit()) return
    // Modals opened before a redeploy can still carry their profile in the custom ID.
    const profile = previousProfile ?? interaction.fields.getStringSelectValues('profile')[0]
    if (!Object.hasOwn(profiles, profile)) return reply(interaction, 'Seleziona un profilo nel modulo di verifica.')

    const read = key => interaction.fields.getTextInputValue(key).trim()
    const name = read('name')
    const schoolClass = requiresClass(profile) ? read('class') : ''
    const competitions = read('competitions')
    const awards = read('awards')
    if (requiresClass(profile) && !schoolClass) {
      return reply(interaction, 'Per questo profilo serve la classe. Premi Verifica e inseriscila nel modulo.')
    }
    if (!name || name.length > 100 || schoolClass.length > 24 || competitions.length > 850 || awards.length > 500) {
      return reply(interaction, 'Controlla i campi del modulo e riprova dal pulsante Verifica.')
    }
    const created = store.create(interaction.user.id, { name, profile, schoolClass, competitions, awards })
    await reply(interaction, created
      ? '**Richiesta inviata.** Lo staff la valuterà e ti assegnerà i ruoli approvati sul server.'
      : 'Hai già una richiesta.')
    runWork()
  }

  async function review(interaction, action, id) {
    const request = store.get(id ?? '')
    if (!isReviewer(interaction) || !request?.review_message ||
        request.review_channel !== interaction.channelId || request.review_message !== interaction.message?.id) {
      return reply(interaction, 'Questa azione è riservata allo staff nel canale delle richieste.')
    }
    if (request.status !== 'pending') return reply(interaction, `Stato della richiesta: ${statusLabels[request.status]}.`)
    const settings = store.settings()
    if (action === 'accept' && interaction.isButton()) {
      const current = guild()
      const state = { me: current.members.me, roles: current.roles.cache }
      const roles = settings.approvalRoles.map(id => state.roles.get(id)).filter(role => state.me && canAssign(state, role))
      if (!roles.length) return reply(interaction, 'Nessun ruolo di approvazione disponibile. Controlla il pannello.')
      return interaction.showModal(roleModal(id, roles))
    }

    const outcomes = { reject: 'rejected', external: 'external', roles: 'accepted' }
    if (!Object.hasOwn(outcomes, action) || (action === 'roles' ? !interaction.isModalSubmit() : !interaction.isButton())) return
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    const roles = action === 'roles' ? validateIds(interaction.fields.getStringSelectValues('roles')) :
      action === 'external' ? [settings.externalRole] : []
    if (action === 'roles' && (!roles.length || roles.some(id => !settings.approvalRoles.includes(id)))) {
      throw new InputError('I ruoli configurati sono cambiati. Apri di nuovo la richiesta.')
    }
    if (roles.length) {
      const state = await serverState()
      if (roles.some(id => !canAssign(state, state.roles.get(id)))) {
        throw new InputError('Controlla i ruoli configurati e la gerarchia Discord.')
      }
      try {
        await state.current.members.fetch({ user: request.user_id, force: true })
      } catch (error) {
        if (error.code === 10007) throw new InputError('Il candidato non è più nel server.')
        throw error
      }
    }
    const claimed = store.claim(id, interaction.user.id, outcomes[action], roles)
    await interaction.editReply(claimed ? 'Decisione registrata.' : 'Un revisore ha già deciso su questa richiesta.')
    runWork()
  }

  async function leaveOtherGuild(server) {
    if (server.id === guildId) return
    await server.leave().catch(error => logError('Uscita da un server non autorizzato', error))
  }

  function refreshPanel() {
    if (stopping) return
    void publish({ existingOnly: true }).catch(error => logError('Aggiornamento del messaggio di verifica', error))
  }

  client.on(Events.ClientReady, () => {
    for (const server of client.guilds.cache.values()) void leaveOtherGuild(server)
    for (const command of trainingCommands) {
      void client.application.commands.create(command, guildId)
        .catch(error => logError(`Registrazione di /${command.name}`, error))
    }
    timer ??= setInterval(runWork, 5_000)
    runWork()
    refreshPanel()
  })
  client.on(Events.GuildCreate, leaveOtherGuild)
  client.on(Events.GuildRoleUpdate, (before, role) => {
    if (role.guild.id === guildId && role.guild.members.me?.roles.cache.has(role.id) &&
        (before.color !== role.color || before.rawPosition !== role.rawPosition)) refreshPanel()
  })
  client.on(Events.GuildRoleDelete, role => {
    if (role.guild.id === guildId && role.color) refreshPanel()
  })
  client.on(Events.GuildMemberUpdate, (before, member) => {
    if (member.guild.id === guildId && member.id === client.user.id && before.displayColor !== member.displayColor) {
      refreshPanel()
    }
  })
  client.on(Events.Error, error => logError('Connessione Discord', error))
  client.on(Events.InteractionCreate, async interaction => {
    if (stopping || interaction.guildId !== guildId || !interaction.member) return
    try {
      if (interaction.isChatInputCommand?.()) return await handleTrainingCommand(interaction, store, logError)
      if (!interaction.customId) return
      const [kind, action, id] = interaction.customId.split(':')
      if (kind === 'verify') await intake(interaction, action, id)
      if (kind === 'review') await review(interaction, action, id)
    } catch (error) {
      if (!(error instanceof InputError)) logError('Interazione Discord', error)
      const message = error instanceof InputError ? error.message : 'Operazione non completata. Riprova tra poco.'
      if (!interaction.replied) {
        const report = interaction.deferred ? interaction.editReply(message) : reply(interaction, message)
        await report.catch(reportError => logError('Risposta Discord', reportError))
      }
    }
  })

  return {
    start: () => client.login(token),
    status: () => ({
      ready: Boolean(client.isReady() && client.guilds.cache.get(guildId)?.available),
      guildName: client.guilds.cache.get(guildId)?.name ?? null
    }),
    options,
    saveSettings,
    publish,
    deleteReviewMessage,
    async stop() {
      stopping = true
      clearInterval(timer)
      await client.destroy()
      await work
    }
  }
}
