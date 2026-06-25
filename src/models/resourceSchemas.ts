import type { ModelField, ModelSchema } from "./modelSchema.js";

const id: ModelField = { type: "id", required: true };
const optionalId: ModelField = { type: "id" };
const string: ModelField = { type: "string" };
const requiredString: ModelField = { type: "string", required: true };
const number: ModelField = { type: "number" };
const requiredNumber: ModelField = { type: "number", required: true };
const boolean: ModelField = { type: "boolean" };
const unknownArray: ModelField = { type: "array", arrayOf: { type: "unknown" } };
const stringArray: ModelField = { type: "array", arrayOf: { type: "string" } };
const object: ModelField = { type: "object" };
const nullableNumber: ModelField = { type: "number", nullable: true };

export const cameraSchema: ModelSchema = {
  name: "camera",
  allowUnknown: true,
  fields: {
    id: optionalId,
    name: requiredString,
    price: requiredNumber,
    desc: string,
    qty: number,
    status: { type: "string", enum: ["available", "rented", "unavailable", "maintenance"] },
    icon: string,
    images: stringArray,
    imagesMeta: unknownArray,
  },
};

export const accessorySchema: ModelSchema = {
  name: "accessory",
  allowUnknown: true,
  fields: {
    id: optionalId,
    name: requiredString,
    price: requiredNumber,
    priceShift: nullableNumber,
    qty: number,
    active: boolean,
    desc: string,
    image: string,
    imageMeta: object,
  },
};

export const discountSchema: ModelSchema = {
  name: "discount",
  allowUnknown: true,
  fields: {
    id: optionalId,
    code: requiredString,
    type: { type: "string", required: true, enum: ["percent", "fixed"] },
    value: requiredNumber,
    minOrder: number,
    maxUse: number,
    usedCount: number,
    active: boolean,
    voucherScope: { type: "string", enum: ["rental", "delivery"] },
    requiredBadge: string,
  },
};

export const deliveryFeeSchema: ModelSchema = {
  name: "deliveryFee",
  allowUnknown: false,
  fields: {
    name: requiredString,
    fee: requiredNumber,
  },
};

export const feedbackSchema: ModelSchema = {
  name: "feedback",
  allowUnknown: true,
  fields: {
    id: optionalId,
    name: requiredString,
    content: string,
    message: string,
    rating: number,
    avatar: string,
    active: boolean,
    createdAt: { type: "dateTime" },
    updatedAt: { type: "dateTime" },
  },
};

export const albumSchema: ModelSchema = {
  name: "album",
  allowUnknown: true,
  fields: {
    id: optionalId,
    name: requiredString,
    cameraTag: string,
    coverId: string,
    coverUrl: string,
    photos: unknownArray,
    createdAt: { type: "dateTime" },
    updatedAt: { type: "dateTime" },
  },
};

export const userSchema: ModelSchema = {
  name: "user",
  allowUnknown: true,
  fields: {
    googleId: id,
    email: string,
    name: string,
    avatar: string,
    phone: string,
    provider: { type: "string", enum: ["google"] },
    createdAt: { type: "dateTime" },
    updatedAt: { type: "dateTime" },
  },
};

export const siteSchema: ModelSchema = {
  name: "site",
  allowUnknown: true,
  fields: {
    zalo: string,
    address: string,
    tagline: string,
    desc: string,
    phone: string,
    slogan: string,
    stats: unknownArray,
    zaloLink: string,
    zaloQR: string,
    cornerQR: string,
    socialLinks: object,
    secretText: string,
  },
};

export const orderSchema: ModelSchema = {
  name: "order",
  allowUnknown: true,
  fields: {
    id,
    status: requiredString,
    date: requiredString,
    days: requiredNumber,
    session: { type: "string", required: true, enum: ["morning", "afternoon", "full"] },
    cameras: unknownArray,
    accessories: stringArray,
    accessoriesDetail: unknownArray,
    subtotal: requiredNumber,
    discountAmt: number,
    rentalDiscountAmt: number,
    deliveryDiscountAmt: number,
    appliedDiscounts: unknownArray,
    total: requiredNumber,
    deliveryFee: number,
    name: requiredString,
    phone: requiredString,
    zalo: string,
    email: string,
    address: string,
    note: string,
    createdAt: { type: "dateTime", required: true },
    seen: { type: "boolean", required: true },
  },
};

export const photoSchema: ModelSchema = {
  name: "photo",
  allowUnknown: true,
  fields: {
    public_id: requiredString,
    url: requiredString,
    uploadedAt: { type: "dateTime" },
    uploaded_at: { type: "dateTime" },
    uploaded_by: string,
  },
};
