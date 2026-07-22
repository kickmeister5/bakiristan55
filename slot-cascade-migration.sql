-- LEGACY: Yalnızca eski slot_config tabloları için bir kez çalıştırılır.
-- Yeni kurulumda account-schema.sql bu alanı zaten içerir; bu dosyayı çalıştırmayın.
ALTER TABLE slot_config ADD COLUMN cascade_rate INTEGER NOT NULL DEFAULT 10 CHECK (cascade_rate BETWEEN 0 AND 100);