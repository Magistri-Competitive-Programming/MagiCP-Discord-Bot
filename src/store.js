import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const defaults = {
  verificationChannel: '',
  reviewChannel: '',
  externalRole: '',
  approvalRoles: [],
  reviewerRoles: []
}
const dayLength = 86_400_000
const localDay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
})
const searchKey = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
const listColumns = 'id, name, profile, status, created_at, review_channel, review_message, work_error'
export const closedStatuses = ['accepted', 'external', 'rejected']

export function openStore(directory, guildId) {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'magicp.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS verified_accounts (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'external'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS training_accounts (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      profile TEXT NOT NULL,
      school_class TEXT NOT NULL,
      competitions TEXT NOT NULL,
      awards TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      review_channel TEXT,
      review_message TEXT,
      reviewer TEXT,
      decision TEXT,
      role_ids TEXT,
      needs_sync INTEGER NOT NULL DEFAULT 0,
      retry_at INTEGER NOT NULL DEFAULT 0,
      work_error TEXT
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_current_application ON applications (user_id)
      WHERE status <> 'rejected';
    CREATE INDEX IF NOT EXISTS applications_recent ON applications (created_at DESC);
  `)
  db.function('search_key', { deterministic: true }, searchKey)
  db.function('local_day', { deterministic: true }, timestamp => localDay.format(timestamp))

  const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
  const writeSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `)
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('guild', guildId)
  if (readSetting.get('guild').value !== guildId) {
    db.close()
    throw new Error('Il volume SQLite appartiene a un altro server Discord.')
  }

  const get = db.prepare('SELECT * FROM applications WHERE id = ?')
  const current = db.prepare("SELECT * FROM applications WHERE user_id = ? AND status <> 'rejected'")
  const verified = db.prepare('SELECT status FROM verified_accounts WHERE user_id = ?')
  const trainingAccount = db.prepare('SELECT username FROM training_accounts WHERE user_id = ?')
  const saveTrainingAccount = db.prepare(`
    INSERT INTO training_accounts (user_id, username) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET username = excluded.username
  `)
  const insert = db.prepare(`
    INSERT INTO applications (id, user_id, name, profile, school_class, competitions, awards, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM verified_accounts WHERE user_id = ?)
    ON CONFLICT DO NOTHING
  `)
  const claim = db.prepare(`
    UPDATE applications SET status = 'processing', reviewer = ?, decision = ?, role_ids = ?,
      retry_at = 0, work_error = NULL
    WHERE id = ? AND status = 'pending' AND review_message IS NOT NULL
  `)
  const work = db.prepare(`
    SELECT * FROM applications WHERE retry_at <= ? AND
      ((status = 'pending' AND review_message IS NULL) OR status = 'processing' OR needs_sync = 1)
    ORDER BY retry_at, created_at LIMIT 20
  `)
  const delivered = db.prepare(`
    UPDATE applications SET review_channel = ?, review_message = ?, retry_at = 0, work_error = NULL
    WHERE id = ?
  `)
  const finished = db.prepare(`
    UPDATE applications SET status = decision, needs_sync = 1, retry_at = 0, work_error = NULL
    WHERE id = ? AND status = 'processing'
  `)
  const synced = db.prepare('UPDATE applications SET needs_sync = 0, retry_at = 0, work_error = NULL WHERE id = ?')
  const failed = db.prepare('UPDATE applications SET work_error = ?, retry_at = ? WHERE id = ?')
  const counts = db.prepare('SELECT status, COUNT(*) AS total FROM applications GROUP BY status')
  const errors = db.prepare('SELECT COUNT(*) AS total FROM applications WHERE work_error IS NOT NULL')
  const recent = db.prepare(`SELECT ${listColumns} FROM applications ORDER BY created_at DESC, id DESC LIMIT 5`)
  const activity = db.prepare(`
    SELECT local_day(created_at) AS day, COUNT(*) AS total
    FROM applications WHERE created_at >= ? GROUP BY day
  `)
  const filter = "WHERE (? = '' OR status = ?) AND (? = '' OR instr(search_key(name), ?) > 0 OR user_id = ?)"
  const matches = db.prepare(`SELECT COUNT(*) AS total FROM applications ${filter}`)
  const listing = db.prepare(`
    SELECT ${listColumns} FROM applications ${filter}
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `)
  const remember = db.prepare(`
    INSERT OR IGNORE INTO verified_accounts (user_id, status)
    SELECT user_id, status FROM applications WHERE id = ? AND status IN ('accepted', 'external')
  `)
  const remove = db.prepare("DELETE FROM applications WHERE id = ? AND status IN ('accepted', 'external', 'rejected')")

  return {
    settings: () => ({ ...defaults, ...JSON.parse(readSetting.get('verification')?.value ?? '{}') }),
    saveSettings: settings => writeSetting.run('verification', JSON.stringify(settings)),
    panel: () => JSON.parse(readSetting.get('panel')?.value ?? 'null'),
    savePanel: panel => writeSetting.run('panel', JSON.stringify(panel)),
    get: id => get.get(id),
    current: user => current.get(user) ?? verified.get(user),
    trainingUsername: user => trainingAccount.get(user)?.username,
    linkTraining: (user, username) => saveTrainingAccount.run(user, username),
    create(user, answers) {
      const id = randomBytes(12).toString('hex')
      const { name, profile, schoolClass, competitions, awards } = answers
      return insert.run(id, user, name, profile, schoolClass, competitions, awards, Date.now(), user).changes === 1
    },
    claim: (id, reviewer, decision, roles) => claim.run(reviewer, decision, JSON.stringify(roles), id).changes === 1,
    work: () => work.all(Date.now()),
    delivered: (id, channel, message) => delivered.run(channel, message, id),
    finished: id => finished.run(id),
    synced: id => synced.run(id),
    failed: (id, error) => failed.run(error, Date.now() + 60_000, id),
    overview() {
      const today = Date.parse(localDay.format(Date.now()))
      const days = Array.from({ length: 14 }, (_, index) => new Date(today - (13 - index) * dayLength).toISOString().slice(0, 10))
      const totals = new Map(activity.all(Date.parse(days[0]) - dayLength).map(({ day, total }) => [day, total]))
      return {
        counts: Object.fromEntries(counts.all().map(({ status, total }) => [status, total])),
        errors: errors.get().total,
        recent: recent.all(),
        activity: days.map(day => ({ day, total: totals.get(day) ?? 0 }))
      }
    },
    applications({ status, query, page }) {
      const key = searchKey(query)
      const params = [status, status, key, key, query]
      const pageSize = 20
      const { total } = matches.get(...params)
      const pages = Math.max(1, Math.ceil(total / pageSize))
      page = Math.min(page, pages)
      return { total, pages, page, items: listing.all(...params, pageSize, (page - 1) * pageSize) }
    },
    removeApplication(id) {
      db.exec('BEGIN IMMEDIATE')
      try {
        remember.run(id)
        const deleted = remove.run(id).changes === 1
        db.exec('COMMIT')
        return deleted
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    close: () => db.close()
  }
}
