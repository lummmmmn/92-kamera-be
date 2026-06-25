import { STORE_KEYS } from "../config/storeKeys.js";
import type {
  Accessory,
  BookingOrder,
  BookingRequest,
  Camera,
  Discount,
  Id,
  PricingBreakdown,
} from "../types/domain.js";
import type { Repository } from "../types/repository.js";
import { dateAddDays, getDateRange, getOrderSession, isDateInOrder, sessionsConflict, todayStr } from "../utils/date.js";
import { HttpError } from "../utils/httpError.js";
import { getCatalogData } from "./catalog.service.js";
import { applyDiscounts, calculateSubtotal, pricingInternals, resolveDeliveryFee } from "./pricing.service.js";
import { arrayOrEmpty, casJsonValue, getJsonValue, getJsonValueWithMeta } from "./storage.service.js";

const ACTIVE_ORDER_STATUSES = new Set(["pending", "confirmed", "active"]);
const ALLOWED_STATUS = new Set(["pending", "confirmed", "active", "completed", "cancelled"]);

function normalizeSession(value: unknown): "morning" | "afternoon" | "full" {
  return value === "morning" || value === "afternoon" || value === "full" ? value : "full";
}

function requireCustomer(request: BookingRequest): Required<NonNullable<BookingRequest["customer"]>> {
  const customer = request.customer || {};
  const name = typeof customer.name === "string" ? customer.name.trim() : "";
  const phone = typeof customer.phone === "string" ? customer.phone.trim() : "";

  if (!name) throw new HttpError(400, "customer.name is required");
  if (!phone) throw new HttpError(400, "customer.phone is required");

  const phoneClean = phone.replace(/\s/g, "");
  if (!/^(0|\+84)\d{9}$/.test(phoneClean)) {
    throw new HttpError(400, "customer.phone is invalid");
  }

  return {
    name,
    phone,
    zalo: typeof customer.zalo === "string" ? customer.zalo.trim() : "",
    email: typeof customer.email === "string" ? customer.email.trim().toLowerCase() : "",
    address: typeof customer.address === "string" ? customer.address.trim() : "",
    note: typeof customer.note === "string" ? customer.note.trim() : "",
  };
}

function requireRental(request: BookingRequest): { date: string; days: number; session: "morning" | "afternoon" | "full" } {
  const date = typeof request.rental?.date === "string" ? request.rental.date : "";
  const days = Number(request.rental?.days);
  const session = normalizeSession(request.rental?.session);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "rental.date must be YYYY-MM-DD");
  if (date < todayStr()) throw new HttpError(400, "rental.date cannot be in the past");
  if (!Number.isFinite(days) || days <= 0) throw new HttpError(400, "rental.days must be greater than 0");
  if (days < 1 && days !== 0.5) throw new HttpError(400, "half-day bookings must use 0.5 days");

  return { date, days, session };
}

