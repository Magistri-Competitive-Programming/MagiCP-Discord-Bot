import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { ChannelType, Events, PermissionFlagsBits, PermissionsBitField } from 'discord.js'
import { createBot, InputError } from '../src/discord.js'
import { openStore } from '../src/store.js'
import { createWeb } from '../src/web.js'

const snowflake = n => String(100000000000000000n + BigInt(n))
const guildId = snowflake(1)

const storage = () => mkdtempSync(join(tmpdir(), 'magicp-test-'))

async function eventually(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await delay(20)
  }
  assert.ok(check(), 'Operazione Discord non completata')
}

test('le candidature e una sola decisione sopravvivono al riavvio', t => {
  const directory = storage()
  t.after(() => rmSync(directory, { force: true, recursive: true }))
  const user = snowflake(2)
  const answers = { name: 'Mario Rossi', profile: 'student', schoolClass: '3B', competitions: '', awards: '' }
  const first = openStore(directory, guildId)
  try {
    assert.ok(first.create(user, answers))
    assert.equal(first.create(user, answers), false)
    const { id } = first.current(user)
    first.delivered(id, snowflake(3), snowflake(4))
    assert.ok(first.claim(id, snowflake(5), 'accepted', [snowflake(6)]))
    assert.equal(first.claim(id, snowflake(7), 'rejected', []), false)
  } finally {
    first.close()
  }
  const second = openStore(directory, guildId)
  try {
    assert.equal(second.work()[0].decision, 'accepted')
    assert.deepEqual(JSON.parse(second.work()[0].role_ids), [snowflake(6)])
    assert.throws(() => openStore(directory, snowflake(10)), /altro server/)
  } finally {
    second.close()
  }
})

