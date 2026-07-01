export type Id = string | number;

export type Camera = {
  id: Id;
  name: string;
  price: number;
  qty?: number;
  status?: string;
  images?: string[];
  imagesMeta?: unknown[];
  [key: string]: unknown;
};

export type Accessory = {
  id?: Id;
  name: string;
  price: number;
  priceShift?: number | null;
  qty?: number;
  active?: boolean;
  image?: string;
  imageMeta?: unknown;
  [key: string]: unknown;
};

export type Discount = {
  id: Id;
  code: string;
  type: "percent" | "fixed";
  value: number;
  minOrder?: number;
  maxUse?: number;
  usedCount?: number;
  active?: boolean;
  voucherScope?: "rental" | "delivery";
  requiredBadge?: string;
  [key: string]: unknown;
};

export type DeliveryFee = {
  name: string;
  fee: number;
};

// Ca thuê máy
// Ca 1 — Sáng:  07:00–12:00
// Ca 2 — Chiều: 12:00–17:00
// Ca 3 — Tối:   17:00–20:00
export type CaId = 1 | 2 | 3;

export type CaSlot = {
  ngay: string; // "YYYY-MM-DD"
  ca: CaId;
  maMay: string;
};

export type BookingOrder = {
  id: string;
  submitKey?: string;
  status: "pending" | "confirmed" | "active" | "completed" | "cancelled" | string;

  // --- Legacy fields (giữ nguyên để không break UI cũ) ---
  date: string;
  days: number;
  session: "morning" | "afternoon" | "full";
  shift?: "morning" | "afternoon" | null;

  // --- Ca-based fields (MỚI) ---
  // Nếu booking dùng hệ ca mới, các field này sẽ có giá trị
  ngayNhan?: string;   // "YYYY-MM-DD"
  gioNhan?: string;    // "HH:MM"
  gioTra?: string;     // "HH:MM"
  caStart?: CaId;      // ca nhận
  caEnd?: CaId;        // ca trả
  soNgay?: number;     // số ngày thuê (nguyên)
  totalCa?: number;    // tổng số ca tính tiền
  caSlots?: CaSlot[];  // danh sách ca bị khoá (để check trùng)

  cameraId?: Id;
  cameraName?: string;
  cameras?: Array<{ id: Id; name: string; qty: number; price: number }>;
  accessories?: string[];
  accessoriesDetail?: Array<{ name: string; qty: number }>;
  subtotal: number;
  discountCode?: string | null;
  discountAmt: number;
  rentalDiscountAmt: number;
  deliveryDiscountAmt: number;
  appliedDiscounts: Array<{ code: string; scope: "rental" | "delivery"; amt: number }>;
  total: number;
  deliveryFee: number;
  name: string;
  phone: string;
  zalo?: string;
  email?: string;
  address?: string;
  note?: string;
  userPhone?: string;
  userEmail?: string;
  createdAt: string;
  seen: boolean;
  [key: string]: unknown;
};

export type BookingItemInput = {
  id?: Id;
  name?: string;
  qty?: number;
};

export type BookingRequest = {
  submitKey?: string;
  customer?: {
    name?: string;
    phone?: string;
    zalo?: string;
    email?: string;
    address?: string;
    note?: string;
  };
  rental?: {
    // Legacy
    date?: string;
    days?: number;
    session?: "morning" | "afternoon" | "full";
    // Ca-based mới
    ngayNhan?: string;  // "YYYY-MM-DD"
    gioNhan?: string;   // "HH:MM"
    gioTra?: string;    // "HH:MM"
    soNgay?: number;    // số ngày thuê
  };
  items?: {
    cameras?: BookingItemInput[];
    accessories?: BookingItemInput[];
  };
  delivery?: {
    type?: "selfPickup" | "delivery" | string;
    street?: string;
    ward?: string;
    district?: string;
    fee?: number;
  };
  discountCodes?: string[];
};

export type AppliedDiscount = {
  id: Id;
  code: string;
  type: "percent" | "fixed";
  value: number;
  scope: "rental" | "delivery";
  discountAmt: number;
};

export type PricingBreakdown = {
  cameras: Array<{ id: Id; name: string; qty: number; unitPrice: number; days: number; amount: number }>;
  accessories: Array<{ name: string; qty: number; unitPrice: number; multiplier: number; amount: number }>;
  subtotal: number;
  deliveryFee: number;
  rentalDiscountAmt: number;
  deliveryDiscountAmt: number;
  discountAmt: number;
  total: number;
  appliedDiscounts: AppliedDiscount[];
};

export type User = {
  googleId: string;
  email?: string;
  name?: string;
  avatar?: string;
  phone?: string;
  provider?: "google";
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};
