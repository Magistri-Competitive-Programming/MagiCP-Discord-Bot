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

export function openStore(directory, guildId) {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'magicp.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
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
  const insert = db.prepare(`
    INSERT INTO applications (id, user_id, name, profile, school_class, competitions, awards, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
  const recent = db.prepare(`
    SELECT name, profile, status, created_at, review_channel, review_message, work_error
    FROM applications ORDER BY created_at DESC LIMIT 20
  `)

  return {
    settings: () => ({ ...defaults, ...JSON.parse(readSetting.get('verification')?.value ?? '{}') }),
    saveSettings: settings => writeSetting.run('verification', JSON.stringify(settings)),
    panel: () => JSON.parse(readSetting.get('panel')?.value ?? 'null'),
    savePanel: panel => writeSetting.run('panel', JSON.stringify(panel)),
    get: id => get.get(id),
    current: user => current.get(user),
    create(user, answers) {
      const id = randomBytes(12).toString('hex')
      const { name, profile, schoolClass, competitions, awards } = answers
      return insert.run(id, user, name, profile, schoolClass, competitions, awards, Date.now()).changes === 1
    },
    claim: (id, reviewer, decision, roles) => claim.run(reviewer, decision, JSON.stringify(roles), id).changes === 1,
    work: () => work.all(Date.now()),
    delivered: (id, channel, message) => delivered.run(channel, message, id),
    finished: id => finished.run(id),
    synced: id => synced.run(id),
    failed: (id, error) => failed.run(error, Date.now() + 60_000, id),
    overview: () => ({
      counts: Object.fromEntries(counts.all().map(({ status, total }) => [status, total])),
      errors: errors.get().total,
      recent: recent.all()
    }),
    close: () => db.close()
  }
}
