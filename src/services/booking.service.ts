import { STORE_KEYS } from "../config/storeKeys.js";
import type {
  Accessory,
  BookingOrder,
  BookingRequest,
  Camera,
  CaSlot,
  Discount,
  Id,
  PricingBreakdown,
} from "../types/domain.js";
import type { Repository } from "../types/repository.js";
import {
  checkTrungCa,
  countCa,
  dateAddDays,
  getDateRange,
  getOrderSession,
  isDateInOrder,
  parseHour,
  sessionsConflict,
  tinhCaKhoa,
  tinhTienTheoCa,
  todayStr,
  validateGioNhanTra,
} from "../utils/date.js";
import { HttpError } from "../utils/httpError.js";
import { getCatalogData } from "./catalog.service.js";
import {
  applyDiscounts,
  calculateSubtotal,
  pricingInternals,
  resolveDeliveryFee,
  type DiscountContact,
  type DiscountContext,
} from "./pricing.service.js";
import { arrayOrEmpty, casJsonValue, getJsonValue, getJsonValueWithMeta } from "./storage.service.js";

const ACTIVE_ORDER_STATUSES = new Set(["pending", "confirmed", "active"]);
const ALLOWED_STATUS = new Set(["pending", "confirmed", "active", "completed", "cancelled"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Detect xem request dùng hệ ca mới hay legacy session
function isCaBasedRequest(request: BookingRequest): boolean {
  return !!(request.rental?.ngayNhan && request.rental?.gioNhan && request.rental?.gioTra && request.rental?.soNgay);
}

// Parse rental info từ ca-based request
function requireRentalCa(request: BookingRequest): {
  ngayNhan: string;
  gioNhan: string;
  gioTra: string;
  soNgay: number;
} {
  const rental = request.rental || {};
  const ngayNhan = typeof rental.ngayNhan === "string" ? rental.ngayNhan : "";
  const gioNhan  = typeof rental.gioNhan  === "string" ? rental.gioNhan  : "";
  const gioTra   = typeof rental.gioTra   === "string" ? rental.gioTra   : "";
  const soNgay   = Number(rental.soNgay);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayNhan)) throw new HttpError(400, "rental.ngayNhan must be YYYY-MM-DD");
  if (ngayNhan < todayStr()) throw new HttpError(400, "rental.ngayNhan cannot be in the past");
  if (!/^\d{2}:\d{2}$/.test(gioNhan)) throw new HttpError(400, "rental.gioNhan must be HH:MM");
  if (!/^\d{2}:\d{2}$/.test(gioTra))  throw new HttpError(400, "rental.gioTra must be HH:MM");
  if (!Number.isFinite(soNgay) || soNgay < 1) throw new HttpError(400, "rental.soNgay must be >= 1");

  try {
    validateGioNhanTra(gioNhan, gioTra, soNgay);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }

  return { ngayNhan, gioNhan, gioTra, soNgay };
}

// Parse rental info từ legacy request (giữ nguyên để không break)
function requireRentalLegacy(request: BookingRequest): {
  date: string;
  days: number;
  session: "morning" | "afternoon" | "full";
} {
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

// ─── Ca-schedule-aware availability (dùng cho đơn FE gửi kèm caSchedule) ──────
// FE tính lịch theo từng ca (ca1/ca2/ca3) độc lập, nhưng validateLegacyAvailability
// cũ chỉ check theo date+session (session luôn = "full" do FE gửi cứng) → hễ máy
// có 1 đơn active bất kỳ trong ngày là bị chặn cả ngày, dù khác ca. Các hàm dưới
// đây tái tạo đúng logic ca-based mà FE đã dùng để hiển thị (utils/availability.js)
// để BE và FE thống nhất, tránh việc FE báo còn hàng nhưng BE vẫn từ chối.

type CaScheduleSlot = { date: string; ca: string };

function legacyCaForSession(session: string): string[] {
  if (session === "morning") return ["ca1"];
  if (session === "afternoon") return ["ca2", "ca3"];
  return ["ca1", "ca2", "ca3"];
}

export function getOrderCaSchedule(order: BookingOrder): CaScheduleSlot[] {
  const raw = (order as { caSchedule?: unknown }).caSchedule;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw as CaScheduleSlot[];
  }
  if (!order.date || !order.days) return [];
  const caList = legacyCaForSession(getOrderSession(order));
  const nDays = order.days < 1 ? 1 : Math.ceil(order.days);
  const out: CaScheduleSlot[] = [];
  for (let i = 0; i < nDays; i += 1) {
    const ds = dateAddDays(order.date, i);
    for (const ca of caList) out.push({ date: ds, ca });
  }
  return out;
}

