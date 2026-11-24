import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Events, MessageFlags } from 'discord.js'
import { createBot } from '../src/discord.js'
import { openStore } from '../src/store.js'

function profile(username, scores) {
  const solved = scores.filter(([, complete]) => complete).length
  const stats = [['Punti', 12345], ['Problemi risolti', solved], ['Sottoposizioni', 42], ['Tempo di esecuzione', '12.5s']]
  return `<meta property="profile:username" content="${username}">
    ${stats.map(([label, value]) => `<div class="stat"><div class="stat-title">${label}</div><div class="stat-value">${value}</div></div>`).join('')}
    <div><h2>Problemi risolti</h2><div>${scores.map(([slug, complete]) =>
      `<a href="${slug}" class="${complete ? 'bg-green-400' : 'bg-lime-400'}">Titolo <span>(100)</span></a>`
    ).join('')}</div></div>`
}

function task(slug, title, difficulty) {
  const filled = '<div class="mask-star-2"></div>'.repeat(difficulty)
  const empty = '<div class="mask-star-2 forced-colors:bg-transparent"></div>'.repeat(10 - difficulty)
  return `<li><a href="/task/${slug}"><div>${filled}${empty}</div>${title}</a></li>`
}

test('gli slash command usano il profilo associato e filtrano solo i problemi completati', async t => {
  const guildId = '100000000000000001'
  const userId = '100000000000000002'
  const directory = mkdtempSync(join(tmpdir(), 'magicp-training-'))
  const store = openStore(directory, guildId)
  const client = new EventEmitter()
  const registered = []
  Object.assign(client, {
    application: { commands: { create: async (command, server) => registered.push([command.toJSON(), server]) } },
    isReady: () => true,
    guilds: { cache: new Map([[guildId, { id: guildId, available: true }]]) },
    login: async () => client.emit(Events.ClientReady),
    destroy: async () => {}
  })
  const bot = createBot({ guildId }, store, client)
  t.after(async () => {
    await bot.stop()
    store.close()
    rmSync(directory, { recursive: true, force: true })
  })

  const fetched = []
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input)
    assert.equal(url.origin, 'https://training.olinfo.it')
    fetched.push(url.pathname)
    if (url.pathname === '/user/studentessa') return new Response(profile('studentessa', [
      ['/task/completato', true], ['/task/parziale', false], ['/task/terry/parziale', true]
    ]))
    if (url.pathname === '/user/altro') return new Response(profile('altro', [
      ['/task/completato', true], ['/task/parziale', true]
    ]))
    if (url.pathname === '/tasks/1' || url.pathname === '/tasks/2') {
      assert.equal(url.searchParams.get('minDiff'), '4')
      assert.ok(Number(url.searchParams.get('maxDiff')) > 5)
      return url.pathname === '/tasks/1'
        ? new Response(`<ul class="menu">${task('completato', 'Completato', 5)}${task('livello-diverso', 'Altra difficoltà', 4)}</ul>
          <a class="join-item" href="/tasks/2?minDiff=4">2</a>`)
        : new Response(`<ul class="menu">${task('parziale', 'A &amp; B', 5)}</ul>`)
    }
    return new Response(null, { status: 404 })
  })

  await bot.start()
  assert.deepEqual(registered.map(([command, server]) => [command.name, server]),
    [['stats', guildId], ['problem', guildId], ['link', guildId]])
  const difficultyOption = registered[1][0].options[0]
  assert.deepEqual([difficultyOption.required, difficultyOption.min_value, difficultyOption.max_value], [true, 1, 10])

  const listener = client.listeners(Events.InteractionCreate)[0]
  async function invoke(commandName, username = null, server = guildId) {
    const interaction = {
      guildId: server, user: { id: userId }, member: {}, commandName, isChatInputCommand: () => true,
      options: { getString: () => username, getInteger: () => 5 },
      reply: async response => { interaction.response = response; interaction.replied = true },
      deferReply: async options => { interaction.optionsUsed = options; interaction.deferred = true },
      editReply: async response => { interaction.response = response; interaction.replied = true }
    }
    await listener(interaction)
    return {
      embed: interaction.response?.embeds?.[0].toJSON(),
      button: interaction.response?.components?.[0]?.toJSON().components[0],
      flags: interaction.response?.flags ?? interaction.optionsUsed?.flags
    }
  }

  assert.equal((await invoke('link', 'studentessa', 'other')).embed, undefined)
  assert.equal((await invoke('stats')).flags, MessageFlags.Ephemeral)
  assert.deepEqual(fetched, [])
  const unfiltered = await invoke('problem')
  assert.ok(['Completato', 'A & B'].includes(unfiltered.embed.title))
  assert.ok(fetched.every(path => path.startsWith('/tasks/')))
  assert.equal((await invoke('stats', 'altro')).embed.title, 'Statistiche di altro')
  const linked = await invoke('link', 'studentessa')
  assert.equal(linked.flags, MessageFlags.Ephemeral)
  assert.equal(linked.embed.title, 'Profilo associato')
  assert.equal((await invoke('link', 'inesistente')).embed.title, 'Profilo non trovato')
  const reopened = openStore(directory, guildId)
  try {
    assert.equal(reopened.trainingUsername(userId), 'studentessa')
    assert.equal(reopened.current(userId), undefined)
  } finally {
    reopened.close()
  }

  const stats = await invoke('stats')
  assert.equal(stats.button.url, 'https://training.olinfo.it/user/studentessa')
  assert.deepEqual(stats.embed.fields.map(field => field.value), ['12.345', '2', '42', '12.5s'])
  const problem = await invoke('problem')
  assert.equal(problem.embed.title, 'A & B')
  assert.equal(problem.button.url, 'https://training.olinfo.it/task/parziale')
  assert.equal((await invoke('problem', 'altro')).embed.title, 'Nessun problema disponibile')
  assert.equal((await invoke('problem', 'inesistente')).embed.title, 'Profilo non trovato')
  assert.equal((await invoke('link', 'altro')).embed.title, 'Profilo associato')
  assert.equal((await invoke('stats')).embed.title, 'Statistiche di altro')
})
