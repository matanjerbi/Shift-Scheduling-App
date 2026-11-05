CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rate REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount_received REAL,
  note TEXT,
  closed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  start_time TEXT,
  end_time TEXT,
  extra_minutes INTEGER NOT NULL DEFAULT 0,
  hours_override REAL,
  note TEXT,
  period_id INTEGER REFERENCES periods(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_period ON shifts(period_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('default_rate', '90');
INSERT INTO workers (name) SELECT 'מתן' WHERE NOT EXISTS (SELECT 1 FROM workers);
INSERT INTO workers (name) SELECT 'יחזקאל' WHERE (SELECT COUNT(*) FROM workers) = 1;
INSERT INTO workers (name) SELECT 'יונתן' WHERE (SELECT COUNT(*) FROM workers) = 2;
INSERT INTO workers (name) SELECT 'ישראל' WHERE (SELECT COUNT(*) FROM workers) = 3;
