-- Cloudflare D1 Console'da bir kez çalıştırın.
CREATE TABLE IF NOT EXISTS slot_config (
  id TEXT PRIMARY KEY,
  win_rate INTEGER NOT NULL DEFAULT 20 CHECK (win_rate BETWEEN 0 AND 100),
  cascade_rate INTEGER NOT NULL DEFAULT 10 CHECK (cascade_rate BETWEEN 0 AND 100),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS slot_symbols (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  multiplier REAL NOT NULL CHECK (multiplier > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slot_symbols_active ON slot_symbols(active, sort_order);
