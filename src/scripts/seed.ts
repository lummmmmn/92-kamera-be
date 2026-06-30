import "dotenv/config";
import fs from "node:fs/promises";
import { STORE_KEYS } from "../config/storeKeys.js";
import { getRepository } from "../repositories/index.js";
import type { Accessory, BookingOrder, Camera, DeliveryFee, Discount } from "../types/domain.js";
import type { GalleryPhotoInput } from "../types/repository.js";

type SeedFile = {
  cameras?: Camera[];
  accessories?: Accessory[];
  site?: Record<string, unknown>;
  feedbacks?: Record<string, unknown>[];
  discounts?: Discount[];
  albums?: Record<string, unknown>[];
  deliveryFees?: DeliveryFee[];
  photos?: GalleryPhotoInput[];
};

const now = new Date("2026-06-25T08:00:00.000Z");

function iso(daysAgo = 0, hoursAgo = 0): string {
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - hoursAgo * 60 * 60 * 1000).toISOString();
}

async function readSeedFile(): Promise<SeedFile> {
  try {
    const raw = await fs.readFile("data/seed.json", "utf8");
    return JSON.parse(raw) as SeedFile;
  } catch {
    return {};
  }
}

function mergeById<T extends { id?: string | number }>(base: T[], extra: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...base, ...extra]) {
    if (item.id == null) continue;
    map.set(String(item.id), item);
  }
  return Array.from(map.values());
}

function mergeByName<T extends { name?: string }>(base: T[], extra: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of [...base, ...extra]) {
    if (!item.name) continue;
    map.set(item.name, item);
  }
  return Array.from(map.values());
}

const cameraImages = [
  "https://images.unsplash.com/photo-1516035069371-29a1b244cc32",
  "https://images.unsplash.com/photo-1502920917128-1aa500764cbd",
  "https://images.unsplash.com/photo-1510127034890-ba27508e9f1c",
  "https://images.unsplash.com/photo-1495707902641-75cac588d2e9",
  "https://images.unsplash.com/photo-1520390138845-fd2d229dd553",
];

const extraCameras: Camera[] = [
  {
    id: 201,
    name: "Fujifilm X-S10 + XF 18-55mm",
    price: 180000,
    desc: "Bo may gon nhe, mau dep, phu hop chup du lich va street.",
    qty: 2,
    status: "available",
    icon: "camera",
    images: [cameraImages[0] as string],
  },
  {
    id: 202,
    name: "Sony A6400 + Sigma 30mm F1.4",
    price: 220000,
    desc: "Lay net nhanh, quay chup linh hoat, xoa phong tot.",
    qty: 1,
    status: "available",
    icon: "camera",
    images: [cameraImages[1] as string],
  },
  {
    id: 203,
    name: "Canon EOS M50 Mark II",
    price: 160000,
    desc: "De dung cho nguoi moi, man hinh lat, mau da on.",
    qty: 2,
    status: "available",
    icon: "camera",
    images: [cameraImages[2] as string],
  },
  {
    id: 204,
    name: "Nikon Z50 Kit",
    price: 190000,
    desc: "Than may chac, anh net, pin tot cho ca ngay.",
    qty: 1,
    status: "maintenance",
    icon: "camera",
    images: [cameraImages[3] as string],
  },
  {
    id: 205,
    name: "Sony ZV-E10 Vlog Kit",
    price: 210000,
    desc: "Toi uu vlog, livestream, quay video ngan.",
    qty: 2,
    status: "available",
    icon: "camera",
    images: [cameraImages[4] as string],
  },
];

const extraAccessories: Accessory[] = [
  {
    id: 301,
    name: "Tripod 1.6m",
    price: 40000,
    priceShift: 25000,
    qty: 5,
    active: true,
    desc: "Chan may nhe, phu hop chup ca nhan va san pham.",
  },
  {
    id: 302,
    name: "Den LED RGB",
    price: 60000,
    priceShift: 35000,
    qty: 4,
    active: true,
    desc: "Den nho co RGB, pin sac USB-C.",
  },
  {
    id: 303,
    name: "Micro Rode Wireless",
    price: 90000,
    priceShift: 55000,
    qty: 2,
    active: true,
    desc: "Micro khong day cho vlog va phong van.",
  },
  {
    id: 304,
    name: "The nho SD 128GB",
    price: 30000,
    priceShift: 20000,
    qty: 8,
    active: true,
    desc: "The nho toc do cao, du quay 4K ngan.",
  },
  {
    id: 305,
    name: "Gimbal DJI RS Mini",
    price: 150000,
    priceShift: 90000,
    qty: 1,
    active: true,
    desc: "Chong rung cho quay chuyen dong.",
  },
];

