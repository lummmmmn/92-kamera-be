import type {
  Accessory,
  AppliedDiscount,
  BookingItemInput,
  BookingRequest,
  Camera,
  DeliveryFee,
  Discount,
  PricingBreakdown,
} from "../types/domain.js";
import type { Repository } from "../types/repository.js";
import { HttpError } from "../utils/httpError.js";
import { getCatalogData } from "./catalog.service.js";

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
    return !!item.name && acc.name === item.name;
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
): {
  appliedDiscounts: AppliedDiscount[];
  rentalDiscountAmt: number;
  deliveryDiscountAmt: number;
} {
  const codes = normalizeDiscountCodes(request.discountCodes);
  const appliedDiscounts: AppliedDiscount[] = [];

  for (const code of codes) {
    const discount = discounts.find((item) => item.code.toUpperCase() === code && item.active === true);
    if (!discount) throw new HttpError(400, `Discount code "${code}" is invalid or disabled`);
    if (discount.maxUse && (discount.usedCount || 0) >= discount.maxUse) {
      throw new HttpError(409, `Discount code "${code}" has reached its usage limit`);
    }
    if (discount.minOrder && subtotal < discount.minOrder) {
      throw new HttpError(400, `Discount code "${code}" requires minimum order ${discount.minOrder}`);
    }

    const scope = discount.voucherScope === "delivery" ? "delivery" : "rental";
    if (appliedDiscounts.some((item) => item.scope === scope)) {
      throw new HttpError(400, `Only one ${scope} discount can be used`);
    }
    if (scope === "delivery" && deliveryFee <= 0) {
      throw new HttpError(400, `Discount code "${code}" requires delivery fee`);
    }

    const base = scope === "delivery" ? deliveryFee : subtotal;
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
  };
}

export async function estimatePricing(repo: Repository, request: BookingRequest): Promise<PricingBreakdown> {
  const catalog = await getCatalogData(repo);
  const subtotalBreakdown = calculateSubtotal(request, catalog.cameras, catalog.accessories);
  const deliveryFee = resolveDeliveryFee(request, catalog.deliveryFees);
  const discounts = applyDiscounts(request, catalog.discounts, subtotalBreakdown.subtotal, deliveryFee);
  const discountAmt = discounts.rentalDiscountAmt + discounts.deliveryDiscountAmt;

  return {
    ...subtotalBreakdown,
    deliveryFee,
    rentalDiscountAmt: discounts.rentalDiscountAmt,
    deliveryDiscountAmt: discounts.deliveryDiscountAmt,
    discountAmt,
    total: Math.max(0, subtotalBreakdown.subtotal - discounts.rentalDiscountAmt + deliveryFee - discounts.deliveryDiscountAmt),
    appliedDiscounts: discounts.appliedDiscounts,
  };
}

export const pricingInternals = {
  asNumber,
  normalizeQty,
  sameId,
};
