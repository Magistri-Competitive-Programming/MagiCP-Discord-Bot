import { readConfig } from './config.js'
import { createBot, logError } from './discord.js'
import { openStore } from './store.js'
import { createWeb } from './web.js'

try {
  const config = readConfig()
  const store = openStore(config.dataDir, config.guildId)
  const bot = createBot(config, store)
  const server = createWeb(config, store, bot).listen(3000, process.env.HOST || '127.0.0.1', () => {
    console.log('Pannello MagiCP in ascolto sulla porta 3000.')
  })
  let stopping = false

  async function stop() {
    if (stopping) return
    stopping = true
    const closed = new Promise(resolve => server.close(resolve))
    await Promise.allSettled([closed, bot.stop()])
    store.close()
  }

  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  server.on('error', error => {
    logError('Avvio del pannello', error)
    process.exitCode = 1
    void stop()
  })
  bot.start().catch(error => logError('Accesso a Discord', error))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
