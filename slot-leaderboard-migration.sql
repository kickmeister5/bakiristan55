-- LEGACY: Yalnızca account-schema.sql eski sürümle daha önce kurulmuşsa çalıştırılır.
-- Yeni kurulumda account-schema.sql bu tabloyu zaten içerir; bu dosyayı çalıştırmayın.
CREATE TABLE IF NOT EXISTS slot_highscores (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  best_payout INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slot_highscores_best ON slot_highscores(best_payout DESC);