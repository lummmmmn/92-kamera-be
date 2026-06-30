export type KvRow = {
  exists: boolean;
  key?: string;
  value: string | null;
  updatedAt: string | null;
};

export type CasResult = {
  ok: boolean;
  updatedAt: string | null;
};

export type GalleryPhotoInput = {
  public_id: string;
  url: string;
  uploadedAt?: string;
  uploaded_at?: string;
  uploaded_by?: string;
};

export type GalleryPhoto = {
  id: string;
  public_id: string;
  url: string;
  uploadedAt: string;
  uploaded_at: string;
  uploaded_by?: string;
};

export type HealthResult = {
  ok: true;
  driver: string;
  [key: string]: unknown;
};

export interface Repository {
  driver: string;
  health(): Promise<HealthResult>;
  getKv(keyName: string): Promise<KvRow>;
  setKv(keyName: string, value: string, updatedAt?: string): Promise<{ ok: true; updatedAt: string }>;
  casKv(keyName: string, value: string, expectedUpdatedAt?: string | null): Promise<CasResult>;
  listPhotos(limitCount?: number, offsetCount?: number): Promise<GalleryPhoto[]>;
  upsertPhoto(photo: GalleryPhotoInput): Promise<GalleryPhoto>;
  deletePhoto(publicId: string): Promise<{ ok: true }>;
}
