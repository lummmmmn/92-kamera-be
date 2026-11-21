import type {
  Accessory,
  AppliedDiscount,
  BookingItemInput,
  BookingOrder,
  BookingRequest,
  Camera,
  DeliveryFee,
  Discount,
  PricingBreakdown,
} from "../types/domain.js";
import type { Repository } from "../types/repository.js";
import { STORE_KEYS } from "../config/storeKeys.js";
import { HttpError } from "../utils/httpError.js";
import { getCatalogData } from "./catalog.service.js";
import { arrayOrEmpty, getJsonValue } from "./storage.service.js";

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeQty(value: unknown): number {
  const parsed = Math.floor(asNumber(value, 1));
  return parsed > 0 ? parsed : 1;
}

function sameId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}

function findCamera(cameras: Camera[], item: BookingItemInput): Camera {
  const camera = cameras.find((cam) => item.id !== undefined && sameId(cam.id, item.id));
  if (!camera) throw new HttpError(400, `Camera ${item.id ?? ""} was not found`);
  if (camera.status && camera.status !== "available") {
    throw new HttpError(409, `Camera "${camera.name}" is not available`);
  }
  return camera;
}

function findAccessory(accessories: Accessory[], item: BookingItemInput): Accessory {
  const accessory = accessories.find((acc) => {
    if (item.id !== undefined && acc.id !== undefined && sameId(acc.id, item.id)) return true;
    return !!item.name && String(acc.name ?? "").trim() === String(item.name).trim();
  });

  if (!accessory) throw new HttpError(400, `Accessory ${item.id ?? item.name ?? ""} was not found`);
  if (accessory.active === false) throw new HttpError(409, `Accessory "${accessory.name}" is not available`);
  return accessory;
}

export function resolveDeliveryFee(request: BookingRequest, deliveryFees: DeliveryFee[]): number {
  if (request.delivery?.type === "selfPickup") return 0;
  if (typeof request.delivery?.fee === "number" && request.delivery.fee >= 0) return request.delivery.fee;

  const ward = request.delivery?.ward;
  if (!ward) return 0;

  return deliveryFees.find((fee) => fee.name === ward)?.fee || 0;
}

export function calculateSubtotal(
  request: BookingRequest,
  cameras: Camera[],
  accessories: Accessory[],
): Pick<PricingBreakdown, "cameras" | "accessories" | "subtotal"> {
  const days = asNumber(request.rental?.days, 1);
  if (days <= 0) throw new HttpError(400, "rental.days must be greater than 0");

  const cameraItems = request.items?.cameras || [];
  const accessoryItems = request.items?.accessories || [];

  const selectedCameras = cameraItems.map((item) => {
    const camera = findCamera(cameras, item);
    const qty = normalizeQty(item.qty);
    const unitPrice = asNumber(camera.price);
    return {
      id: camera.id,
      name: camera.name,
      qty,
      unitPrice,
      days,
      amount: unitPrice * qty * days,
    };
  });

  const selectedAccessories = accessoryItems.map((item) => {
    const accessory = findAccessory(accessories, item);
    const qty = normalizeQty(item.qty);
    const isHalfDay = days === 0.5;
    const unitPrice = isHalfDay
      ? accessory.priceShift != null
        ? asNumber(accessory.priceShift)
        : Math.round(asNumber(accessory.price) / 2)
      : asNumber(accessory.price);
    const multiplier = isHalfDay ? 1 : days;

    return {
      name: accessory.name,
      qty,
      unitPrice,
      multiplier,
      amount: unitPrice * qty * multiplier,
    };
  });

  if (selectedCameras.length === 0 && selectedAccessories.length === 0) {
    throw new HttpError(400, "At least one camera or accessory is required");
  }

  const subtotal =
    selectedCameras.reduce((sum, item) => sum + item.amount, 0) +
    selectedAccessories.reduce((sum, item) => sum + item.amount, 0);

  return { cameras: selectedCameras, accessories: selectedAccessories, subtotal };
}

// ─── Ngữ cảnh kiểm tra mã giảm giá (minDays / hạng khách) ────────────────────
export type DiscountContact = { phone?: string; email?: string; userPhone?: string; userEmail?: string };

