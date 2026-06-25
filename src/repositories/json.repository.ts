import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { STORE_KEYS } from "../config/storeKeys.js";
import type { GalleryPhoto, GalleryPhotoInput, Repository } from "../types/repository.js";

type JsonDb = {
  kv?: Record<string, { value: string; updated_at: string }>;
  gallery_photos?: Record<string, {
    public_id: string;
    url: string;
    uploaded_at: string;
    uploaded_by?: string;
  }>;
};

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readSeed(): Promise<JsonDb> {
  if (!(await fileExists(env.seedFile))) return {};

  try {
    const seed = JSON.parse(await fs.readFile(env.seedFile, "utf8")) as Record<string, unknown>;
    const now = new Date().toISOString();
    const kv: NonNullable<JsonDb["kv"]> = {};

    const seedMap: Record<string, unknown> = {
      [STORE_KEYS.cameras]: seed.cameras,
      [STORE_KEYS.accessories]: seed.accessories,
      [STORE_KEYS.site]: seed.site,
      [STORE_KEYS.feedbacks]: seed.feedbacks,
      [STORE_KEYS.users]: seed.users,
      [STORE_KEYS.discounts]: seed.discounts,
      [STORE_KEYS.albums]: seed.albums,
      [STORE_KEYS.deliveryFees]: seed.deliveryFees,
      [STORE_KEYS.orders]: seed.orders,
    };

    for (const [key, value] of Object.entries(seedMap)) {
      if (value !== undefined) {
        kv[key] = { value: JSON.stringify(value), updated_at: now };
      }
    }

    const galleryPhotos: NonNullable<JsonDb["gallery_photos"]> = {};
    const photos = Array.isArray(seed.photos) ? seed.photos : [];
    for (const photo of photos) {
      if (!photo || typeof photo !== "object") continue;
      const row = photo as Record<string, unknown>;
      if (typeof row.public_id !== "string" || typeof row.url !== "string") continue;

      galleryPhotos[row.public_id] = {
        public_id: row.public_id,
        url: row.url,
        uploaded_at:
          typeof row.uploaded_at === "string"
            ? row.uploaded_at
            : typeof row.uploadedAt === "string"
              ? row.uploadedAt
              : now,
        uploaded_by: typeof row.uploaded_by === "string" ? row.uploaded_by : "seed",
      };
    }

    return { kv, gallery_photos: galleryPhotos };
  } catch (error) {
    console.warn("[json-repository] seed file could not be parsed", error);
    return {};
  }
}

function mapPhoto(row: NonNullable<JsonDb["gallery_photos"]>[string]): GalleryPhoto {
  return {
    id: row.public_id,
    public_id: row.public_id,
    url: row.url,
    uploadedAt: row.uploaded_at,
    uploaded_at: row.uploaded_at,
    uploaded_by: row.uploaded_by,
  };
}

export function createJsonRepository(): Repository {
  const file = env.jsonDbFile;
  let writeQueue = Promise.resolve();

  async function load(): Promise<JsonDb> {
    if (!(await fileExists(file))) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const seed = await readSeed();
      await fs.writeFile(
        file,
        JSON.stringify(
          {
            kv: seed.kv || {},
            gallery_photos: seed.gallery_photos || {},
          },
          null,
          2,
        ),
      );
    }

    return JSON.parse(await fs.readFile(file, "utf8")) as JsonDb;
  }

  async function save(data: JsonDb): Promise<void> {
    writeQueue = writeQueue.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmpFile = `${file}.tmp`;
      await fs.writeFile(tmpFile, JSON.stringify(data, null, 2));
      await fs.rename(tmpFile, file);
    });
    return writeQueue;
  }

  return {
    driver: "json",

    async health() {
      await load();
      return { ok: true, driver: "json", file };
    },

    async getKv(keyName) {
      const data = await load();
      const row = data.kv?.[keyName];
      if (!row) return { exists: false, value: null, updatedAt: null };
      return { exists: true, key: keyName, value: row.value, updatedAt: row.updated_at || null };
    },

    async setKv(keyName, value, updatedAt = new Date().toISOString()) {
      const data = await load();
      data.kv ||= {};
      data.kv[keyName] = { value, updated_at: updatedAt };
      await save(data);
      return { ok: true, updatedAt };
    },

    async casKv(keyName, value, expectedUpdatedAt) {
      const data = await load();
      data.kv ||= {};
      const current = data.kv[keyName];

      if (expectedUpdatedAt && (!current || current.updated_at !== expectedUpdatedAt)) {
        return { ok: false, updatedAt: current?.updated_at || null };
      }

      const nextUpdatedAt = new Date().toISOString();
      data.kv[keyName] = { value, updated_at: nextUpdatedAt };
      await save(data);
      return { ok: true, updatedAt: nextUpdatedAt };
    },

    async listPhotos(limitCount = 200) {
      const data = await load();
      return Object.values(data.gallery_photos || {})
        .sort((a, b) => String(b.uploaded_at || "").localeCompare(String(a.uploaded_at || "")))
        .slice(0, limitCount)
        .map(mapPhoto);
    },

    async upsertPhoto(photo: GalleryPhotoInput) {
      const data = await load();
      data.gallery_photos ||= {};
      const uploadedAt = photo.uploadedAt || photo.uploaded_at || new Date().toISOString();
      const row = {
        public_id: photo.public_id,
        url: photo.url,
        uploaded_at: uploadedAt,
        uploaded_by: photo.uploaded_by || "admin",
      };

      data.gallery_photos[row.public_id] = row;
      await save(data);
      return mapPhoto(row);
    },

    async deletePhoto(publicId) {
      const data = await load();
      if (data.gallery_photos) delete data.gallery_photos[publicId];
      await save(data);
      return { ok: true };
    },
  };
}
