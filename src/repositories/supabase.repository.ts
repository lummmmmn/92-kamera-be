import { createClient } from "@supabase/supabase-js";
import type { GalleryPhoto, GalleryPhotoInput, Repository } from "../types/repository.js";

function requireConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase config is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return { url, key };
}

function mapKv(row: { key: string; value: string; updated_at: string | null } | null) {
  if (!row) return { exists: false, value: null, updatedAt: null };
  return {
    exists: true,
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at || null,
  };
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

export function createSupabaseRepository(): Repository {
  const { url, key } = requireConfig();
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    driver: "supabase",

    async health() {
      const { error } = await client.from("kv_store").select("key").limit(1);
      if (error) throw error;
      return { ok: true, driver: "supabase" };
    },

    async getKv(keyName) {
      const { data, error } = await client
        .from("kv_store")
        .select("key,value,updated_at")
        .eq("key", keyName)
        .maybeSingle();
      if (error) throw error;
      return mapKv(data);
    },

    async setKv(keyName, value, updatedAt = new Date().toISOString()) {
      const { error } = await client
        .from("kv_store")
        .upsert({ key: keyName, value, updated_at: updatedAt }, { onConflict: "key" });
      if (error) throw error;
      return { ok: true, updatedAt };
    },

    async casKv(keyName, value, expectedUpdatedAt) {
      const nextUpdatedAt = new Date().toISOString();
      if (!expectedUpdatedAt) {
        await this.setKv(keyName, value, nextUpdatedAt);
        return { ok: true, updatedAt: nextUpdatedAt };
      }

      const { data, error } = await client
        .from("kv_store")
        .update({ value, updated_at: nextUpdatedAt })
        .eq("key", keyName)
        .eq("updated_at", expectedUpdatedAt)
        .select("key");
      if (error) throw error;

      const ok = Array.isArray(data) && data.length > 0;
      return { ok, updatedAt: ok ? nextUpdatedAt : expectedUpdatedAt };
    },

    async listPhotos(limitCount = 200, offsetCount = 0) {
      const { data, error } = await client
        .from("gallery_photos")
        .select("public_id,url,uploaded_at,uploaded_by")
        .order("uploaded_at", { ascending: false })
        .range(offsetCount, offsetCount + limitCount - 1);
      if (error) throw error;
      return (data || []).map(mapPhoto);
    },

    async upsertPhoto(photo: GalleryPhotoInput) {
      const row = {
        public_id: photo.public_id,
        url: photo.url,
        uploaded_at: photo.uploadedAt || photo.uploaded_at || new Date().toISOString(),
        uploaded_by: photo.uploaded_by || "admin",
      };
      const { error } = await client.from("gallery_photos").upsert(row, { onConflict: "public_id" });
      if (error) throw error;
      return mapPhoto(row);
    },

    async deletePhoto(publicId) {
      const { error } = await client.from("gallery_photos").delete().eq("public_id", publicId);
      if (error) throw error;
      return { ok: true };
    },
  };
}
