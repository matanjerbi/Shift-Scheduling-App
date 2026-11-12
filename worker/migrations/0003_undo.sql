-- Undo support: mark an audit entry as undone, and link an undo entry to what it reversed
ALTER TABLE audit ADD COLUMN undone_at TEXT;
ALTER TABLE audit ADD COLUMN undo_of INTEGER;