export type DiscountContext = {
  /** Số ngày thuê của đơn — dùng cho điều kiện minDays */
  days?: number;
  /** Toàn bộ đơn hiện có — dùng để tính hạng khách (requiredBadge) */
  orders?: BookingOrder[];
  /** Thông tin liên hệ khách — để khớp đơn cũ của khách */
  contact?: DiscountContact;
};

function normalizePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("84") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

type CustomerStats = { orderCount: number; totalDays: number; totalSpent: number };

function computeCustomerStats(orders: BookingOrder[], contact: DiscountContact): CustomerStats {
  const phones = [contact.phone, contact.userPhone].map(normalizePhone).filter(Boolean);
  const emails = [contact.email, contact.userEmail].map(normalizeEmail).filter(Boolean);
  const stats: CustomerStats = { orderCount: 0, totalDays: 0, totalSpent: 0 };
  if (phones.length === 0 && emails.length === 0) return stats;

  for (const order of orders) {
    if (order.status === "cancelled") continue;
    const orderPhones = [order.phone, order.userPhone].map(normalizePhone).filter(Boolean);
    const orderEmails = [order.email, order.userEmail].map(normalizeEmail).filter(Boolean);
    const matched = phones.some((p) => orderPhones.includes(p)) || emails.some((e) => orderEmails.includes(e));
    if (!matched) continue;

    stats.orderCount += 1;
    stats.totalDays += asNumber(order.days, 0);
    stats.totalSpent += asNumber(order.total, 0);
  }
  return stats;
}

// Phải khớp với logic hạng khách ở frontend (useBooking.js)
const BADGE_RULES: Record<string, { label: string; ok: (s: CustomerStats) => boolean }> = {
  dong: { label: "Khách Đồng (cần 1+ đơn)", ok: (s) => s.orderCount >= 1 },
  bac: { label: "Khách Bạc (cần 3+ đơn)", ok: (s) => s.orderCount >= 3 },
  vang: { label: "Khách Vàng (cần 5+ đơn)", ok: (s) => s.orderCount >= 5 },
  daigiadagia: { label: "Đại Gia (cần 30+ ngày thuê)", ok: (s) => s.totalDays >= 30 },
  vip: { label: "Khách VIP (cần chi 5,000,000đ+)", ok: (s) => s.totalSpent >= 5_000_000 },
  kimcuong: { label: "Kim Cương (cần chi 10,000,000đ+)", ok: (s) => s.totalSpent >= 10_000_000 },
};

function normalizeDiscountCodes(codes: unknown): string[] {
  if (!Array.isArray(codes)) return [];

  const seen = new Set<string>();
  return codes
    .map((code) => (typeof code === "string" ? code.trim().toUpperCase() : ""))
    .filter((code) => {
      if (!code || seen.has(code)) return false;
      seen.add(code);
      return true;
    })
    .slice(0, 2);
}