const deliveryFees: DeliveryFee[] = [
  { name: "Tam My", fee: 15000 },
  { name: "Nui Thanh", fee: 25000 },
  { name: "Tam Ky", fee: 35000 },
  { name: "Chu Lai", fee: 45000 },
  { name: "Da Nang", fee: 80000 },
];

const discounts: Discount[] = [
  {
    id: "WELCOME10",
    code: "WELCOME10",
    type: "percent",
    value: 10,
    minOrder: 150000,
    maxUse: 100,
    usedCount: 0,
    active: true,
    voucherScope: "rental",
  },
  {
    id: "FREESHIP",
    code: "FREESHIP",
    type: "fixed",
    value: 40000,
    minOrder: 250000,
    maxUse: 50,
    usedCount: 0,
    active: true,
    voucherScope: "delivery",
  },
  {
    id: "WEEKEND50",
    code: "WEEKEND50",
    type: "fixed",
    value: 50000,
    minOrder: 300000,
    maxUse: 30,
    usedCount: 2,
    active: true,
    voucherScope: "rental",
  },
  {
    id: "OLD2025",
    code: "OLD2025",
    type: "percent",
    value: 15,
    minOrder: 200000,
    maxUse: 20,
    usedCount: 20,
    active: false,
    voucherScope: "rental",
  },
];

const feedbacks = [
  {
    id: "fb_001",
    name: "Minh Anh",
    rating: 5,
    message: "May sach, pin du, anh chu tu van nhanh.",
    active: true,
    createdAt: iso(2),
  },
  {
    id: "fb_002",
    name: "Quoc Huy",
    rating: 5,
    message: "Thue X-S10 di Hoi An chup rat on.",
    active: true,
    createdAt: iso(4),
  },
  {
    id: "fb_003",
    name: "Ngoc Linh",
    rating: 4,
    message: "Giao may dung gio, phu kien day du.",
    active: true,
    createdAt: iso(8),
  },
  {
    id: "fb_004",
    name: "Bao Tran",
    rating: 5,
    message: "Gia hop ly cho sinh vien, se thue tiep.",
    active: true,
    createdAt: iso(11),
  },
];

const albums = [
  {
    id: "alb_street_001",
    name: "Street sample",
    cameraTag: "Fujifilm X-S10",
    coverId: "seed_gallery/street_001",
    coverUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
    photos: [
      {
        id: "seed_gallery/street_001",
        public_id: "seed_gallery/street_001",
        url: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee",
        uploadedAt: iso(1),
      },
    ],
    createdAt: iso(1),
    updatedAt: iso(1),
  },
  {
    id: "alb_portrait_001",
    name: "Portrait sample",
    cameraTag: "Sony A6400",
    coverId: "seed_gallery/portrait_001",
    coverUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330",
    photos: [
      {
        id: "seed_gallery/portrait_001",
        public_id: "seed_gallery/portrait_001",
        url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330",
        uploadedAt: iso(3),
      },
    ],
    createdAt: iso(3),
    updatedAt: iso(3),
  },
];

const orders: BookingOrder[] = [
  {
    id: "ORD-260625-001",
    status: "pending",
    date: "2026-06-27",
    days: 1,
    session: "full",
    cameras: [{ id: 201, name: "Fujifilm X-S10 + XF 18-55mm", qty: 1, price: 180000 }],
    accessories: ["Tripod 1.6m"],
    accessoriesDetail: [{ name: "Tripod 1.6m", qty: 1 }],
    subtotal: 220000,
    discountAmt: 22000,
    rentalDiscountAmt: 22000,
    deliveryDiscountAmt: 0,
    appliedDiscounts: [{ code: "WELCOME10", scope: "rental", amt: 22000 }],
    total: 198000,
    deliveryFee: 0,
    name: "Le Hoang",
    phone: "0901000001",
    zalo: "0901000001",
    email: "hoang@example.com",
    address: "Tam My",
    note: "Nhan may buoi sang",
    createdAt: iso(0, 2),
    seen: false,
  },
  {
    id: "ORD-260625-002",
    status: "confirmed",
    date: "2026-06-28",
    days: 2,
    session: "full",
    cameras: [{ id: 202, name: "Sony A6400 + Sigma 30mm F1.4", qty: 1, price: 220000 }],
    accessories: ["Micro Rode Wireless", "The nho SD 128GB"],
    accessoriesDetail: [
      { name: "Micro Rode Wireless", qty: 1 },
      { name: "The nho SD 128GB", qty: 1 },
    ],
    subtotal: 530000,
    discountAmt: 50000,
    rentalDiscountAmt: 50000,
    deliveryDiscountAmt: 0,
    appliedDiscounts: [{ code: "WEEKEND50", scope: "rental", amt: 50000 }],
    total: 515000,
    deliveryFee: 35000,
    name: "Tran My",
    phone: "0901000002",
    zalo: "0901000002",
    email: "my@example.com",
    address: "Tam Ky",
    note: "",
    createdAt: iso(1, 4),
    seen: true,
  },
  {
    id: "ORD-260625-003",
    status: "completed",
    date: "2026-06-20",
    days: 0.5,
    session: "morning",
    cameras: [{ id: 203, name: "Canon EOS M50 Mark II", qty: 1, price: 160000 }],
    accessories: ["Den LED RGB"],
    accessoriesDetail: [{ name: "Den LED RGB", qty: 1 }],
    subtotal: 115000,
    discountAmt: 0,
    rentalDiscountAmt: 0,
    deliveryDiscountAmt: 0,
    appliedDiscounts: [],
    total: 140000,
    deliveryFee: 25000,
    name: "Pham Khoa",
    phone: "0901000003",
    zalo: "0901000003",
    email: "khoa@example.com",
    address: "Nui Thanh",
    note: "Da tra may",
    createdAt: iso(6),
    seen: true,
  },
  {
    id: "ORD-260625-004",
    status: "cancelled",
    date: "2026-06-22",
    days: 1,
    session: "afternoon",
    cameras: [{ id: 205, name: "Sony ZV-E10 Vlog Kit", qty: 1, price: 210000 }],
    accessories: [],
    accessoriesDetail: [],
    subtotal: 210000,
    discountAmt: 0,
    rentalDiscountAmt: 0,
    deliveryDiscountAmt: 0,
    appliedDiscounts: [],
    total: 210000,
    deliveryFee: 0,
    name: "Dang Nhi",
    phone: "0901000004",
    zalo: "0901000004",
    email: "nhi@example.com",
    address: "Chu Lai",
    note: "Khach huy lich",
    createdAt: iso(5),
    seen: true,
  },
];

