-- MySQL schema used by DB_DRIVER=mysql.
-- The application also creates these tables automatically at startup.

CREATE TABLE IF NOT EXISTS kv_store (
  kv_key VARCHAR(191) PRIMARY KEY,
  kv_value LONGTEXT NOT NULL,
  updated_at VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gallery_photos (
  public_id VARCHAR(512) PRIMARY KEY,
  url TEXT NOT NULL,
  uploaded_at VARCHAR(64) NOT NULL,
  uploaded_by VARCHAR(191) NULL,
  INDEX idx_gallery_uploaded_at (uploaded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supabase/Postgres equivalent:
--
-- CREATE TABLE IF NOT EXISTS kv_store (
--   key TEXT PRIMARY KEY,
--   value TEXT NOT NULL,
--   updated_at TIMESTAMPTZ DEFAULT now()
-- );
--
-- CREATE TABLE IF NOT EXISTS gallery_photos (
--   public_id TEXT PRIMARY KEY,
--   url TEXT NOT NULL,
--   uploaded_at TIMESTAMPTZ DEFAULT now(),
--   uploaded_by TEXT
-- );
--
-- ALTER TABLE kv_store ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE gallery_photos ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY allow_all_kv_store ON kv_store
--   FOR ALL
--   USING (true)
--   WITH CHECK (true);
--
-- CREATE POLICY allow_all_gallery_photos ON gallery_photos
--   FOR ALL
--   USING (true)
--   WITH CHECK (true);
