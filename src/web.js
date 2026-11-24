import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { InputError, logError } from './discord.js'
import { profiles, statusLabels } from './verification-ui.js'

const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const lifetime = 8 * 60 * 60 * 1000

export function createWeb(config, store, bot) {
  const app = express()
  const auth = express.Router()
  const cookie = { httpOnly: true, sameSite: 'strict', secure: config.secureCookie, path: '/' }
  const cookieName = config.secureCookie ? '__Host-magicp' : 'magicp'
  const sessions = new Map()
  const key = randomBytes(32)
  const digest = value => createHmac('sha256', key).update(value).digest()
  const expectedUsername = digest(config.username)
  const expectedPassword = digest(config.password)
  const sessionToken = req => req.headers.cookie?.split(';').map(entry => entry.trim())
    .find(entry => entry.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)

  app.disable('x-powered-by')
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY'
    })
    next()
  })
  app.get('/health', (req, res) => res.type('text').send('ok'))

  auth.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (req.method === 'POST' && req.get('Origin') !== config.origin) {
      return res.status(403).json({ error: 'Apri il pannello dal suo indirizzo configurato.' })
    }
    next()
  })
  auth.use(express.json({ limit: '8kb' }))
  auth.get('/session', (req, res) => {
    res.json({ authenticated: (sessions.get(sessionToken(req)) ?? 0) > Date.now() })
  })
  auth.post('/login', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Troppi tentativi. Riprova tra 15 minuti.' }
  }), (req, res) => {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 100 || password.length > 512) {
      return res.status(401).json({ error: 'Nome utente o password errati.' })
    }
    const usernameMatches = timingSafeEqual(digest(username.trim()), expectedUsername)
    const passwordMatches = timingSafeEqual(digest(password), expectedPassword)
    if (!usernameMatches || !passwordMatches) {
      return res.status(401).json({ error: 'Nome utente o password errati.' })
    }
    const now = Date.now()
    sessions.delete(sessionToken(req))
    for (const [id, expires] of sessions) {
      if (expires <= now) sessions.delete(id)
    }
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value)
    const id = randomBytes(32).toString('base64url')
    sessions.set(id, now + lifetime)
    res.cookie(cookieName, id, { ...cookie, maxAge: lifetime }).json({ authenticated: true })
  })

  auth.use((req, res, next) => {
    if ((sessions.get(sessionToken(req)) ?? 0) <= Date.now()) {
      return res.status(401).json({ error: 'Accedi al pannello.' })
    }
    next()
  })
  auth.post('/logout', (req, res) => {
    sessions.delete(sessionToken(req))
    res.clearCookie(cookieName, cookie).status(204).end()
  })
  auth.get('/overview', (req, res) => {
    const overview = store.overview()
    res.json({
      ...overview,
      recent: overview.recent.map(({ name, profile, status, created_at, review_channel, review_message, work_error }) => ({
        name,
        profile: profiles[profile],
        status,
        label: statusLabels[status],
        createdAt: created_at,
        error: work_error,
        url: review_message ? `https://discord.com/channels/${config.guildId}/${review_channel}/${review_message}` : null
      })),
      settings: store.settings(),
      panel: store.panel(),
      bot: bot.status(),
      guildId: config.guildId
    })
  })
  auth.get('/options', async (req, res) => res.json(await bot.options()))
  auth.post('/settings', async (req, res) => {
    if (!req.body || typeof req.body !== 'object') throw new InputError('Configurazione mancante.')
    res.json(await bot.saveSettings(req.body))
  })
  auth.post('/publish', async (req, res) => res.json(await bot.publish()))
  app.use('/api', auth)
  app.use(express.static(publicDir, { dotfiles: 'ignore' }))
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof InputError) return res.status(400).json({ error: error.message })
    if (error.status === 400 || error.status === 413) {
      return res.status(error.status).json({ error: 'Richiesta non valida.' })
    }
    logError('Pannello web', error)
    res.status(500).json({ error: 'Operazione non completata. Riprova tra poco.' })
  })
  return app
}