function buildPhotos(seed: SeedFile): GalleryPhotoInput[] {
  const albumPhotos = albums.flatMap((album) =>
    Array.isArray(album.photos)
      ? album.photos.map((photo) => photo as GalleryPhotoInput)
      : [],
  );

  return [
    ...(Array.isArray(seed.photos) ? seed.photos : []),
    ...albumPhotos,
    {
      public_id: "seed_gallery/product_001",
      url: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32",
      uploaded_at: iso(0),
      uploaded_by: "seed",
    },
  ];
}

async function main() {
  const seed = await readSeedFile();
  const repo = await getRepository();

  const site = {
    ...(seed.site || {}),
    zalo: "0855 471 202",
    phone: "0855 471 202",
    address: "Nui Thanh - Tam Ky - Da Nang",
    tagline: "Thue may anh gon, nhanh, de dung",
    desc: "Dich vu cho thue may anh va phu kien cho du lich, chup anh ca nhan, su kien nho.",
    slogan: "Dat lich nhanh, nhan may dung gio",
    socialLinks: {
      facebook: "https://facebook.com/92kamera",
      instagram: "https://instagram.com/92kamera",
      tiktok: "",
      youtube: "",
    },
  };

  const payloads: Array<[string, unknown]> = [
    [STORE_KEYS.cameras, mergeById(seed.cameras || [], extraCameras)],
    [STORE_KEYS.accessories, mergeById(seed.accessories || [], extraAccessories)],
    [STORE_KEYS.site, site],
    [STORE_KEYS.feedbacks, mergeById(seed.feedbacks || [], feedbacks)],
    [STORE_KEYS.discounts, mergeById(seed.discounts || [], discounts)],
    [STORE_KEYS.albums, mergeById(seed.albums || [], albums)],
    [STORE_KEYS.deliveryFees, mergeByName(seed.deliveryFees || [], deliveryFees)],
    [STORE_KEYS.orders, orders],
    [
      STORE_KEYS.users,
      [
        {
          googleId: "seed_google_001",
          email: "customer@example.com",
          name: "Seed Customer",
          avatar: "",
          provider: "google",
          phone: "0901000099",
          createdAt: iso(7),
          updatedAt: iso(0),
        },
      ],
    ],
  ];

  for (const [key, value] of payloads) {
    await repo.setKv(key, JSON.stringify(value));
    const count = Array.isArray(value) ? value.length : 1;
    console.log(`[seed] ${key}: ${count}`);
  }

  const photos = buildPhotos(seed);
  for (const photo of photos) {
    if (!photo.public_id || !photo.url) continue;
    await repo.upsertPhoto({
      public_id: photo.public_id,
      url: photo.url,
      uploaded_at: photo.uploaded_at || photo.uploadedAt || iso(0),
      uploaded_by: photo.uploaded_by || "seed",
    });
  }
  console.log(`[seed] gallery_photos: ${photos.length}`);
  console.log(`[seed] done via ${repo.driver}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[seed] failed", error);
    process.exit(1);
  });
