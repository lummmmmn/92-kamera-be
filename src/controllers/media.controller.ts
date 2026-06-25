import type { Request, Response } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { photoSchema, validateModelInput } from "../models/index.js";
import { getRepository } from "../repositories/index.js";
import { getResourceById, updateResource, type KvRecord } from "../services/kvResource.service.js";
import { parseLimit, requireString } from "../utils/http.js";
import { HttpError } from "../utils/httpError.js";
import { resources } from "./resource.controller.js";

function bodyRecord(req: Request): KvRecord {
  return (req.body || {}) as KvRecord;
}

function newPublicId(folder: string): string {
  return `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function trimCrlf(buffer: Buffer): Buffer {
  let start = 0;
  let end = buffer.length;
  if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
  if (buffer[end - 2] === 13 && buffer[end - 1] === 10) end -= 2;
  return buffer.subarray(start, end);
}

function splitBuffer(buffer: Buffer, delimiter: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    chunks.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  chunks.push(buffer.subarray(start));
  return chunks;
}

function parseHeaderBlock(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function dispositionValue(header: string, name: string): string {
  const match = header.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1] || "";
}

function readRequestBuffer(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function multipartPayload(req: Request, defaultFolder: string): Promise<KvRecord> {
  const contentType = req.headers["content-type"] || "";
  const boundary = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ||
    String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new HttpError(400, "multipart boundary is missing");

  const body = await readRequestBuffer(req);
  const parts = splitBuffer(body, Buffer.from(`--${boundary}`));
  const fields: Record<string, string> = {};
  let file:
    | {
        contentType: string;
        data: Buffer;
      }
    | undefined;

  for (const rawPart of parts) {
    const part = trimCrlf(rawPart);
    if (part.length === 0 || part.subarray(0, 2).toString() === "--") continue;

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) continue;

    const headers = parseHeaderBlock(part.subarray(0, headerEnd).toString("latin1"));
    const data = trimCrlf(part.subarray(headerEnd + 4));
    const disposition = headers["content-disposition"] || "";
    const fieldName = dispositionValue(disposition, "name");
    const filename = dispositionValue(disposition, "filename");

    if (filename) {
      file = {
        contentType: headers["content-type"] || "application/octet-stream",
        data,
      };
    } else if (fieldName) {
      fields[fieldName] = data.toString("utf8");
    }
  }

  if (!file) throw new HttpError(400, "multipart file is required");

  const folder = fields.folder || defaultFolder;
  const id = fields.public_id || fields.publicId || fields.id || newPublicId(folder);
  return {
    public_id: id,
    publicId: id,
    id,
    url: `data:${file.contentType};base64,${file.data.toString("base64")}`,
    uploadedAt: new Date().toISOString(),
  };
}

async function photoPayload(req: Request, defaultFolder: string): Promise<KvRecord> {
  if (req.is("multipart/form-data")) return multipartPayload(req, defaultFolder);

  const body = bodyRecord(req);
  const photo = (body.photo || body.image || body) as KvRecord;
  const existingId = photo.public_id || photo.publicId || photo.id;
  if (typeof existingId !== "string" && typeof existingId !== "number") {
    const id = newPublicId(defaultFolder);
    return { ...photo, public_id: id, publicId: id, id };
  }
  return photo;
}

export const photoController = {
  async list(req: Request, res: Response) {
    const limit = parseLimit(req.query.limit, 200, 500);
    const repo = await getRepository();
    const photos = await repo.listPhotos(limit);

    res.json({ ok: true, photos });
  },

  async upload(req: Request, res: Response) {
    requireAdmin(req);

    const photo = await photoPayload(req, "92kamera_gallery");
    const publicId = requireString(photo.public_id || photo.publicId || photo.id, "public_id");
    const url = requireString(photo.url, "url");
    const payload = validateModelInput(photoSchema, { ...photo, public_id: publicId, url });

    const repo = await getRepository();
    const saved = await repo.upsertPhoto({
      public_id: publicId,
      url,
      uploadedAt: typeof payload.uploadedAt === "string" ? payload.uploadedAt : undefined,
      uploaded_at: typeof payload.uploaded_at === "string" ? payload.uploaded_at : undefined,
      uploaded_by: typeof payload.uploaded_by === "string" ? payload.uploaded_by : "admin",
    });

    res.status(201).json({ ok: true, ...saved, photo: saved });
  },

  async remove(req: Request, res: Response) {
    requireAdmin(req);

    const publicId = requireString(req.params.id || req.query.public_id, "public_id");
    const repo = await getRepository();
    await repo.deletePhoto(publicId);

    res.json({ ok: true, id: publicId, public_id: publicId });
  },
};

export const cameraImageController = {
  async upload(req: Request, res: Response) {
    requireAdmin(req);

    const cameraId = requireString(req.params.id, "id");
    const image = await photoPayload(req, "92kamera_cameras");
    const url = requireString(image.url, "url");
    const publicId =
      typeof image.public_id === "string"
        ? image.public_id
        : typeof image.publicId === "string"
          ? image.publicId
          : newPublicId("92kamera_cameras");

    const repo = await getRepository();
    await repo.upsertPhoto({
      public_id: publicId,
      url,
      uploadedAt: typeof image.uploadedAt === "string" ? image.uploadedAt : undefined,
      uploaded_at: typeof image.uploaded_at === "string" ? image.uploaded_at : undefined,
      uploaded_by: typeof image.uploaded_by === "string" ? image.uploaded_by : "admin",
    });

    if (cameraId === "undefined" || cameraId === "null") {
      res.status(201).json({
        ok: true,
        url,
        public_id: publicId,
        publicId,
        image: { url, public_id: publicId },
      });
      return;
    }

    const camera = await getResourceById(repo, resources.cameras, cameraId);
    const images = Array.isArray(camera.images) ? [...camera.images, url] : [url];
    const imagesMeta = Array.isArray(camera.imagesMeta) ? [...camera.imagesMeta] : [];
    imagesMeta.push({ url, public_id: publicId });

    const nextCamera = await updateResource(repo, resources.cameras, cameraId, {
      images,
      imagesMeta,
    });

    res.status(201).json({
      ok: true,
      camera: nextCamera,
      url,
      public_id: publicId,
      publicId,
      image: { url, public_id: publicId },
    });
  },
};
