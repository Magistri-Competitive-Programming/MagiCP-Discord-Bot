import { resolve } from 'node:path'

export const isSnowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value)

export function readConfig(env = process.env) {
  const required = key => {
    if (!env[key]?.trim()) throw new Error(`Variabile mancante: ${key}`)
    return env[key]
  }

  const token = required('DISCORD_TOKEN').trim()
  const guildId = required('DISCORD_GUILD_ID').trim()
  const username = required('ADMIN_USERNAME').trim()
  const password = required('ADMIN_PASSWORD')
  let origin
  try {
    origin = new URL(required('PANEL_ORIGIN'))
    if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== `${origin.origin}/`) {
      throw new Error()
    }
  } catch {
    throw new Error('PANEL_ORIGIN deve essere un indirizzo HTTP o HTTPS senza percorso.')
  }

  if (!isSnowflake(guildId)) throw new Error('DISCORD_GUILD_ID non valido.')
  if (username.length > 100 || password.length < 12 || password.length > 512) {
    throw new Error('Usa un nome utente fino a 100 caratteri e una password da 12 a 512 caratteri.')
  }

  return {
    token,
    guildId,
    username,
    password,
    origin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    dataDir: resolve(env.DATA_DIR || 'data')
  }
}
