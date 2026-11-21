import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { STORE_KEYS } from "../config/storeKeys.js";
import { requireAdmin } from "../middleware/auth.js";
import { getRepository } from "../repositories/index.js";
import {
  createResource,
  deleteResource,
  getResourceArray,
  getResourceObject,
  removeResourcesWhere,
  setResourceObject,
  updateResource,
  type KvRecord,
  type ResourceConfig,
} from "../services/kvResource.service.js";
import { HttpError } from "../utils/httpError.js";

// Số tất treo trên quầy. PHẢI khớp WISH_SOCKS trong FE (components/pixel/wishSocks.js).
const WISH_SOCK_COUNT = 5;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STORED_WISHES = 1000;

const wishConfig: ResourceConfig = { key: STORE_KEYS.wishes };

function sockIds(): number[] {
  return Array.from({ length: WISH_SOCK_COUNT }, (_, i) => i + 1);
}

// Mặc định mọi tất đều MỞ; chỉ khi admin tắt (false) mới đóng.
async function readSocks(): Promise<Record<string, boolean>> {
  const repo = await getRepository();
  const stored = await getResourceObject(repo, STORE_KEYS.wishSocks);
  const socks: Record<string, boolean> = {};
  for (const id of sockIds()) socks[String(id)] = stored[String(id)] !== false;
  return socks;
}

function parseSockId(value: unknown): number {
  const id = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > WISH_SOCK_COUNT) {
    throw new HttpError(400, "Tất không hợp lệ");
  }
  return id;
}

function parsePhone(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new HttpError(400, "Số điện thoại không hợp lệ");
  const cleaned = value.replace(/[\s.\-()]/g, "");
  if (!cleaned) return "";
  if (!/^(\+?84|0)\d{8,10}$/.test(cleaned)) throw new HttpError(400, "Số điện thoại không hợp lệ");
  return cleaned;
}

export const wishController = {
  // PUBLIC — FE dùng để biết tất nào đang mở. Chỉ trả cờ bật/tắt, không có điều ước.
  async getSocks(_req: Request, res: Response) {
    res.json({ ok: true, socks: await readSocks() });
  },

  // ADMIN — bật/tắt từng tất. Body: { socks: { "1": false, "3": true } }
  async updateSocks(req: Request, res: Response) {
    requireAdmin(req);
    const body = (req.body || {}) as { socks?: unknown };
    const incoming = body.socks;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      throw new HttpError(400, "socks must be an object");
    }

    const next = await readSocks();
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      const id = parseSockId(key);
      if (typeof value !== "boolean") throw new HttpError(400, "Giá trị bật/tắt phải là true/false");
      next[String(id)] = value;
    }

    const repo = await getRepository();
    await setResourceObject(repo, STORE_KEYS.wishSocks, next);
    res.json({ ok: true, socks: next });
  },

  // PUBLIC (có rate limit) — khách gửi điều ước. Không lưu IP/thiết bị.
  async create(req: Request, res: Response) {
    const body = (req.body || {}) as Record<string, unknown>;

    // Ô bẫy bot: người thật không thấy nên không điền. Giả vờ thành công, không lưu.
    if (typeof body.website === "string" && body.website.trim()) {
      res.status(201).json({ ok: true });
      return;
    }

    const sockId = parseSockId(body.sockId);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new HttpError(400, "Viết điều ước trước đã nha");
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new HttpError(400, `Điều ước tối đa ${MAX_MESSAGE_LENGTH} ký tự`);
    }
    const phone = parsePhone(body.phone);

    const socks = await readSocks();
    if (!socks[String(sockId)]) throw new HttpError(403, "Cái tất này đang đóng, chưa nhận điều ước");

    const repo = await getRepository();
    const existing = await getResourceArray(repo, STORE_KEYS.wishes);
    if (existing.length >= MAX_STORED_WISHES) {
      throw new HttpError(503, "Hòm thư điều ước đang đầy, quay lại sau nha");
    }

    const item: KvRecord = {
      id: `wish_${Date.now()}_${randomBytes(3).toString("hex")}`,
      sockId,
      message,
      createdAt: new Date().toISOString(),
      read: false,
    };
    if (phone) item.phone = phone;

    await createResource(repo, wishConfig, item);
    res.status(201).json({ ok: true });
  },

  // ADMIN — đọc toàn bộ điều ước (mới nhất trước)
  async list(req: Request, res: Response) {
    requireAdmin(req);
    const repo = await getRepository();
    const items = await getResourceArray(repo, STORE_KEYS.wishes);
    res.json({ ok: true, items });
  },

  // ADMIN — đánh dấu đã đọc / chưa đọc. Body: { read: boolean } (mặc định true)
  async markRead(req: Request, res: Response) {
    requireAdmin(req);
    const body = (req.body || {}) as { read?: unknown };
    const read = typeof body.read === "boolean" ? body.read : true;
    const repo = await getRepository();
    const item = await updateResource(repo, wishConfig, req.params.id || "", { read });
    res.json({ ok: true, item });
  },

  // ADMIN — xoá tất cả điều ước ĐÃ ĐỌC (điều ước chưa đọc được giữ lại)
  async removeRead(req: Request, res: Response) {
    requireAdmin(req);
    const repo = await getRepository();
    const removed = await removeResourcesWhere(repo, wishConfig, (item) => item.read === true);
    res.json({ ok: true, removed });
  },

  // ADMIN — xoá điều ước
  async remove(req: Request, res: Response) {
    requireAdmin(req);
    const repo = await getRepository();
    await deleteResource(repo, wishConfig, req.params.id || "");
    res.json({ ok: true });
  },
};
