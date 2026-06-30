import type { Request, Response } from "express";
import { STORE_KEYS } from "../config/storeKeys.js";
import { requireAdmin } from "../middleware/auth.js";
import { getRepository } from "../repositories/index.js";
import {
  createBooking,
  getAvailableAccessoryQty,
  getAvailableCameraQty,
  listBookings,
  updateBookingStatus,
} from "../services/booking.service.js";
import { getResourceArray, setResourceArray, type KvRecord } from "../services/kvResource.service.js";
import type { BookingOrder, BookingRequest } from "../types/domain.js";
import { getDateRange } from "../utils/date.js";
import { requireString } from "../utils/http.js";
import { HttpError } from "../utils/httpError.js";

const ALLOWED_STATUS = new Set(["pending", "confirmed", "active", "completed", "cancelled"]);
const ACTIVE_ORDER_STATUSES = new Set(["pending", "confirmed", "active"]);

function isRecord(value: unknown): value is KvRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function findOrder(orders: KvRecord[], id: string): KvRecord {
  const order = orders.find((item) => String(item.id) === id);
  if (!order) throw new HttpError(404, "Order was not found");
  return order;
}

function sameId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalId(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return value;
  return undefined;
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSession(value: unknown): "morning" | "afternoon" | "full" {
  return value === "morning" || value === "afternoon" || value === "full" ? value : "full";
}

function newOrderId(existingOrders: BookingOrder[]): string {
  const existingIds = new Set(existingOrders.map((order) => order.id));
  let maxNum = 3;

  for (const order of existingOrders) {
    if (!order.id?.startsWith("#92K")) continue;
    const parsed = Number.parseInt(order.id.slice(4), 10);
    if (Number.isFinite(parsed) && parsed > maxNum) maxNum = parsed;
  }

  const seq = String(maxNum + 1).padStart(4, "0");
  const randomHex = () => Math.random().toString(16).slice(2, 4).toUpperCase();
  let candidate = `#92K${seq}-${randomHex()}`;
  let tries = 0;

  while (existingIds.has(candidate) && tries < 16) {
    candidate = `#92K${seq}-${randomHex()}`;
    tries += 1;
  }

  return candidate;
}

function normalizeLegacyOrder(body: KvRecord, existingOrders: BookingOrder[], fallback?: BookingOrder): BookingOrder {
  const date = optionalString(body.date ?? fallback?.date);
  const days = numberOr(body.days ?? fallback?.days, 0);
  const name = optionalString(body.name ?? fallback?.name);
  const phone = optionalString(body.phone ?? fallback?.phone);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD");
  if (!Number.isFinite(days) || days <= 0) throw new HttpError(400, "days must be greater than 0");
  if (!name) throw new HttpError(400, "name is required");
  if (!phone) throw new HttpError(400, "phone is required");

  const rawStatus = optionalString(body.status ?? fallback?.status);
  const status = ALLOWED_STATUS.has(rawStatus) ? rawStatus : "pending";
  const cameras = Array.isArray(body.cameras)
    ? body.cameras.filter(isRecord).map((camera) => ({
        ...camera,
        qty: numberOr(camera.qty, 1),
      }))
    : fallback?.cameras || [];
  const accessories = Array.isArray(body.accessories)
    ? body.accessories.filter((item): item is string => typeof item === "string")
    : fallback?.accessories || [];
  const accessoriesDetail = Array.isArray(body.accessoriesDetail)
    ? body.accessoriesDetail.filter(isRecord).map((item) => ({
        ...item,
        name: optionalString(item.name),
        qty: numberOr(item.qty, 1),
      }))
    : fallback?.accessoriesDetail || [];
  const appliedDiscounts = Array.isArray(body.appliedDiscounts)
    ? body.appliedDiscounts.filter(isRecord).map((item) => ({
        code: optionalString(item.code).toUpperCase(),
        scope: item.scope === "delivery" ? "delivery" as const : "rental" as const,
        amt: numberOr(item.amt, 0),
      }))
    : fallback?.appliedDiscounts || [];

  return {
    ...fallback,
    ...body,
    id: optionalString(body.id ?? fallback?.id) || newOrderId(existingOrders),
    submitKey: optionalString(body.submitKey ?? fallback?.submitKey) || undefined,
    status,
    date,
    days,
    session: normalizeSession(body.session ?? body.shift ?? fallback?.session),
    shift: body.shift === "morning" || body.shift === "afternoon" ? body.shift : fallback?.shift || null,
    cameraId: optionalId(body.cameraId) ?? fallback?.cameraId,
    cameraName: optionalString(body.cameraName ?? fallback?.cameraName),
    cameras: cameras as BookingOrder["cameras"],
    accessories,
    accessoriesDetail: accessoriesDetail as BookingOrder["accessoriesDetail"],
    subtotal: numberOr(body.subtotal ?? fallback?.subtotal, 0),
    discountCode: body.discountCode === null ? null : optionalString(body.discountCode ?? fallback?.discountCode) || null,
    discountAmt: numberOr(body.discountAmt ?? fallback?.discountAmt, 0),
    rentalDiscountAmt: numberOr(body.rentalDiscountAmt ?? fallback?.rentalDiscountAmt, 0),
    deliveryDiscountAmt: numberOr(body.deliveryDiscountAmt ?? fallback?.deliveryDiscountAmt, 0),
    appliedDiscounts,
    total: numberOr(body.total ?? fallback?.total, numberOr(body.subtotal ?? fallback?.subtotal, 0)),
    deliveryFee: numberOr(body.deliveryFee ?? fallback?.deliveryFee, 0),
    name,
    phone,
    zalo: optionalString(body.zalo ?? fallback?.zalo),
    email: optionalString(body.email ?? fallback?.email),
    address: optionalString(body.address ?? fallback?.address),
    note: optionalString(body.note ?? fallback?.note),
    userPhone: optionalString(body.userPhone ?? fallback?.userPhone) || phone,
    userEmail: optionalString(body.userEmail ?? fallback?.userEmail),
    createdAt: optionalString(body.createdAt ?? fallback?.createdAt) || new Date().toISOString(),
    updatedAt: fallback ? new Date().toISOString() : optionalString(body.updatedAt) || undefined,
    seen: typeof body.seen === "boolean" ? body.seen : fallback?.seen ?? false,
  };
}

function cameraRequests(order: BookingOrder): Array<{ id: unknown; qty: number }> {
  if (Array.isArray(order.cameras) && order.cameras.length > 0) {
    return order.cameras
      .filter((item) => item.id !== undefined)
      .map((item) => ({ id: item.id, qty: numberOr(item.qty, 1) }));
  }
  return order.cameraId !== undefined ? [{ id: order.cameraId, qty: 1 }] : [];
}

function accessoryRequests(order: BookingOrder): Array<{ name: string; qty: number }> {
  if (Array.isArray(order.accessoriesDetail) && order.accessoriesDetail.length > 0) {
    return order.accessoriesDetail
      .map((item) => ({ name: optionalString(item.name), qty: numberOr(item.qty, 1) }))
      .filter((item) => item.name);
  }

  return (order.accessories || [])
    .map((label) => {
      const match = label.match(/^(.*)\s+x(\d+)$/i);
      return {
        name: (match?.[1] || label).trim(),
        qty: match?.[2] ? numberOr(match[2], 1) : 1,
      };
    })
    .filter((item) => item.name);
}

async function validateLegacyAvailability(repo: Awaited<ReturnType<typeof getRepository>>, order: BookingOrder, orders: BookingOrder[]) {
  if (!ACTIVE_ORDER_STATUSES.has(order.status)) return;

  const [cameras, accessories] = await Promise.all([
    getResourceArray(repo, STORE_KEYS.cameras),
    getResourceArray(repo, STORE_KEYS.accessories),
  ]);
  const dateRange = getDateRange(order.date, order.days);
  const otherOrders = orders.filter((item) => item.id !== order.id);

  for (const request of cameraRequests(order)) {
    const camera = cameras.find((item) => sameId(item.id, request.id));
    if (!camera) throw new HttpError(400, `Camera ${String(request.id)} was not found`);
    const minAvailable = Math.min(
      ...dateRange.map((date) =>
        getAvailableCameraQty(camera.id as string | number, numberOr(camera.qty, 1), otherOrders, date, order.session),
      ),
    );
    if (minAvailable < request.qty) {
      throw new HttpError(409, `Camera "${String(camera.name || request.id)}" is not available`, {
        item: camera.name,
        available: minAvailable,
        needed: request.qty,
      });
    }
  }

  for (const request of accessoryRequests(order)) {
    const accessory = accessories.find((item) => item.name === request.name);
    if (!accessory) throw new HttpError(400, `Accessory ${request.name} was not found`);
    const minAvailable = Math.min(
      ...dateRange.map((date) =>
        getAvailableAccessoryQty(request.name, numberOr(accessory.qty, 0), otherOrders, date, order.session),
      ),
    );
    if (minAvailable < request.qty) {
      throw new HttpError(409, `Accessory "${request.name}" is not available`, {
        item: request.name,
        available: minAvailable,
        needed: request.qty,
      });
    }
  }
}

function isBookingRequest(body: KvRecord): boolean {
  return isRecord(body.customer) || isRecord(body.rental) || isRecord(body.items);
}

function isPublicCancellation(current: BookingOrder, body: KvRecord): boolean {
  return current.status === "pending" && body.status === "cancelled";
}

import { findUserByGoogleId } from "../services/userResource.service.js";

function redactOrder(order: BookingOrder): BookingOrder {
  return {
    ...order,
    name: "Khách hàng",
    phone: "Số điện thoại ẩn",
    zalo: "",
    email: "",
    address: "Địa chỉ ẩn",
    note: "",
    userPhone: "",
    userEmail: "",
  };
}

export const orderController = {
  async create(req: Request, res: Response) {
    const repo = await getRepository();
    const body = isRecord(req.body) ? req.body : {};

    if (isBookingRequest(body)) {
      const order = await createBooking(repo, body as BookingRequest);
      res.status(201).json(order);
      return;
    }

    const orders = (await getResourceArray(repo, STORE_KEYS.orders)) as unknown as BookingOrder[];
    const existing = body.submitKey
      ? orders.find((order) => order.submitKey && order.submitKey === body.submitKey)
      : undefined;
    if (existing) {
      res.json(existing);
      return;
    }

    const order = normalizeLegacyOrder(body, orders);
    await validateLegacyAvailability(repo, order, orders);
    await setResourceArray(repo, STORE_KEYS.orders, [order as unknown as KvRecord, ...(orders as unknown as KvRecord[])]);
    res.status(201).json(order);
  },

  async list(req: Request, res: Response) {
    const repo = await getRepository();
    const orders = await listBookings(repo, {
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      q: typeof req.query.q === "string" ? req.query.q : undefined,
    });

    const userRole = req.user?.role;
    const userSub = req.user?.sub;

    let adminOrOwnerCheck = (_order: BookingOrder) => false;

    if (userSub === "admin" || userRole === "admin") {
      adminOrOwnerCheck = () => true;
    } else if (userSub) {
      try {
        const userRecord = await findUserByGoogleId(repo, String(userSub));
        if (userRecord) {
          const userEmail = typeof userRecord.email === "string" ? userRecord.email.toLowerCase() : "";
          const userPhone = typeof userRecord.phone === "string" ? userRecord.phone.replace(/[^0-9]/g, "") : "";

          adminOrOwnerCheck = (order: BookingOrder) => {
            if (userEmail && (order.userEmail?.toLowerCase() === userEmail || order.email?.toLowerCase() === userEmail)) {
              return true;
            }
            const orderPhoneNorm = (order.phone || "").replace(/[^0-9]/g, "");
            const orderUserPhoneNorm = (order.userPhone || "").replace(/[^0-9]/g, "");
            if (userPhone && (orderPhoneNorm === userPhone || orderUserPhoneNorm === userPhone)) {
              return true;
            }
            return false;
          };
        }
      } catch (e) {
        console.warn("[92K] Failed to fetch user for owner check:", e);
      }
    }

    const processedOrders = orders.map((order) => {
      if (adminOrOwnerCheck(order)) {
        return order;
      }
      return redactOrder(order);
    });

    res.json(processedOrders);
  },

  async getOne(req: Request, res: Response) {
    const id = requireString(req.params.id, "id");
    const repo = await getRepository();
    const orders = await getResourceArray(repo, STORE_KEYS.orders);
    const order = findOrder(orders, id);

    res.json(order);
  },

  async update(req: Request, res: Response) {
    const id = requireString(req.params.id, "id");
    const body = isRecord(req.body) ? req.body : {};
    const repo = await getRepository();
    const orders = (await getResourceArray(repo, STORE_KEYS.orders)) as unknown as BookingOrder[];
    const current = orders.find((item) => item.id === id);
    if (!current) throw new HttpError(404, "Order was not found");

    if (!isPublicCancellation(current, body)) requireAdmin(req);

    const nextOrder = normalizeLegacyOrder({ ...current, ...body, id }, orders, current);

    // Only validate availability if dates, session, cameras or accessories have changed,
    // or if the order is being reactivated (status changed from inactive to active).
    const isReactivated = !ACTIVE_ORDER_STATUSES.has(current.status) && ACTIVE_ORDER_STATUSES.has(nextOrder.status);
    const dateChanged = current.date !== nextOrder.date;
    const daysChanged = current.days !== nextOrder.days;
    const sessionChanged = current.session !== nextOrder.session;
    const camerasChanged = JSON.stringify(current.cameras || []) !== JSON.stringify(nextOrder.cameras || []) ||
                           current.cameraId !== nextOrder.cameraId ||
                           current.cameraName !== nextOrder.cameraName;
    const accessoriesChanged = JSON.stringify(current.accessories || []) !== JSON.stringify(nextOrder.accessories || []) ||
                               JSON.stringify(current.accessoriesDetail || []) !== JSON.stringify(nextOrder.accessoriesDetail || []);

    if (isReactivated || dateChanged || daysChanged || sessionChanged || camerasChanged || accessoriesChanged) {
      await validateLegacyAvailability(repo, nextOrder, orders);
    }

    const nextOrders = orders.map((item) => (item.id === id ? nextOrder : item));
    await setResourceArray(repo, STORE_KEYS.orders, nextOrders as unknown as KvRecord[]);
    res.json(nextOrder);
  },

  async updateStatus(req: Request, res: Response) {
    requireAdmin(req);

    const orderId = requireString(req.params.id, "id");
    const status = requireString((req.body || {}).status, "status");
    const repo = await getRepository();
    let order = await updateBookingStatus(repo, orderId, status);

    if (typeof req.body?.adminNote === "string") {
      const orders = (await getResourceArray(repo, STORE_KEYS.orders)) as unknown as BookingOrder[];
      order = { ...order, adminNote: req.body.adminNote, updatedAt: new Date().toISOString() };
      await setResourceArray(
        repo,
        STORE_KEYS.orders,
        orders.map((item) => (item.id === orderId ? order : item)) as unknown as KvRecord[],
      );
    }

    res.json(order);
  },

  async markSeen(req: Request, res: Response) {
    requireAdmin(req);

    const id = requireString(req.params.id, "id");
    const repo = await getRepository();
    const orders = await getResourceArray(repo, STORE_KEYS.orders);
    const order = findOrder(orders, id);
    const nextOrder: BookingOrder = {
      ...(order as BookingOrder),
      seen: true,
      updatedAt: new Date().toISOString(),
    };
    const nextOrders = orders.map((item) => (String(item.id) === id ? (nextOrder as unknown as KvRecord) : item));
    await setResourceArray(repo, STORE_KEYS.orders, nextOrders);

    res.json(nextOrder);
  },

  async remove(req: Request, res: Response) {
    requireAdmin(req);

    const id = requireString(req.params.id, "id");
    const repo = await getRepository();
    const orders = await getResourceArray(repo, STORE_KEYS.orders);
    const order = findOrder(orders, id);
    const nextOrders = orders.filter((item) => String(item.id) !== id);
    await setResourceArray(repo, STORE_KEYS.orders, nextOrders);

    res.json(order);
  },
};