test('verifica Discord con permessi staff, deduplica e assegnazione dei tre esiti', async t => {
  const directory = storage()
  const store = openStore(directory, guildId)
  const verification = snowflake(11)
  const review = snowflake(12)
  const external = snowflake(13)
  const student = snowflake(14)
  const staff = snowflake(15)
  const competitor = snowflake(16)
  const reviewer = snowflake(17)
  const assignments = []
  const sent = []
  const edited = []
  const deleted = []
  let left = false
  let publicReview = true
  let messageId = 30
  const permissions = bits => new PermissionsBitField(bits)
  const all = permissions(PermissionFlagsBits.Administrator)
  const me = { id: snowflake(18), displayColor: 0x37a59b, permissions: all, roles: { highest: { comparePositionTo: () => 1 } } }
  const roles = new Map([guildId, external, student, staff, competitor].map(id => [id, { id, name: id, permissions: permissions(0n) }]))
  const channel = id => ({
    id,
    name: id === review ? 'richieste-verifica' : 'verifica',
    guildId,
    type: ChannelType.GuildText,
    permissionOverwrites: { cache: new Map([[staff, { id: staff, allow: permissions(PermissionFlagsBits.ViewChannel) }]]) },
    permissionsFor: subject => subject.id === guildId && id === review && !publicReview ? permissions(0n) : all,
    send: async content => {
      const message = { id: snowflake(messageId++), content }
      sent.push(message)
      return message
    },
    messages: {
      edit: async (message, content) => { edited.push({ message, content }); return { id: message } },
      delete: async message => {
        if (deleted.includes(message)) throw Object.assign(new Error('Unknown Message'), { code: 10008 })
        deleted.push(message)
      }
    }
  })
  const channels = new Map([verification, review].map(id => [id, channel(id)]))
  const guild = {
    id: guildId, name: 'MagiCP', available: true,
    iconURL: () => 'https://cdn.discordapp.com/icons/example.png',
    roles: { fetch: async () => roles, cache: roles },
    members: {
      me,
      fetchMe: async () => me,
      fetch: async ({ user }) => ({ roles: { add: async id => assignments.push([user, id]) } })
    },
    channels: { fetch: async id => id ? channels.get(id) : channels }
  }
  const client = new EventEmitter()
  Object.assign(client, {
    user: { id: me.id },
    application: { commands: { create: async () => {} } },
    isReady: () => true,
    guilds: { cache: new Map([[guildId, guild], ['other', { id: 'other', leave: async () => { left = true } }]]) },
    login: async () => client.emit(Events.ClientReady),
    destroy: async () => {}
  })
  const bot = createBot({ guildId }, store, client)
  t.after(async () => {
    await bot.stop()
    store.close()
    rmSync(directory, { force: true, recursive: true })
  })
  await bot.start()
  assert.ok(left)
  const settings = {
    verificationChannel: verification, reviewChannel: review, externalRole: external,
    approvalRoles: [student, competitor], reviewerRoles: [staff]
  }
  await assert.rejects(bot.saveSettings(settings), /Rendi privato/)
  publicReview = false
  await bot.saveSettings(settings)
  const panel = await bot.publish()
  assert.equal((await bot.publish()).message, panel.message)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].content.embeds[0].toJSON().color, me.displayColor)
  const previousColor = me.displayColor
  me.displayColor = 0x634ae4
  client.emit(Events.GuildMemberUpdate, { displayColor: previousColor }, { id: me.id, guild, displayColor: me.displayColor })
  await eventually(() => edited.at(-1)?.content.embeds[0].toJSON().color === me.displayColor)
  assert.equal(edited.at(-1).message, panel.message)
  assert.equal(sent.length, 1)

  const listener = client.listeners(Events.InteractionCreate)[0]
  async function interact({ customId, id, message, channelId, type, roles = [], values, answers, server = guildId }) {
    const interaction = {
      customId, guildId: server, channelId, user: { id }, member: { roles },
      message: { id: message }, memberPermissions: permissions(0n), values, isButton: () => type === 'button',
      isModalSubmit: () => type === 'modal',
      fields: { getTextInputValue: key => answers[key], getStringSelectValues: () => values },
      reply: async response => { interaction.result = response; interaction.replied = true },
      showModal: async modal => { interaction.result = modal.toJSON() },
      deferReply: async () => { interaction.deferred = true },
      editReply: async response => { interaction.result = response; interaction.replied = true }
    }
    await listener(interaction)
    return interaction.result
  }

  const user = snowflake(40)
  const intake = { id: user, channelId: verification, message: panel.message }
  assert.equal(await interact({ ...intake, customId: 'verify:start', type: 'button', server: 'other' }), undefined)
  const form = await interact({ ...intake, customId: 'verify:start', type: 'button' })
  assert.equal(form.custom_id, 'verify:apply')
  assert.deepEqual(form.components.map(label => label.component.custom_id), ['profile', 'name', 'class', 'competitions', 'awards'])
  assert.equal(form.components[0].component.options.length, 4)
  const incomplete = await interact({
    ...intake, customId: form.custom_id, type: 'modal', values: ['student'],
    answers: { name: 'Mario Rossi', class: '', competitions: '', awards: '' }
  })
  assert.match(incomplete.content, /serve la classe/)
  assert.equal(store.current(user), undefined)

  for (const [index, outcome] of ['accepted', 'external', 'rejected'].entries()) {
    const id = snowflake(40 + index)
    const profile = outcome === 'external' ? 'external' : 'student'
    const application = {
      ...intake, id, customId: form.custom_id, type: 'modal', values: [profile],
      answers: { name: 'Mario Rossi', class: profile === 'student' ? '3B' : '', competitions: 'OII', awards: 'Bronzo' }
    }
    await interact(application)
    await eventually(() => store.current(id)?.review_message)
    const request = store.current(id)
    assert.equal(request.profile, profile)
    assert.equal(sent.at(-1).content.embeds[0].toJSON().color, me.displayColor)
    const decision = { id: reviewer, message: request.review_message, channelId: review, roles: [staff], type: 'button' }
    if (outcome === 'accepted') {
      const unauthorized = await interact({ ...decision, roles: [], customId: `review:accept:${request.id}` })
      assert.match(unauthorized.content, /riservata allo staff/)
      const modal = await interact({ ...decision, customId: `review:accept:${request.id}` })
      assert.equal(modal.components[0].component.options.length, 2)
      await Promise.all([1, 2].map(() => interact({
        ...decision, type: 'modal', values: [student, competitor], customId: modal.custom_id
      })))
    } else {
      const action = outcome === 'external' ? 'external' : 'reject'
      await interact({ ...decision, customId: `review:${action}:${request.id}` })
    }
    await eventually(() => store.get(request.id).status === outcome)
  }
  assert.deepEqual(assignments, [[user, student], [user, competitor], [snowflake(41), external]])
  assert.equal(sent.length, 4)
  assert.ok(edited.length)
  const verified = store.current(user)
  await bot.deleteReviewMessage(verified)
  await bot.deleteReviewMessage(verified)
  assert.deepEqual(deleted, [verified.review_message])
})

