import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { GalleryPhoto, GalleryPhotoInput, Repository } from "../types/repository.js";

type KvPacket = RowDataPacket & {
  kv_key: string;
  kv_value: string;
  updated_at: string;
};

type PhotoPacket = RowDataPacket & {
  public_id: string;
  url: string;
  uploaded_at: string;
  uploaded_by?: string;
};

let pool: Pool | null = null;
let schemaReady = false;

function createPool(): Pool {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (url) {
    return mysql.createPool(url);
  }

  const host = process.env.MYSQL_HOST;
  const user = process.env.MYSQL_USER;
  const database = process.env.MYSQL_DATABASE;

  if (!host || !user || !database) {
    throw new Error("MySQL config is missing. Set MYSQL_URL or MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE.");
  }

  return mysql.createPool({
    host,
    port: Number(process.env.MYSQL_PORT || 3306),
    user,
    password: process.env.MYSQL_PASSWORD || "",
    database,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  });
}

async function getPool(): Promise<Pool> {
  if (!pool) pool = createPool();
  if (!schemaReady) {
    await ensureSchema(pool);
    schemaReady = true;
  }
  return pool;
}

async function ensureSchema(db: Pool): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS kv_store (
      kv_key VARCHAR(191) PRIMARY KEY,
      kv_value LONGTEXT NOT NULL,
      updated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS gallery_photos (
      public_id VARCHAR(512) PRIMARY KEY,
      url TEXT NOT NULL,
      uploaded_at VARCHAR(64) NOT NULL,
      uploaded_by VARCHAR(191) NULL,
      INDEX idx_gallery_uploaded_at (uploaded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function mapPhoto(row: PhotoPacket): GalleryPhoto {
  return {
    id: row.public_id,
    public_id: row.public_id,
    url: row.url,
    uploadedAt: row.uploaded_at,
    uploaded_at: row.uploaded_at,
    uploaded_by: row.uploaded_by,
  };
}

export function createMysqlRepository(): Repository {
  return {
    driver: "mysql",

    async health() {
      const db = await getPool();
      await db.query("SELECT 1");
      return { ok: true, driver: "mysql" };
    },

    async getKv(keyName) {
      const db = await getPool();
      const [rows] = await db.execute<KvPacket[]>(
        "SELECT kv_key, kv_value, updated_at FROM kv_store WHERE kv_key = ? LIMIT 1",
        [keyName],
      );
      const row = rows[0];
      if (!row) return { exists: false, value: null, updatedAt: null };
      return {
        exists: true,
        key: row.kv_key,
        value: row.kv_value,
        updatedAt: row.updated_at,
      };
    },

    async setKv(keyName, value, updatedAt = new Date().toISOString()) {
      const db = await getPool();
      await db.execute(
        `
          INSERT INTO kv_store (kv_key, kv_value, updated_at)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE kv_value = VALUES(kv_value), updated_at = VALUES(updated_at)
        `,
        [keyName, value, updatedAt],
      );
      return { ok: true, updatedAt };
    },

    async casKv(keyName, value, expectedUpdatedAt) {
      const db = await getPool();
      const nextUpdatedAt = new Date().toISOString();

      if (!expectedUpdatedAt) {
        await this.setKv(keyName, value, nextUpdatedAt);
        return { ok: true, updatedAt: nextUpdatedAt };
      }

      const [result] = await db.execute<ResultSetHeader>(
        "UPDATE kv_store SET kv_value = ?, updated_at = ? WHERE kv_key = ? AND updated_at = ?",
        [value, nextUpdatedAt, keyName, expectedUpdatedAt],
      );

      if (result.affectedRows > 0) {
        return { ok: true, updatedAt: nextUpdatedAt };
      }

      const current = await this.getKv(keyName);
      return { ok: false, updatedAt: current.updatedAt || expectedUpdatedAt };
    },

    async listPhotos(limitCount = 200, offsetCount = 0) {
      const db = await getPool();
      const [rows] = await db.execute<PhotoPacket[]>(
        `
          SELECT public_id, url, uploaded_at, uploaded_by
          FROM gallery_photos
          ORDER BY uploaded_at DESC
          LIMIT ? OFFSET ?
        `,
        [limitCount, offsetCount],
      );
      return rows.map(mapPhoto);
    },

    async upsertPhoto(photo: GalleryPhotoInput) {
      const db = await getPool();
      const row = {
        public_id: photo.public_id,
        url: photo.url,
        uploaded_at: photo.uploadedAt || photo.uploaded_at || new Date().toISOString(),
        uploaded_by: photo.uploaded_by || "admin",
      };

      await db.execute(
        `
          INSERT INTO gallery_photos (public_id, url, uploaded_at, uploaded_by)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            url = VALUES(url),
            uploaded_at = VALUES(uploaded_at),
            uploaded_by = VALUES(uploaded_by)
        `,
        [row.public_id, row.url, row.uploaded_at, row.uploaded_by],
      );

      return mapPhoto(row as PhotoPacket);
    },

    async deletePhoto(publicId) {
      const db = await getPool();
      await db.execute("DELETE FROM gallery_photos WHERE public_id = ?", [publicId]);
      return { ok: true };
    },
  };
}
