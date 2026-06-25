import { MongoClient, type Collection, type Db } from "mongodb";
import type { GalleryPhoto, GalleryPhotoInput, Repository } from "../types/repository.js";

let clientPromise: Promise<MongoClient> | null = null;
let indexesReady = false;

type AnyDoc = {
  _id: any;
  [key: string]: any;
};

const MAPPED_COLLECTIONS: Record<string, string> = {
  k92_cameras_v2: "cameras",
  k92_accessories_v2: "accessories",
  k92_orders_v2: "orders",
  k92_feedbacks_v1: "feedbacks",
  k92_discounts_v1: "discounts",
  k92_albums_v1: "albums",
};

type MongoConfig = {
  uri: string;
  dbName: string;
  kvCollection: string;
  galleryCollection: string;
};

function requireConfig(): MongoConfig {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MongoDB config is missing. Set MONGODB_URI.");
  }

  return {
    uri,
    dbName: process.env.MONGODB_DB || process.env.MONGO_DB || "92kamera",
    kvCollection: process.env.MONGODB_KV_COLLECTION || "kv_store",
    galleryCollection: process.env.MONGODB_GALLERY_COLLECTION || "gallery_photos",
  };
}

async function getClient(uri: string): Promise<MongoClient> {
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 8000),
    });
    clientPromise = client.connect();
  }

  return clientPromise;
}

async function getCollectionArray(db: Db, colName: string): Promise<unknown[]> {
  const docs = await db.collection<AnyDoc>(colName).find({}).toArray();
  return docs.map((doc) => {
    const { _id, ...rest } = doc as Record<string, unknown>;
    return { ...rest, id: _id };
  });
}

async function saveCollectionArray(db: Db, colName: string, value: unknown): Promise<void> {
  if (!Array.isArray(value)) return;

  const col = db.collection<AnyDoc>(colName);
  const ids = value
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).id : undefined))
    .filter((id) => id !== undefined && id !== null);

  await col.deleteMany({ _id: { $nin: ids } } as any);

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, ...doc } = item as Record<string, unknown>;
    if (id === undefined || id === null) continue;
    await col.updateOne({ _id: id } as any, { $set: doc }, { upsert: true });
  }
}

function mapPhoto(row: {
  public_id: string;
  url: string;
  uploaded_at: string;
  uploaded_by?: string;
}): GalleryPhoto {
  return {
    id: row.public_id,
    public_id: row.public_id,
    url: row.url,
    uploadedAt: row.uploaded_at,
    uploaded_at: row.uploaded_at,
    uploaded_by: row.uploaded_by,
  };
}

