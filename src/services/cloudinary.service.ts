import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

export interface CloudinaryUploadResult {
  url: string;
  secure_url: string;
  public_id: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

/**
 * Upload một Buffer lên Cloudinary via unsigned upload preset.
 *
 * Không cần API Secret hay SHA-1 signature.
 * Chỉ cần cloud_name + upload_preset (unsigned) từ Cloudinary Dashboard.
 *
 * Cách tạo preset:
 *   Cloudinary Console → Settings → Upload Presets → Add upload preset
 *   → Mode: Unsigned → Lưu tên preset vào CLOUDINARY_UPLOAD_PRESET
 */
export async function uploadToCloudinary(
  fileBuffer: Buffer,
  mimeType: string,
  options: {
    folder?: string;
    publicId?: string;
  } = {}
): Promise<CloudinaryUploadResult> {
  const { cloudinaryCloudName, cloudinaryApiKey, cloudinaryUploadPreset } = env;

  if (!cloudinaryCloudName) {
    throw new HttpError(500, "Thiếu CLOUDINARY_CLOUD_NAME trong .env");
  }
  if (!cloudinaryUploadPreset) {
    throw new HttpError(500, "Thiếu CLOUDINARY_UPLOAD_PRESET trong .env. Tạo unsigned preset tại Cloudinary Dashboard → Settings → Upload Presets");
  }

  const folder = options.folder || "92kamera";
  const boundary = `----CloudinaryBoundary${Date.now()}`;
  const CRLF = "\r\n";

  function textPart(name: string, value: string): Buffer {
    return Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
        `${value}${CRLF}`
    );
  }

  const filePart = Buffer.concat([
    Buffer.from(
      `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="upload"${CRLF}` +
        `Content-Type: ${mimeType}${CRLF}${CRLF}`
    ),
    fileBuffer,
    Buffer.from(CRLF),
  ]);

  const parts: Buffer[] = [
    textPart("upload_preset", cloudinaryUploadPreset),
    textPart("folder", folder),
  ];

  if (options.publicId) parts.push(textPart("public_id", options.publicId));
  // api_key chỉ cần nếu preset yêu cầu (unsigned preset không cần)
  if (cloudinaryApiKey) parts.push(textPart("api_key", cloudinaryApiKey));

  parts.push(filePart);
  parts.push(Buffer.from(`--${boundary}--${CRLF}`));

  const body = Buffer.concat(parts);
  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`;

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new HttpError(502, `Cloudinary upload thất bại: ${errText}`);
  }

  const result = (await response.json()) as CloudinaryUploadResult;
  return result;
}
