import type { Request, Response } from "express";
import { requireAdmin } from "../middleware/auth.js";
import { uploadToCloudinary } from "../services/cloudinary.service.js";
import { HttpError } from "../utils/httpError.js";

/** Parse boundary từ Content-Type header */
function parseBoundary(contentType: string): string {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = match?.[1] ?? match?.[2] ?? "";
  if (!boundary) throw new HttpError(400, "multipart boundary is missing");
  return boundary;
}

/** Đọc toàn bộ request body vào Buffer */
function readBuffer(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Tách Buffer theo delimiter */
function splitBuffer(buf: Buffer, delim: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let idx = buf.indexOf(delim, start);
  while (idx !== -1) {
    parts.push(buf.subarray(start, idx));
    start = idx + delim.length;
    idx = buf.indexOf(delim, start);
  }
  parts.push(buf.subarray(start));
  return parts;
}

function trimCrlf(buf: Buffer): Buffer {
  let s = 0;
  let e = buf.length;
  if (buf[s] === 13 && buf[s + 1] === 10) s += 2;
  if (buf[e - 2] === 13 && buf[e - 1] === 10) e -= 2;
  return buf.subarray(s, e);
}

function parseHeaders(raw: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of raw.split("\r\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    h[line.slice(0, sep).trim().toLowerCase()] = line.slice(sep + 1).trim();
  }
  return h;
}

function dispositionValue(header: string, name: string): string {
  return header.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

interface ParsedMultipart {
  fileBuffer: Buffer;
  mimeType: string;
  fields: Record<string, string>;
}

/** Parse multipart/form-data thủ công (không dùng busboy/multer) */
async function parseMultipart(req: Request): Promise<ParsedMultipart> {
  const boundary = parseBoundary(req.headers["content-type"] ?? "");
  const body = await readBuffer(req);
  const parts = splitBuffer(body, Buffer.from(`--${boundary}`));

  const fields: Record<string, string> = {};
  let fileBuffer: Buffer | undefined;
  let mimeType = "image/jpeg";

  for (const rawPart of parts) {
    const part = trimCrlf(rawPart);
    if (part.length === 0 || part.subarray(0, 2).toString() === "--") continue;

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd < 0) continue;

    const headers = parseHeaders(part.subarray(0, headerEnd).toString("latin1"));
    const data = trimCrlf(part.subarray(headerEnd + 4));
    const disposition = headers["content-disposition"] ?? "";
    const fieldName = dispositionValue(disposition, "name");
    const filename = dispositionValue(disposition, "filename");

    if (filename) {
      fileBuffer = data;
      mimeType = headers["content-type"] ?? "image/jpeg";
    } else if (fieldName) {
      fields[fieldName] = data.toString("utf8");
    }
  }

  if (!fileBuffer) throw new HttpError(400, "Không tìm thấy file trong request");
  return { fileBuffer, mimeType, fields };
}

export const uploadController = {
  /**
   * POST /api/upload
   * Body: multipart/form-data
   *   - file: image file (đã được FE compress)
   *   - folder?: cloudinary folder (default: "92kamera")
   *   - public_id?: custom public_id
   *
   * Response: { ok, url, secure_url, public_id, width, height, format, bytes }
   */
  async upload(req: Request, res: Response) {
    requireAdmin(req);

    if (!req.is("multipart/form-data")) {
      throw new HttpError(400, "Yêu cầu multipart/form-data");
    }

    const { fileBuffer, mimeType, fields } = await parseMultipart(req);

    const result = await uploadToCloudinary(fileBuffer, mimeType, {
      folder: fields.folder,
      publicId: fields.public_id ?? fields.publicId,
    });

    res.status(201).json({
      ok: true,
      url: result.secure_url,
      secure_url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    });
  },
};