export function createMongoRepository(): Repository {
  const config = requireConfig();

  async function getDb(): Promise<{
    db: Db;
    kv: Collection<AnyDoc>;
    photos: Collection<AnyDoc>;
  }> {
    const client = await getClient(config.uri);
    const db = client.db(config.dbName);
    const kv = db.collection<AnyDoc>(config.kvCollection);
    const photos = db.collection<AnyDoc>(config.galleryCollection);

    if (!indexesReady) {
      await Promise.all([
        photos.createIndex({ uploaded_at: -1 }),
        kv.createIndex({ kv_key: 1 }, { unique: true }),
      ]);
      indexesReady = true;
    }

    return { db, kv, photos };
  }

  return {
    driver: "mongodb",

    async health() {
      const { db } = await getDb();
      await db.command({ ping: 1 });
      return { ok: true, driver: "mongodb", db: config.dbName };
    },

    async getKv(keyName) {
      const { db, kv } = await getDb();
      const mappedCollection = MAPPED_COLLECTIONS[keyName];

      if (mappedCollection) {
        const list = await getCollectionArray(db, mappedCollection);
        const meta = (await kv.findOne({ kv_key: `meta_${keyName}` })) as
          | { updated_at?: string }
          | null;

        return {
          exists: true,
          key: keyName,
          value: JSON.stringify(list),
          updatedAt: meta?.updated_at || null,
        };
      }

      const row = (await kv.findOne({ kv_key: keyName })) as
        | { kv_key: string; kv_value?: string; updated_at?: string }
        | null;

      if (!row) return { exists: false, value: null, updatedAt: null };

      return {
        exists: true,
        key: row.kv_key,
        value: row.kv_value ?? null,
        updatedAt: row.updated_at || null,
      };
    },

    async setKv(keyName, value, updatedAt = new Date().toISOString()) {
      const { db, kv } = await getDb();
      const mappedCollection = MAPPED_COLLECTIONS[keyName];

      if (mappedCollection) {
        const parsed = JSON.parse(value) as unknown;
        await saveCollectionArray(db, mappedCollection, parsed);
        await kv.updateOne(
          { kv_key: `meta_${keyName}` },
          { $set: { kv_key: `meta_${keyName}`, updated_at: updatedAt } },
          { upsert: true },
        );
        return { ok: true, updatedAt };
      }

      await kv.updateOne(
        { kv_key: keyName },
        { $set: { kv_key: keyName, kv_value: value, updated_at: updatedAt } },
        { upsert: true },
      );
      return { ok: true, updatedAt };
    },

    async casKv(keyName, value, expectedUpdatedAt) {
      const { db, kv } = await getDb();
      const nextUpdatedAt = new Date().toISOString();
      const mappedCollection = MAPPED_COLLECTIONS[keyName];

      if (mappedCollection) {
        if (!expectedUpdatedAt) {
          await this.setKv(keyName, value, nextUpdatedAt);
          return { ok: true, updatedAt: nextUpdatedAt };
        }

        const result = await kv.updateOne(
          { kv_key: `meta_${keyName}`, updated_at: expectedUpdatedAt },
          { $set: { updated_at: nextUpdatedAt } },
        );

        if (result.modifiedCount > 0) {
          const parsed = JSON.parse(value) as unknown;
          await saveCollectionArray(db, mappedCollection, parsed);
          return { ok: true, updatedAt: nextUpdatedAt };
        }

        const meta = (await kv.findOne({ kv_key: `meta_${keyName}` })) as
          | { updated_at?: string }
          | null;
        return { ok: false, updatedAt: meta?.updated_at || expectedUpdatedAt };
      }

      if (!expectedUpdatedAt) {
        await this.setKv(keyName, value, nextUpdatedAt);
        return { ok: true, updatedAt: nextUpdatedAt };
      }

      const result = await kv.updateOne(
        { kv_key: keyName, updated_at: expectedUpdatedAt },
        { $set: { kv_value: value, updated_at: nextUpdatedAt } },
      );

      if (result.modifiedCount > 0) {
        return { ok: true, updatedAt: nextUpdatedAt };
      }

      const current = await this.getKv(keyName);
      return { ok: false, updatedAt: current.updatedAt || expectedUpdatedAt };
    },

    async listPhotos(limitCount = 200) {
      const { photos } = await getDb();
      const rows = (await photos
        .find({}, { projection: { public_id: 1, url: 1, uploaded_at: 1, uploaded_by: 1 } })
        .sort({ uploaded_at: -1 })
        .limit(limitCount)
        .toArray()) as unknown as Array<{
        public_id: string;
        url: string;
        uploaded_at: string;
        uploaded_by?: string;
      }>;

      return rows.map(mapPhoto);
    },

    async upsertPhoto(photo: GalleryPhotoInput) {
      const { photos } = await getDb();
      const row = {
        public_id: photo.public_id,
        url: photo.url,
        uploaded_at: photo.uploadedAt || photo.uploaded_at || new Date().toISOString(),
        uploaded_by: photo.uploaded_by || "admin",
      };

      await photos.updateOne(
        { _id: row.public_id } as any,
        { $set: row, $setOnInsert: { _id: row.public_id } },
        { upsert: true },
      );

      return mapPhoto(row);
    },

    async deletePhoto(publicId) {
      const { photos } = await getDb();
      await photos.deleteOne({ _id: publicId } as any);
      return { ok: true };
    },
  };
}
