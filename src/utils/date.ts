import type { CaId, CaSlot } from "../types/domain.js";

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dateAddDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + (days < 1 ? 0 : Math.ceil(days)));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getDateRange(startDate: string, days: number): string[] {
  if (days < 1) return [startDate];
  const range: string[] = [];
  for (let i = 0; i < Math.ceil(days); i += 1) {
    range.push(dateAddDays(startDate, i));
  }
  return range;
}

export function isDateInOrder(dateStr: string, order: { date?: unknown; days?: unknown }): boolean {
  if (typeof order.date !== "string") return false;
  const days = Number(order.days);
  if (!Number.isFinite(days) || days <= 0) return false;
  const endDate = dateAddDays(order.date, days);
  if (days < 1) return dateStr >= order.date && dateStr <= endDate;
  return dateStr >= order.date && dateStr < endDate;
}

export function getOrderSession(order: { session?: unknown; shift?: unknown }): "morning" | "afternoon" | "full" {
  if (order.session === "morning" || order.session === "afternoon" || order.session === "full") {
    return order.session;
  }
  if (order.shift === "morning" || order.shift === "afternoon") {
    return order.shift;
  }
  return "full";
}

export function sessionsConflict(orderSession: string, targetSession: string): boolean {
  if (orderSession === "full" || targetSession === "full") return true;
  return orderSession === targetSession;
}

// ─── Ca logic ─────────────────────────────────────────────────────────────────

export const CA_CONFIG: Record<CaId, { start: number; end: number; label: string }> = {
  1: { start: 7,  end: 12, label: "07:00–12:00" },
  2: { start: 12, end: 17, label: "12:00–17:00" },
  3: { start: 17, end: 20, label: "17:00–20:00" },
};

// Parse "HH:MM" → số giờ
export function parseHour(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

// Xác định ca từ giờ nhận
export function getCaFromPickupHour(h: number): CaId {
  if (h < 12) return 1;
  if (h < 17) return 2;
  return 3;
}

// Xác định ca từ giờ trả
// Trả đúng/trước 12:00 → kết thúc Ca 1
// Trả đúng/trước 17:00 → kết thúc Ca 2
// Trả đúng/trước 20:00 → kết thúc Ca 3
// Trả sau 20:00 → kết thúc Ca 3 + thêm Ca 1 hôm sau (isOvernight = true)
export function getCaFromReturnHour(h: number): { caEnd: CaId; isOvernight: boolean } {
  if (h <= 12) return { caEnd: 1, isOvernight: false };
  if (h <= 17) return { caEnd: 2, isOvernight: false };
  if (h <= 20) return { caEnd: 3, isOvernight: false };
  return { caEnd: 3, isOvernight: true }; // trả sau 20:00 → tính thêm Ca 1 sáng hôm sau
}

// Validate giờ nhận/trả
export function validateGioNhanTra(gioNhan: string, gioTra: string, soNgay: number): void {
  const hNhan = parseHour(gioNhan);
  const hTra  = parseHour(gioTra);

  if (hNhan < 7 || hNhan > 20) {
    throw new Error("Giờ nhận phải từ 07:00 đến 20:00");
  }
  if (hTra < 7) {
    throw new Error("Giờ trả phải từ 07:00 trở lên");
  }
  // Nếu cùng ngày, giờ trả phải sau giờ nhận
  if (soNgay === 1 && hTra <= hNhan) {
    throw new Error("Giờ trả phải sau giờ nhận");
  }
}

// Tính danh sách ca bị khoá cho 1 máy trong 1 đơn
export function tinhCaKhoa(
  maMay: string,
  ngayNhan: string,
  gioNhan: string,
  soNgay: number,
  gioTra: string,
): CaSlot[] {
  const slots: CaSlot[] = [];
  const hNhan = parseHour(gioNhan);
  const hTra  = parseHour(gioTra);
  const caStart = getCaFromPickupHour(hNhan);
  const { caEnd, isOvernight } = getCaFromReturnHour(hTra);

  if (soNgay === 1) {
    // Cùng 1 ngày: từ caStart đến caEnd
    for (let ca = caStart; ca <= caEnd; ca++) {
      slots.push({ ngay: ngayNhan, ca: ca as CaId, maMay });
    }
    // Trả sau 20:00 → tính thêm Ca 1 sáng hôm sau
    if (isOvernight) {
      slots.push({ ngay: dateAddDays(ngayNhan, 1), ca: 1, maMay });
    }
  } else {
    // Ngày đầu: từ caStart đến Ca 3
    for (let ca = caStart; ca <= 3; ca++) {
      slots.push({ ngay: ngayNhan, ca: ca as CaId, maMay });
    }
    // Ngày giữa: khoá cả 3 ca
    for (let d = 1; d < soNgay - 1; d++) {
      const ngay = dateAddDays(ngayNhan, d);
      for (let ca = 1; ca <= 3; ca++) {
        slots.push({ ngay, ca: ca as CaId, maMay });
      }
    }
    // Ngày cuối: từ Ca 1 đến caEnd
    const ngayCuoi = dateAddDays(ngayNhan, soNgay - 1);
    for (let ca = 1; ca <= caEnd; ca++) {
      slots.push({ ngay: ngayCuoi, ca: ca as CaId, maMay });
    }
    // Trả sau 20:00 → tính thêm Ca 1 sáng ngày hôm sau ngày cuối
    if (isOvernight) {
      slots.push({ ngay: dateAddDays(ngayNhan, soNgay), ca: 1, maMay });
    }
  }

  return slots;
}

// Đếm số ca để tính tiền
export function countCa(
  ngayNhan: string,
  gioNhan: string,
  soNgay: number,
  gioTra: string,
): number {
  // Dùng lại tinhCaKhoa nhưng không cần maMay
  return tinhCaKhoa("_", ngayNhan, gioNhan, soNgay, gioTra).length;
}

// Tính tiền theo ca (giá máy / 3 * số ca)
export function tinhTienTheoCa(totalCa: number, giaMayTheoNgay: number): number {
  return Math.round((giaMayTheoNgay / 3) * totalCa);
}

// Check trùng ca giữa đơn mới và danh sách đơn đang active
// Trả về danh sách slot bị trùng (rỗng = không trùng)
export function checkTrungCa(
  slotsNew: CaSlot[],
  existingOrders: Array<{ caSlots?: CaSlot[]; status: string; id: string }>,
  excludeOrderId?: string, // dùng khi edit đơn
): CaSlot[] {
  const ACTIVE = new Set(["pending", "confirmed", "active"]);

  // Gom tất cả ca đang bị khoá từ đơn active
  const lockedSet = new Set<string>();
  for (const order of existingOrders) {
    if (!ACTIVE.has(order.status)) continue;
    if (excludeOrderId && order.id === excludeOrderId) continue;
    if (!Array.isArray(order.caSlots)) continue;
    for (const slot of order.caSlots) {
      lockedSet.add(`${slot.maMay}|${slot.ngay}|${slot.ca}`);
    }
  }

  // Check từng slot mới có bị trùng không
  return slotsNew.filter((slot) =>
    lockedSet.has(`${slot.maMay}|${slot.ngay}|${slot.ca}`)
  );
}