test('ricerca e rimozione protette delle candidature concluse', async t => {
  const directory = storage()
  const store = openStore(directory, guildId)
  const answers = { name: 'Élia Rossi', profile: 'student', schoolClass: '3B', competitions: 'OII', awards: '' }
  const accepted = snowflake(55)
  const pending = snowflake(56)
  store.create(accepted, answers)
  store.create(pending, { ...answers, name: 'Mario Rossi' })
  const { id } = store.current(accepted)
  store.delivered(id, snowflake(57), snowflake(58))
  store.claim(id, snowflake(59), 'accepted', [snowflake(60)])
  store.finished(id)
  const removedMessages = []
  let discordAvailable = false
  const bot = {
    status: () => ({ ready: discordAvailable }),
    deleteReviewMessage(request) {
      if (!discordAvailable) throw new InputError('Discord scollegato.')
      removedMessages.push(request.review_message)
    }
  }
  const config = { username: 'admin', password: 'temporary-check-only', origin: 'https://panel.example.test', secureCookie: true }
  const server = createWeb(config, store, bot).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    store.close()
    rmSync(directory, { force: true, recursive: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (path, options) => fetch(`${base}/api/${path}`, options)
  assert.equal((await call('overview')).status, 401)
  const credentials = JSON.stringify({ username: config.username, password: config.password })
  const login = headers => call('login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: credentials })
  assert.equal((await login({ Origin: 'https://other.example.test' })).status, 403)
  const response = await login({ Origin: config.origin })
  assert.equal(response.status, 200)
  const issued = response.headers.get('set-cookie')
  assert.match(issued, /^__Host-magicp=.*; HttpOnly; Secure; SameSite=Strict$/)
  const Cookie = issued.split(';')[0]
  const overview = await (await call('overview', { headers: { Cookie } })).json()
  assert.equal(overview.activity.length, 14)
  assert.equal(overview.activity.at(-1).total, 2)
  const { items } = await (await call('applications?status=accepted&query=ELIA', { headers: { Cookie } })).json()
  assert.deepEqual(items.map(item => [item.id, item.canDelete]), [[id, true]])
  assert.equal((await call('publish', { method: 'POST', headers: { Cookie } })).status, 403)
  const remove = (requestId, headers) => call(`applications/${requestId}`, { method: 'DELETE', headers })
  assert.equal((await remove(id, { Origin: config.origin })).status, 401)
  assert.equal((await remove(id, { Cookie })).status, 403)
  const authenticated = { Cookie, Origin: config.origin }
  assert.equal((await remove(store.current(pending).id, authenticated)).status, 409)
  assert.equal((await remove(id, authenticated)).status, 400)
  assert.equal(store.get(id).name, answers.name)
  discordAvailable = true
  assert.equal((await remove(id, authenticated)).status, 204)
  assert.equal((await remove(id, authenticated)).status, 204)
  assert.deepEqual(removedMessages, [snowflake(58)])
  assert.equal(store.get(id), undefined)
  assert.deepEqual({ ...store.current(accepted) }, { status: 'accepted' })
  assert.equal(store.create(accepted, answers), false)
  assert.equal(store.applications({ status: '', query: '', page: 1 }).total, 1)
  assert.equal((await call('logout', { method: 'POST', headers: { Cookie, Origin: config.origin } })).status, 204)
  assert.equal((await call('overview', { headers: { Cookie } })).status, 401)
})