function relevantOrdersByCa(orders: BookingOrder[], targetDate: string, targetCa: string): BookingOrder[] {
  return orders.filter((order) => {
    if (!ACTIVE_ORDER_STATUSES.has(order.status)) return false;
    return getOrderCaSchedule(order).some((slot) => slot.date === targetDate && slot.ca === targetCa);
  });
}

export function getAvailableCameraQtyByCa(
  cameraId: Id,
  totalQty: number,
  orders: BookingOrder[],
  targetDate: string,
  targetCa: string,
): number {
  const used = relevantOrdersByCa(orders, targetDate, targetCa).reduce(
    (sum, order) => sum + usedCameraQty(order, cameraId),
    0,
  );
  return Math.max(0, totalQty - used);
}

export function getAvailableAccessoryQtyByCa(
  accessoryName: string,
  totalQty: number,
  orders: BookingOrder[],
  targetDate: string,
  targetCa: string,
): number {
  const used = relevantOrdersByCa(orders, targetDate, targetCa).reduce(
    (sum, order) => sum + usedAccessoryQty(order, accessoryName),
    0,
  );
  return Math.max(0, totalQty - used);
}

// ─── Check availability ───────────────────────────────────────────────────────

function validateAvailabilityLegacy(
  request: BookingRequest,
  catalog: { cameras: Camera[]; accessories: Accessory[] },
  orders: BookingOrder[],
): void {
  const rental = requireRentalLegacy(request);
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
      return !!item.name && String(acc.name ?? "").trim() === String(item.name).trim();
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

// Check trùng ca cho ca-based booking
function validateAvailabilityCa(
  request: BookingRequest,
  catalog: { cameras: Camera[] },
  orders: BookingOrder[],
): { allSlots: CaSlot[] } {
  const rental = requireRentalCa(request);
  const allSlots: CaSlot[] = [];

  for (const item of request.items?.cameras || []) {
    const camera = catalog.cameras.find((cam) => item.id !== undefined && pricingInternals.sameId(cam.id, item.id));
    if (!camera) throw new HttpError(400, `Camera ${item.id ?? ""} was not found`);

    // Tính ca của máy này
    const maMay = String(camera.id);
    const slots = tinhCaKhoa(maMay, rental.ngayNhan, rental.gioNhan, rental.soNgay, rental.gioTra);

    // Check trùng với đơn đang active
    const trung = checkTrungCa(slots, orders);
    if (trung.length > 0) {
      const detail = trung.map((s) => `Ca ${s.ca} ngày ${s.ngay}`).join(", ");
      throw new HttpError(409, `Máy "${camera.name}" đã có lịch: ${detail}`, {
        item: camera.name,
        slotsTrung: trung,
      });
    }

    allSlots.push(...slots);
  }

  return { allSlots };
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

// Đơn theo ca: subtotal phải tính theo SỐ CA (giá/3 × số ca) ngay từ bước tính giảm giá,
// nếu không % giảm và minOrder sẽ bị tính trên subtotal theo ngày → lệch với tiền thật của đơn.
function withCaSubtotal(
  request: BookingRequest,
  breakdown: Pick<PricingBreakdown, "cameras" | "accessories" | "subtotal">,
): Pick<PricingBreakdown, "cameras" | "accessories" | "subtotal"> {
  const rental = requireRentalCa(request);
  const totalCa = countCa(rental.ngayNhan, rental.gioNhan, rental.soNgay, rental.gioTra);
  const subtotal =
    breakdown.cameras.reduce((sum, c) => sum + tinhTienTheoCa(totalCa, c.unitPrice) * c.qty, 0) +
    breakdown.accessories.reduce((sum, a) => sum + tinhTienTheoCa(totalCa, a.unitPrice) * a.qty, 0);
  return { ...breakdown, subtotal };
}

function buildPricingFromData(
  request: BookingRequest,
  catalog: { cameras: Camera[]; accessories: Accessory[]; deliveryFees: Array<{ name: string; fee: number }> },
  discounts: Discount[],
  ctx: DiscountContext = {},
): PricingBreakdown {
  const baseBreakdown = calculateSubtotal(request, catalog.cameras, catalog.accessories);
  const subtotalBreakdown = isCaBasedRequest(request) ? withCaSubtotal(request, baseBreakdown) : baseBreakdown;
  const deliveryFee = resolveDeliveryFee(request, catalog.deliveryFees);
  const discountResult = applyDiscounts(request, discounts, subtotalBreakdown.subtotal, deliveryFee, ctx);
  const discountAmt = discountResult.rentalDiscountAmt + discountResult.deliveryDiscountAmt + discountResult.totalDiscountAmt;

  return {
    ...subtotalBreakdown,
    deliveryFee,
    rentalDiscountAmt: discountResult.rentalDiscountAmt,
    deliveryDiscountAmt: discountResult.deliveryDiscountAmt,
    totalDiscountAmt: discountResult.totalDiscountAmt,
    discountAmt,
    total: Math.max(
      0,
      subtotalBreakdown.subtotal -
        discountResult.rentalDiscountAmt +
        deliveryFee -
        discountResult.deliveryDiscountAmt -
        discountResult.totalDiscountAmt,
    ),
    appliedDiscounts: discountResult.appliedDiscounts,
  };
}

export async function rollbackDiscountUsage(repo: Repository, discountIds: Id[]): Promise<void> {
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

// Cộng/trừ usedCount theo MÃ (dùng khi đổi trạng thái / xoá đơn). CAS + retry để không ghi đè nhau.
async function adjustDiscountUsageByCodes(repo: Repository, codes: string[], delta: 1 | -1): Promise<void> {
  const wanted = new Set(codes.map((code) => String(code).trim().toUpperCase()).filter(Boolean));
  if (wanted.size === 0) return;

  for (let tries = 0; tries < 5; tries += 1) {
    const meta = await getJsonValueWithMeta<Discount[]>(repo, STORE_KEYS.discounts);
    const discounts = arrayOrEmpty<Discount>(meta.value);
    let changed = false;
    const next = discounts.map((discount) => {
      if (!wanted.has(String(discount.code || "").toUpperCase())) return discount;
      changed = true;
      return { ...discount, usedCount: Math.max(0, (discount.usedCount || 0) + delta) };
    });
    if (!changed) return;

    const result = await casJsonValue(repo, STORE_KEYS.discounts, next, meta.updatedAt);
    if (result.ok) return;
  }
}

export function orderDiscountCodes(order: Pick<BookingOrder, "appliedDiscounts" | "discountCode">): string[] {
  const applied = Array.isArray(order.appliedDiscounts) ? order.appliedDiscounts.map((item) => item.code) : [];
  const raw = applied.length > 0 ? applied : order.discountCode ? [order.discountCode] : [];
  return Array.from(new Set(raw.map((code) => String(code).trim().toUpperCase()).filter(Boolean)));
}

// Quy tắc duy nhất: đơn "cancelled" thì KHÔNG chiếm lượt mã; đơn khác thì có.
// Gọi mỗi khi trạng thái đơn đổi (hoặc đơn bị xoá → truyền nextStatus = "cancelled").
export async function syncDiscountUsageOnStatusChange(
  repo: Repository,
  order: Pick<BookingOrder, "status" | "appliedDiscounts" | "discountCode">,
  nextStatus: string,
): Promise<void> {
  const wasCancelled = order.status === "cancelled";
  const willCancel = nextStatus === "cancelled";
  if (wasCancelled === willCancel) return;
  await adjustDiscountUsageByCodes(repo, orderDiscountCodes(order), willCancel ? -1 : 1);
}

export type LegacyDiscountPricing = {
  appliedDiscounts: Array<{ code: string; scope: "rental" | "delivery" | "total"; amt: number }>;
  discountCode: string | null;
  discountAmt: number;
  rentalDiscountAmt: number;
  deliveryDiscountAmt: number;
  totalDiscountAmt: number;
  total: number;
};

// Dùng cho POST /orders (flow FE đang chạy): server tự kiểm tra mã, tự tính lại số tiền giảm + total,
// và TĂNG usedCount bằng CAS (không tin bất kỳ con số giảm giá nào client gửi lên).
export async function reserveLegacyOrderDiscounts(
  repo: Repository,
  input: {
    codes: string[];
    subtotal: number;
    deliveryFee: number;
    days: number;
    orders: BookingOrder[];
    contact: DiscountContact;
  },
): Promise<{ pricing: LegacyDiscountPricing; reservedIds: Id[] }> {
  const subtotal = Math.max(0, input.subtotal);
  const deliveryFee = Math.max(0, input.deliveryFee);

  const toPricing = (
    applied: Array<{ code: string; scope: "rental" | "delivery" | "total"; discountAmt: number }>,
  ): LegacyDiscountPricing => {
    const sum = (scope: string) =>
      applied.filter((item) => item.scope === scope).reduce((acc, item) => acc + item.discountAmt, 0);
    const rentalDiscountAmt = sum("rental");
    const deliveryDiscountAmt = sum("delivery");
    const totalDiscountAmt = sum("total");
    const primary =
      applied.find((item) => item.scope === "rental") ||
      applied.find((item) => item.scope === "delivery") ||
      applied.find((item) => item.scope === "total");
    return {
      appliedDiscounts: applied.map((item) => ({ code: item.code, scope: item.scope, amt: item.discountAmt })),
      discountCode: primary?.code || null,
      discountAmt: rentalDiscountAmt + deliveryDiscountAmt + totalDiscountAmt,
      rentalDiscountAmt,
      deliveryDiscountAmt,
      totalDiscountAmt,
      total: Math.max(0, subtotal - rentalDiscountAmt + deliveryFee - deliveryDiscountAmt - totalDiscountAmt),
    };
  };

  if (input.codes.length === 0) return { pricing: toPricing([]), reservedIds: [] };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const meta = await getJsonValueWithMeta<Discount[]>(repo, STORE_KEYS.discounts);
    const liveDiscounts = arrayOrEmpty<Discount>(meta.value);
    const result = applyDiscounts({ discountCodes: input.codes }, liveDiscounts, subtotal, deliveryFee, {
      days: input.days,
      orders: input.orders,
      contact: input.contact,
    });

    const nextDiscounts = liveDiscounts.map((discount) =>
      result.appliedDiscounts.some((item) => pricingInternals.sameId(item.id, discount.id))
        ? { ...discount, usedCount: (discount.usedCount || 0) + 1 }
        : discount,
    );

    const saved = await casJsonValue(repo, STORE_KEYS.discounts, nextDiscounts, meta.updatedAt);
    if (saved.ok) {
      return { pricing: toPricing(result.appliedDiscounts), reservedIds: result.appliedDiscounts.map((item) => item.id) };
    }
  }

  throw new HttpError(409, "Mã giảm giá đang được nhiều người dùng cùng lúc, vui lòng thử lại.");
}

async function reserveDiscounts(
  repo: Repository,
  request: BookingRequest,
  catalog: { cameras: Camera[]; accessories: Accessory[]; deliveryFees: Array<{ name: string; fee: number }> },
  ctx: DiscountContext = {},
): Promise<{ pricing: PricingBreakdown; reservedIds: Id[] }> {
  const requestedCodes = request.discountCodes || [];
  if (requestedCodes.length === 0) {
    return { pricing: buildPricingFromData(request, catalog, [], ctx), reservedIds: [] };
  }

  const reservedIds: Id[] = [];

  try {
    for (let reserveAttempt = 0; reserveAttempt < 5; reserveAttempt += 1) {
      const meta = await getJsonValueWithMeta<Discount[]>(repo, STORE_KEYS.discounts);
      const liveDiscounts = arrayOrEmpty<Discount>(meta.value);
      const pricing = buildPricingFromData(request, catalog, liveDiscounts, ctx);

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

    throw new HttpError(409, "Mã giảm giá đang được nhiều người dùng cùng lúc, vui lòng thử lại.");
  } catch (error) {
    await rollbackDiscountUsage(repo, reservedIds);
    throw error;
  }
}

// ─── Build order object ───────────────────────────────────────────────────────

function buildOrderCa(
  request: BookingRequest,
  pricing: PricingBreakdown,
  existingOrders: BookingOrder[],
  caSlots: CaSlot[],
): BookingOrder {
  const customer = requireCustomer(request);
  const rental = requireRentalCa(request);
  const firstCamera = pricing.cameras[0];

  const totalCa = countCa(rental.ngayNhan, rental.gioNhan, rental.soNgay, rental.gioTra);

  // pricing.subtotal đã được tính theo ca (xem withCaSubtotal) và mã giảm giá cũng tính trên số này.
  const tongTienCa = pricing.subtotal;

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

  // Ngày kết thúc (để tương thích với date/days cũ)
  const ngayCuoi = dateAddDays(rental.ngayNhan, rental.soNgay - 1);
  const hTra = parseHour(rental.gioTra);
  const isOvernight = hTra > 20;

  return {
    id: newOrderId(existingOrders),
    submitKey: request.submitKey || `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

    // Ca-based fields
    ngayNhan: rental.ngayNhan,
    gioNhan: rental.gioNhan,
    gioTra: rental.gioTra,
    soNgay: rental.soNgay,
    totalCa,
    caSlots,

    // Legacy fields (giữ để UI cũ không bị break)
    date: rental.ngayNhan,
    days: rental.soNgay,
    session: "full" as const,

    cameraId: firstCamera?.id,
    cameraName: pricing.cameras.map((c) => `${c.name}${c.qty > 1 ? ` x${c.qty}` : ""}`).join(", "),
    cameras: pricing.cameras.map((c) => ({ id: c.id, name: c.name, qty: c.qty, price: c.unitPrice })),
    accessories: pricing.accessories.map((a) => (a.qty > 1 ? `${a.name} x${a.qty}` : a.name)),
    accessoriesDetail: pricing.accessories.map((a) => ({ name: a.name, qty: a.qty })),

    subtotal: tongTienCa, // override: tính theo ca
    discountCode: appliedDiscounts[0]?.code || null,
    discountAmt: pricing.discountAmt,
    rentalDiscountAmt: pricing.rentalDiscountAmt,
    deliveryDiscountAmt: pricing.deliveryDiscountAmt,
    appliedDiscounts,
    total: pricing.total,
    deliveryFee: pricing.deliveryFee,

    ...customer,
    address,
    deliveryWard: request.delivery?.ward || "",
    deliveryDistrict: request.delivery?.district || "",
    deliveryType,

    status: "pending",
    createdAt: new Date().toISOString(),
    seen: false,
    userPhone: customer.phone,
    userEmail: customer.email,
  };
}

function buildOrderLegacy(
  request: BookingRequest,
  pricing: PricingBreakdown,
  existingOrders: BookingOrder[],
): BookingOrder {
  const customer = requireCustomer(request);
  const rental = requireRentalLegacy(request);
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
    cameraName: pricing.cameras.map((c) => `${c.name}${c.qty > 1 ? ` x${c.qty}` : ""}`).join(", "),
    cameras: pricing.cameras.map((c) => ({ id: c.id, name: c.name, qty: c.qty, price: c.unitPrice })),
    accessories: pricing.accessories.map((a) => (a.qty > 1 ? `${a.name} x${a.qty}` : a.name)),
    accessoriesDetail: pricing.accessories.map((a) => ({ name: a.name, qty: a.qty })),
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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createBooking(repo: Repository, request: BookingRequest): Promise<BookingOrder> {
  const customer = requireCustomer(request);

  const useCa = isCaBasedRequest(request);
  const rentalDays = useCa ? requireRentalCa(request).soNgay : requireRentalLegacy(request).days;

  const catalog = await getCatalogData(repo);
  const discountCtx: DiscountContext = {
    days: rentalDays,
    orders: arrayOrEmpty<BookingOrder>(await getJsonValue<BookingOrder[]>(repo, STORE_KEYS.orders)),
    contact: { phone: customer.phone, email: customer.email },
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { pricing, reservedIds } = await reserveDiscounts(repo, request, catalog, discountCtx);

    try {
      const meta = await getJsonValueWithMeta<BookingOrder[]>(repo, STORE_KEYS.orders);
      const liveOrders = arrayOrEmpty<BookingOrder>(meta.value);

      // Idempotency check
      const existingBySubmitKey = request.submitKey
        ? liveOrders.find((order) => order.submitKey === request.submitKey)
        : undefined;
      if (existingBySubmitKey) {
        await rollbackDiscountUsage(repo, reservedIds);
        return existingBySubmitKey;
      }

      let order: BookingOrder;

      if (useCa) {
        // Ca-based: check trùng ca trước
        const { allSlots } = validateAvailabilityCa(request, catalog, liveOrders);
        order = buildOrderCa(request, pricing, liveOrders, allSlots);
      } else {
        // Legacy: check theo session cũ
        validateAvailabilityLegacy(request, catalog, liveOrders);
        order = buildOrderLegacy(request, pricing, liveOrders);
      }

      const result = await casJsonValue(
        repo,
        STORE_KEYS.orders,
        [{ ...order, seen: false }, ...liveOrders],
        meta.updatedAt,
      );

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
    const order = orders.find((item) => String(item.id) === String(orderId));
    if (!order) throw new HttpError(404, "Booking was not found");

    const nextOrder = { ...order, status, seen: true, updatedAt: new Date().toISOString() };
    const nextOrders = orders.map((item) => (String(item.id) === String(orderId) ? nextOrder : item));
    const result = await casJsonValue(repo, STORE_KEYS.orders, nextOrders, meta.updatedAt);

    if (result.ok) {
      await syncDiscountUsageOnStatusChange(repo, order, status);
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

// Route check ca trống (gọi từ frontend trước khi submit)
export async function checkCaAvailability(
  repo: Repository,
  params: {
    maMay: string;
    ngayNhan: string;
    gioNhan: string;
    soNgay: number;
    gioTra: string;
    giaTheoNgay?: number;
  },
) {
  const { maMay, ngayNhan, gioNhan, soNgay, gioTra, giaTheoNgay = 169000 } = params;

  validateGioNhanTra(gioNhan, gioTra, soNgay);

  const slots = tinhCaKhoa(maMay, ngayNhan, gioNhan, soNgay, gioTra);
  const orders = arrayOrEmpty<BookingOrder>(await getJsonValue<BookingOrder[]>(repo, STORE_KEYS.orders));
  const trung = checkTrungCa(slots, orders);

  if (trung.length > 0) {
    return { trung: true, slotsTrung: trung };
  }

  const totalCa = slots.length;
  const tongTien = tinhTienTheoCa(totalCa, giaTheoNgay);

  return { trung: false, totalCa, tongTien, slots };
}

export { dateAddDays };
