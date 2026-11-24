import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from 'discord.js'
import { getProfile, profileUrl, randomTask, taskUrl } from './training.js'
import { noMentions } from './verification-ui.js'

const usernameOption = (option, required = false) => option.setName('username')
  .setDescription(required ? 'Il tuo username esatto su Training Olinfo' : 'Username su Training Olinfo (altrimenti usa quello associato)')
  .setMaxLength(100).setRequired(required)

export const trainingCommands = [
  new SlashCommandBuilder().setName('stats').setDescription('Mostra le statistiche di un utente di Training Olinfo')
    .addStringOption(option => usernameOption(option)),
  new SlashCommandBuilder().setName('problem').setDescription('Estrae un problema da Training Olinfo')
    .addIntegerOption(option => option.setName('difficolta').setDescription('Difficoltà su Training, da 1 a 10')
      .setMinValue(1).setMaxValue(10).setRequired(true))
    .addStringOption(option => usernameOption(option)),
  new SlashCommandBuilder().setName('link').setDescription('Associa il tuo profilo Training Olinfo al bot')
    .addStringOption(option => usernameOption(option, true))
]

const colors = [0x34a76b, 0x75a53a, 0xc58d14, 0xd66e26, 0xd44c5e]
const number = new Intl.NumberFormat('it-IT')
const clean = value => escapeMarkdown(value).replaceAll('@', '@\u200b')

function message(title, { description, color = 0x37a59b, fields = [], button } = {}) {
  const embed = new EmbedBuilder().setAuthor({ name: 'MagiCP · Training Olinfo' }).setTitle(title).setColor(color)
  if (description) embed.setDescription(description)
  if (fields.length) embed.addFields(fields)
  const components = button ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(button.label).setURL(button.url)
  )] : []
  return { embeds: [embed], components, allowedMentions: noMentions }
}

const notice = (title, description) => message(title, { description, color: 0xc58d14 })

export async function handleTrainingCommand(interaction, store, logError) {
  const { commandName, options, user } = interaction
  if (!trainingCommands.some(command => command.name === commandName)) return

  const supplied = options.getString('username')
  const username = supplied === null ? store.trainingUsername(user.id) : supplied.trim()
  const privateReply = response => interaction.reply({ ...response, flags: MessageFlags.Ephemeral })
  if (supplied !== null && (!username || /[\s/\\\p{C}]/u.test(username) || ['.', '..'].includes(username))) {
    return privateReply(notice('Username non valido', 'Inserisci lo username esatto che usi su Training Olinfo.'))
  }
  if (commandName === 'stats' && !username) {
    return privateReply(notice('Quale profilo vuoi vedere?', 'Indica uno `username` in `/stats` oppure associa il tuo profilo con `/link`.'))
  }

  await interaction.deferReply(commandName === 'link' ? { flags: MessageFlags.Ephemeral } : {})
  let profile
  let task
  const difficulty = commandName === 'problem' ? options.getInteger('difficolta', true) : null
  try {
    if (username) profile = await getProfile(username)
    if (commandName === 'problem' && (!username || profile)) task = await randomTask(difficulty, profile?.solved)
  } catch (error) {
    logError('Lettura dati di Training Olinfo', error)
    return interaction.editReply(notice('Training Olinfo non disponibile', 'Riprova tra poco.'))
  }

  if (username && !profile) {
    return interaction.editReply(notice('Profilo non trovato', 'Controlla lo username su Training Olinfo, comprese maiuscole e minuscole.'))
  }
  const openProfile = profile && { label: 'Apri il profilo', url: profileUrl(profile.username) }

  switch (commandName) {
    case 'link':
      store.linkTraining(user.id, profile.username)
      return interaction.editReply(message('Profilo associato', {
        description: `Da ora \`/stats\` e \`/problem\` useranno **${clean(profile.username)}** quando ometti lo username.`,
        button: openProfile
      }))
    case 'stats':
      return interaction.editReply(message(`Statistiche di ${clean(profile.username)}`, {
        fields: profile.stats.map(([name, value]) => ({
          name, value: /^\d+$/.test(value) ? number.format(Number(value)) : value, inline: true
        })),
        button: openProfile
      }))
    case 'problem':
      if (!task) {
        return interaction.editReply(notice('Nessun problema disponibile', profile
          ? `Non ci sono problemi di difficoltà **${difficulty}/10** ancora da completare per **${clean(profile.username)}**.`
          : `Non ci sono problemi di difficoltà **${difficulty}/10** nell’archivio.`))
      }
      return interaction.editReply(message(clean(task.title).slice(0, 256), {
        description: profile ? `Da completare per **${clean(profile.username)}**` : undefined,
        color: colors[Math.floor((task.difficulty - 1) / 2)],
        fields: [
          { name: 'Difficoltà', value: `**${task.difficulty}/10**  ${'▰'.repeat(task.difficulty)}${'▱'.repeat(10 - task.difficulty)}`, inline: true },
          { name: 'Codice problema', value: `\`${clean(task.slug)}\``, inline: true }
        ],
        button: { label: 'Apri il problema', url: taskUrl(task.slug) }
      }))
  }
}
