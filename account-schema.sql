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