function newOrderId(existingOrders: BookingOrder[]): string {
  const existingIds = new Set(existingOrders.map((order) => order.id));
  let maxNum = 3;

  for (const order of existingOrders) {
    if (!order.id.startsWith("#92K")) continue;
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

function usedCameraQty(order: BookingOrder, cameraId: Id): number {
  if (Array.isArray(order.cameras)) {
    const item = order.cameras.find((camera) => pricingInternals.sameId(camera.id, cameraId));
    return item?.qty || 0;
  }

  return order.cameraId !== undefined && pricingInternals.sameId(order.cameraId, cameraId) ? 1 : 0;
}

function usedAccessoryQty(order: BookingOrder, accessoryName: string): number {
  if (Array.isArray(order.accessoriesDetail)) {
    const item = order.accessoriesDetail.find((accessory) => accessory.name === accessoryName);
    return item?.qty || 0;
  }

  if (Array.isArray(order.accessories) && order.accessories.includes(accessoryName)) {
    return 1;
  }

  return 0;
}

function relevantOrders(orders: BookingOrder[], date: string, session: string): BookingOrder[] {
  return orders.filter((order) => {
    if (!ACTIVE_ORDER_STATUSES.has(order.status)) return false;
    if (!isDateInOrder(date, order)) return false;
    return sessionsConflict(getOrderSession(order), session);
  });
}

export function getAvailableCameraQty(
  cameraId: Id,
  totalQty: number,
  orders: BookingOrder[],
  date: string,
  session: string,
): number {
  const used = relevantOrders(orders, date, session).reduce((sum, order) => sum + usedCameraQty(order, cameraId), 0);
  return Math.max(0, totalQty - used);
}

export function getAvailableAccessoryQty(
  accessoryName: string,
  totalQty: number,
  orders: BookingOrder[],
  date: string,
  session: string,
): number {
  const used = relevantOrders(orders, date, session).reduce(
    (sum, order) => sum + usedAccessoryQty(order, accessoryName),
    0,
  );
  return Math.max(0, totalQty - used);
}

function validateAvailability(
  request: BookingRequest,
  catalog: { cameras: Camera[]; accessories: Accessory[] },
  orders: BookingOrder[],
): void {
  const rental = requireRental(request);
  const dateRange = getDateRange(rental.date, rental.days);

  for (const item of request.items?.cameras || []) {
    const camera = catalog.cameras.find((cam) => item.id !== undefined && pricingInternals.sameId(cam.id, item.id));
    if (!camera) throw new HttpError(400, `Camera ${item.id ?? ""} was not found`);

    const needed = pricingInternals.normalizeQty(item.qty);
    const minAvailable = Math.min(
      ...dateRange.map((date) =>
        getAvailableCameraQty(camera.id, Number(camera.qty || 1), orders, date, rental.session),
      ),
    );

    if (minAvailable < needed) {
      throw new HttpError(409, `Camera "${camera.name}" is not available for the selected schedule`, {
        item: camera.name,
        available: minAvailable,
        needed,
      });
    }
  }

  for (const item of request.items?.accessories || []) {
    const accessory = catalog.accessories.find((acc) => {
      if (item.id !== undefined && acc.id !== undefined && pricingInternals.sameId(acc.id, item.id)) return true;
      return !!item.name && acc.name === item.name;
    });
    if (!accessory) throw new HttpError(400, `Accessory ${item.id ?? item.name ?? ""} was not found`);

    const needed = pricingInternals.normalizeQty(item.qty);
    const minAvailable = Math.min(
      ...dateRange.map((date) =>
        getAvailableAccessoryQty(accessory.name, Number(accessory.qty || 0), orders, date, rental.session),
      ),
    );

    if (minAvailable < needed) {
      throw new HttpError(409, `Accessory "${accessory.name}" is not available for the selected schedule`, {
        item: accessory.name,
        available: minAvailable,
        needed,
      });
    }
  }
}

function buildPricingFromData(
  request: BookingRequest,
  catalog: { cameras: Camera[]; accessories: Accessory[]; deliveryFees: Array<{ name: string; fee: number }> },
  discounts: Discount[],
): PricingBreakdown {
  const subtotalBreakdown = calculateSubtotal(request, catalog.cameras, catalog.accessories);
  const deliveryFee = resolveDeliveryFee(request, catalog.deliveryFees);
  const discountResult = applyDiscounts(request, discounts, subtotalBreakdown.subtotal, deliveryFee);
  const discountAmt = discountResult.rentalDiscountAmt + discountResult.deliveryDiscountAmt;

  return {
    ...subtotalBreakdown,
    deliveryFee,
    rentalDiscountAmt: discountResult.rentalDiscountAmt,
    deliveryDiscountAmt: discountResult.deliveryDiscountAmt,
    discountAmt,
    total: Math.max(0, subtotalBreakdown.subtotal - discountResult.rentalDiscountAmt + deliveryFee - discountResult.deliveryDiscountAmt),
    appliedDiscounts: discountResult.appliedDiscounts,
  };
}

async function rollbackDiscountUsage(repo: Repository, discountIds: Id[]): Promise<void> {
  for (const discountId of discountIds) {
    for (let tries = 0; tries < 3; tries += 1) {
      const meta = await getJsonValueWithMeta<Discount[]>(repo, STORE_KEYS.discounts);
      const discounts = arrayOrEmpty<Discount>(meta.value);
      const next = discounts.map((discount) =>
        pricingInternals.sameId(discount.id, discountId)
          ? { ...discount, usedCount: Math.max(0, (discount.usedCount || 0) - 1) }
          : discount,
      );

      const result = await casJsonValue(repo, STORE_KEYS.discounts, next, meta.updatedAt);
      if (result.ok) break;
    }
  }
}

async function reserveDiscounts(
  repo: Repository,
  request: BookingRequest,
  catalog: { cameras: Camera[]; accessories: Accessory[]; deliveryFees: Array<{ name: string; fee: number }> },
): Promise<{ pricing: PricingBreakdown; reservedIds: Id[] }> {
  const requestedCodes = request.discountCodes || [];
  if (requestedCodes.length === 0) {
    return {
      pricing: buildPricingFromData(request, catalog, []),
      reservedIds: [],
    };
  }

  const reservedIds: Id[] = [];

  try {
    for (let reserveAttempt = 0; reserveAttempt < 5; reserveAttempt += 1) {
      const meta = await getJsonValueWithMeta<Discount[]>(repo, STORE_KEYS.discounts);
      const liveDiscounts = arrayOrEmpty<Discount>(meta.value);
      const pricing = buildPricingFromData(request, catalog, liveDiscounts);

      const nextDiscounts = liveDiscounts.map((discount) => {
        const used = pricing.appliedDiscounts.find((item) => pricingInternals.sameId(item.id, discount.id));
        return used ? { ...discount, usedCount: (discount.usedCount || 0) + 1 } : discount;
      });

      const result = await casJsonValue(repo, STORE_KEYS.discounts, nextDiscounts, meta.updatedAt);
      if (result.ok) {
        reservedIds.push(...pricing.appliedDiscounts.map((item) => item.id));
        return { pricing, reservedIds };
      }
    }

    throw new HttpError(409, "Discount codes are being used concurrently. Please try again.");
  } catch (error) {
    await rollbackDiscountUsage(repo, reservedIds);
    throw error;
  }
}

function buildOrder(
  request: BookingRequest,
  pricing: PricingBreakdown,
  existingOrders: BookingOrder[],
): BookingOrder {
  const customer = requireCustomer(request);
  const rental = requireRental(request);
  const firstCamera = pricing.cameras[0];
  const deliveryType = request.delivery?.type === "selfPickup" ? "selfPickup" : request.delivery?.ward ? "delivery" : "";
  const address =
    deliveryType === "selfPickup"
      ? "Shop 92 KA ME RA (tự đến shop nhận)"
      : [request.delivery?.street, request.delivery?.ward, request.delivery?.district].filter(Boolean).join(", ") ||
        customer.address;

  const appliedDiscounts = pricing.appliedDiscounts.map((discount) => ({
    code: discount.code,
    scope: discount.scope,
    amt: discount.discountAmt,
  }));

  return {
    id: newOrderId(existingOrders),
    submitKey: request.submitKey || `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cameraId: firstCamera?.id,
    cameraName: pricing.cameras.map((camera) => `${camera.name}${camera.qty > 1 ? ` x${camera.qty}` : ""}`).join(", "),
    cameras: pricing.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      qty: camera.qty,
      price: camera.unitPrice,
    })),
    accessories: pricing.accessories.map((accessory) =>
      accessory.qty > 1 ? `${accessory.name} x${accessory.qty}` : accessory.name,
    ),
    accessoriesDetail: pricing.accessories.map((accessory) => ({
      name: accessory.name,
      qty: accessory.qty,
    })),
    days: rental.days,
    subtotal: pricing.subtotal,
    discountCode: appliedDiscounts[0]?.code || null,
    discountAmt: pricing.discountAmt,
    rentalDiscountAmt: pricing.rentalDiscountAmt,
    deliveryDiscountAmt: pricing.deliveryDiscountAmt,
    appliedDiscounts,
    total: pricing.total,
    session: rental.session,
    shift: rental.days === 0.5 && rental.session !== "full" ? rental.session : null,
    createdAt: new Date().toISOString(),
    ...customer,
    address,
    deliveryWard: request.delivery?.ward || "",
    deliveryDistrict: request.delivery?.district || "",
    deliveryType,
    deliveryFee: pricing.deliveryFee,
    status: "pending",
    date: rental.date,
    seen: false,
    userPhone: customer.phone,
    userEmail: customer.email,
  };
}

export async function createBooking(repo: Repository, request: BookingRequest): Promise<BookingOrder> {
  requireCustomer(request);
  requireRental(request);

  const catalog = await getCatalogData(repo);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { pricing, reservedIds } = await reserveDiscounts(repo, request, catalog);

    try {
      const meta = await getJsonValueWithMeta<BookingOrder[]>(repo, STORE_KEYS.orders);
      const liveOrders = arrayOrEmpty<BookingOrder>(meta.value);
      const existingBySubmitKey = request.submitKey
        ? liveOrders.find((order) => order.submitKey === request.submitKey)
        : undefined;

      if (existingBySubmitKey) {
        await rollbackDiscountUsage(repo, reservedIds);
        return existingBySubmitKey;
      }

      validateAvailability(request, catalog, liveOrders);

      const order = buildOrder(request, pricing, liveOrders);
      const result = await casJsonValue(repo, STORE_KEYS.orders, [{ ...order, seen: false }, ...liveOrders], meta.updatedAt);

      if (result.ok) return order;
    } catch (error) {
      await rollbackDiscountUsage(repo, reservedIds);
      throw error;
    }

    await rollbackDiscountUsage(repo, reservedIds);
  }

  throw new HttpError(409, "Booking data changed while saving. Please try again.");
}

export async function listBookings(
  repo: Repository,
  filters: { status?: string; from?: string; to?: string; q?: string } = {},
): Promise<BookingOrder[]> {
  const orders = arrayOrEmpty<BookingOrder>(await getJsonValue<BookingOrder[]>(repo, STORE_KEYS.orders));
  const q = filters.q?.trim().toLowerCase();

  return orders
    .filter((order) => (filters.status ? order.status === filters.status : true))
    .filter((order) => (filters.from ? order.date >= filters.from : true))
    .filter((order) => (filters.to ? order.date <= filters.to : true))
    .filter((order) => {
      if (!q) return true;
      return [order.id, order.name, order.phone, order.cameraName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    })
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

export async function updateBookingStatus(
  repo: Repository,
  orderId: string,
  status: string,
): Promise<BookingOrder> {
  if (!ALLOWED_STATUS.has(status)) throw new HttpError(400, "Invalid booking status");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const meta = await getJsonValueWithMeta<BookingOrder[]>(repo, STORE_KEYS.orders);
    const orders = arrayOrEmpty<BookingOrder>(meta.value);
    const order = orders.find((item) => item.id === orderId);
    if (!order) throw new HttpError(404, "Booking was not found");

    const nextOrder = {
      ...order,
      status,
      seen: true,
      updatedAt: new Date().toISOString(),
    };

    const nextOrders = orders.map((item) => (item.id === orderId ? nextOrder : item));
    const result = await casJsonValue(repo, STORE_KEYS.orders, nextOrders, meta.updatedAt);
    if (result.ok) {
      if (status === "cancelled" && order.status !== "cancelled" && Array.isArray(order.appliedDiscounts)) {
        const discounts = arrayOrEmpty<Discount>(await getJsonValue<Discount[]>(repo, STORE_KEYS.discounts));
        const idsToRollback = discounts
          .filter((discount) => order.appliedDiscounts.some((applied) => applied.code === discount.code.toUpperCase()))
          .map((discount) => discount.id);
        await rollbackDiscountUsage(repo, idsToRollback);
      }
      return nextOrder;
    }
  }

  throw new HttpError(409, "Booking status changed while saving. Please try again.");
}

export async function getAvailability(
  repo: Repository,
  params: { date: string; days?: number; session?: string },
) {
  const date = params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD");

  const days = Number(params.days || 1);
  const session = normalizeSession(params.session);
  const catalog = await getCatalogData(repo);
  const orders = arrayOrEmpty<BookingOrder>(await getJsonValue<BookingOrder[]>(repo, STORE_KEYS.orders));
  const dateRange = getDateRange(date, days);

  return {
    date,
    days,
    session,
    cameras: catalog.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      totalQty: Number(camera.qty || 1),
      availableQty: Math.min(
        ...dateRange.map((day) => getAvailableCameraQty(camera.id, Number(camera.qty || 1), orders, day, session)),
      ),
    })),
    accessories: catalog.accessories.map((accessory) => ({
      id: accessory.id,
      name: accessory.name,
      totalQty: Number(accessory.qty || 0),
      availableQty: Math.min(
        ...dateRange.map((day) =>
          getAvailableAccessoryQty(accessory.name, Number(accessory.qty || 0), orders, day, session),
        ),
      ),
    })),
  };
}

export { dateAddDays };
