-- Devices: each browser gets a random id on first open; the admin can give it a label
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  label TEXT,
  user_agent TEXT,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_ip TEXT,
  last_city TEXT,
  blocked INTEGER NOT NULL DEFAULT 0
);

-- Visits: app opens, logins, failed password attempts
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,              -- open | login | login_failed | admin_login | admin_failed
  device_id TEXT,
  ip TEXT,
  city TEXT,
  country TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts);
CREATE INDEX IF NOT EXISTS idx_visits_dev ON visits(device_id);

-- Audit: every change to the data, with the row before and after
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  device_id TEXT,
  ip TEXT,
  action TEXT NOT NULL,             -- create | update | delete | close | reopen | settings
  entity TEXT NOT NULL,             -- shift | worker | period | settings
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
CREATE INDEX IF NOT EXISTS idx_audit_dev ON audit(device_id);
