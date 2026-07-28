PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  kick_user_id TEXT NOT NULL UNIQUE,
  kick_username TEXT NOT NULL,
  kick_username_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_requests (
  id TEXT PRIMARY KEY,
  kick_username TEXT NOT NULL,
  kick_username_normalized TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  verified_user_id TEXT REFERENCES users(id),
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_verify_name_created ON verification_requests(kick_username_normalized, created_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE TABLE IF NOT EXISTS coin_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, reason)
);

-- Mağaza ürünleri silinmek yerine pasifleştirilir; eski siparişler korunur.
CREATE TABLE IF NOT EXISTS daily_claims (
  user_id TEXT NOT NULL REFERENCES users(id),
  claimed_day TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, claimed_day)
);

CREATE TABLE IF NOT EXISTS shop_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),
  stock INTEGER, -- NULL = sınırsız stok
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_products_active ON shop_products(active, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES shop_products(id),
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  customer_name TEXT NOT NULL DEFAULT '',
  shipping_address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_created ON shop_purchases(created_at DESC);

-- Admin API oturumları normal kullanıcı oturumlarından ayrı tutulur.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);

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
CREATE TABLE IF NOT EXISTS slot_highscores (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  username TEXT NOT NULL,
  best_payout INTEGER NOT NULL DEFAULT 0 CHECK (best_payout >= 0),
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slot_highscores_best ON slot_highscores(best_payout DESC);

CREATE TABLE IF NOT EXISTS slot_symbol_rarity (
  symbol_id TEXT PRIMARY KEY REFERENCES slot_symbols(id) ON DELETE CASCADE,
  rarity INTEGER NOT NULL DEFAULT 1 CHECK (rarity BETWEEN 1 AND 10000)
);