export function applyDiscounts(
  request: BookingRequest,
  discounts: Discount[],
  subtotal: number,
  deliveryFee: number,
  ctx: DiscountContext = {},
): {
  appliedDiscounts: AppliedDiscount[];
  rentalDiscountAmt: number;
  deliveryDiscountAmt: number;
  totalDiscountAmt: number;
} {
  const codes = normalizeDiscountCodes(request.discountCodes);
  const appliedDiscounts: AppliedDiscount[] = [];

  for (const code of codes) {
    const discount = discounts.find((item) => item.code.toUpperCase() === code && item.active === true);
    if (!discount) throw new HttpError(400, `Mã "${code}" không tồn tại hoặc đã bị tắt`);
    if (discount.maxUse && (discount.usedCount || 0) >= discount.maxUse) {
      throw new HttpError(409, `Mã "${code}" đã dùng hết số lượt`);
    }
    if (discount.minOrder && subtotal < discount.minOrder) {
      throw new HttpError(400, `Mã "${code}" yêu cầu đơn tối thiểu ${discount.minOrder.toLocaleString("vi-VN")}đ`);
    }

    const minDays = asNumber(discount.minDays, 0);
    if (minDays > 0 && asNumber(ctx.days, 0) < minDays) {
      throw new HttpError(400, `Mã "${code}" yêu cầu thuê tối thiểu ${minDays} ngày`);
    }

    const requiredBadge = typeof discount.requiredBadge === "string" ? discount.requiredBadge : "none";
    if (requiredBadge && requiredBadge !== "none") {
      const rule = BADGE_RULES[requiredBadge];
      const stats = computeCustomerStats(ctx.orders || [], ctx.contact || {});
      if (!rule || !rule.ok(stats)) {
        throw new HttpError(400, `Mã "${code}" chỉ dành cho ${rule ? rule.label : "hạng khách đặc biệt"}`);
      }
    }

    const scope = (discount as { totalScope?: boolean }).totalScope
      ? "total"
      : discount.voucherScope === "delivery"
        ? "delivery"
        : "rental";

    if (appliedDiscounts.some((item) => item.scope === scope)) {
      throw new HttpError(400, `Mỗi loại chỉ được dùng 1 mã (${scope})`);
    }
    if (scope === "total" && appliedDiscounts.length > 0) {
      throw new HttpError(400, `Mã "${code}" (giảm tổng đơn) không dùng chung với mã khác`);
    }
    if (scope !== "total" && appliedDiscounts.some((item) => item.scope === "total")) {
      throw new HttpError(400, `Đang dùng mã giảm tổng đơn — không thể thêm mã "${code}"`);
    }
    if (scope === "delivery" && deliveryFee <= 0) {
      throw new HttpError(400, `Mã "${code}" chỉ áp dụng khi đơn có phí giao nhận`);
    }

    const base = scope === "delivery" ? deliveryFee : scope === "total" ? subtotal + deliveryFee : subtotal;
    const rawAmount = discount.type === "percent" ? Math.round((base * discount.value) / 100) : discount.value;
    const discountAmt = Math.min(Math.max(0, rawAmount), base);

    appliedDiscounts.push({
      id: discount.id,
      code: discount.code.toUpperCase(),
      type: discount.type,
      value: discount.value,
      scope,
      discountAmt,
    });
  }

  return {
    appliedDiscounts,
    rentalDiscountAmt: appliedDiscounts
      .filter((item) => item.scope === "rental")
      .reduce((sum, item) => sum + item.discountAmt, 0),
    deliveryDiscountAmt: appliedDiscounts
      .filter((item) => item.scope === "delivery")
      .reduce((sum, item) => sum + item.discountAmt, 0),
    totalDiscountAmt: appliedDiscounts
      .filter((item) => item.scope === "total")
      .reduce((sum, item) => sum + item.discountAmt, 0),
  };
}

export async function estimatePricing(repo: Repository, request: BookingRequest): Promise<PricingBreakdown> {
  const catalog = await getCatalogData(repo);
  const subtotalBreakdown = calculateSubtotal(request, catalog.cameras, catalog.accessories);
  const deliveryFee = resolveDeliveryFee(request, catalog.deliveryFees);
  const orders = arrayOrEmpty<BookingOrder>(await getJsonValue<BookingOrder[]>(repo, STORE_KEYS.orders));
  const discounts = applyDiscounts(request, catalog.discounts, subtotalBreakdown.subtotal, deliveryFee, {
    days: asNumber(request.rental?.soNgay ?? request.rental?.days, 0),
    orders,
    contact: { phone: request.customer?.phone, email: request.customer?.email },
  });
  const discountAmt = discounts.rentalDiscountAmt + discounts.deliveryDiscountAmt + discounts.totalDiscountAmt;

  return {
    ...subtotalBreakdown,
    deliveryFee,
    rentalDiscountAmt: discounts.rentalDiscountAmt,
    deliveryDiscountAmt: discounts.deliveryDiscountAmt,
    totalDiscountAmt: discounts.totalDiscountAmt,
    discountAmt,
    total: Math.max(
      0,
      subtotalBreakdown.subtotal -
        discounts.rentalDiscountAmt +
        deliveryFee -
        discounts.deliveryDiscountAmt -
        discounts.totalDiscountAmt,
    ),
    appliedDiscounts: discounts.appliedDiscounts,
  };
}

export const pricingInternals = {
  asNumber,
  normalizeQty,
  sameId,
};
