import type { Request, Response } from "express";
import { STORE_KEYS } from "../config/storeKeys.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  accessorySchema,
  albumSchema,
  cameraSchema,
  deliveryFeeSchema,
  discountSchema,
  feedbackSchema,
  siteSchema,
  userSchema,
  validateModelInput,
  type ModelSchema,
} from "../models/index.js";
import { getRepository } from "../repositories/index.js";
import {
  createResource,
  deleteResource,
  getResourceArray,
  getResourceById,
  getResourceObject,
  setResourceObject,
  setResourceArray,
  updateResource,
  type KvRecord,
  type ResourceConfig,
} from "../services/kvResource.service.js";
import { findUserByGoogleId, getUsersMap, upsertUsers } from "../services/userResource.service.js";
import { HttpError } from "../utils/httpError.js";

type NamedResourceConfig = ResourceConfig & {
  plural: string;
  singular: string;
  adminWrites?: boolean;
  publicCreate?: boolean;
  schema?: ModelSchema;
};

export const resources = {
  cameras: {
    key: STORE_KEYS.cameras,
    plural: "cameras",
    singular: "camera",
    schema: cameraSchema,
  },
  accessories: {
    key: STORE_KEYS.accessories,
    plural: "accessories",
    singular: "accessory",
    schema: accessorySchema,
  },
  discounts: {
    key: STORE_KEYS.discounts,
    plural: "discounts",
    singular: "discount",
    generateIdPrefix: "discount",
    schema: discountSchema,
  },
  feedbacks: {
    key: STORE_KEYS.feedbacks,
    plural: "feedbacks",
    singular: "feedback",
    generateIdPrefix: "feedback",
    publicCreate: true,
    schema: feedbackSchema,
  },
  albums: {
    key: STORE_KEYS.albums,
    plural: "albums",
    singular: "album",
    generateIdPrefix: "alb",
    schema: albumSchema,
  },
  users: {
    key: STORE_KEYS.users,
    plural: "users",
    singular: "user",
    idField: "googleId",
    schema: userSchema,
  },
} satisfies Record<string, NamedResourceConfig>;

function asRecord(value: unknown): KvRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "body must be an object");
  }
  return value as KvRecord;
}

function bodyRecord(req: Request): KvRecord {
  return asRecord(req.body || {});
}

function ensureAdminWrite(req: Request, config: NamedResourceConfig, action: "create" | "update" | "delete"): void {
  if (action === "create" && config.publicCreate) return;
  if (config.adminWrites === false) return;
  requireAdmin(req);
}

function validateResourceBody(config: NamedResourceConfig, value: unknown, partial: boolean): KvRecord {
  return config.schema ? validateModelInput(config.schema, value, { partial }) : asRecord(value);
}

export function createArrayResourceController(config: NamedResourceConfig) {
  return {
    async list(_req: Request, res: Response) {
      const repo = await getRepository();
      const items = await getResourceArray(repo, config.key);
      res.json(items);
    },

    async getOne(req: Request, res: Response) {
      const repo = await getRepository();
      const item = await getResourceById(repo, config, req.params.id || "");
      res.json(item);
    },

    async create(req: Request, res: Response) {
      ensureAdminWrite(req, config, "create");

      const repo = await getRepository();
      const item = await createResource(repo, config, validateResourceBody(config, bodyRecord(req), false));
      res.status(201).json(item);
    },

    async update(req: Request, res: Response) {
      ensureAdminWrite(req, config, "update");

      const repo = await getRepository();
      const item = await updateResource(repo, config, req.params.id || "", validateResourceBody(config, bodyRecord(req), true));
      res.json(item);
    },

    async remove(req: Request, res: Response) {
      ensureAdminWrite(req, config, "delete");

      const repo = await getRepository();
      const item = await deleteResource(repo, config, req.params.id || "");
      res.json(item);
    },
  };
}

export const siteController = {
  async get(_req: Request, res: Response) {
    const repo = await getRepository();
    const site = await getResourceObject(repo, STORE_KEYS.site);
    res.json(site);
  },

  async update(req: Request, res: Response) {
    requireAdmin(req);

    const repo = await getRepository();
    const site = validateModelInput(siteSchema, req.body || {}, { partial: true });
    await setResourceObject(repo, STORE_KEYS.site, site);
    res.json(site);
  },
};

export const deliveryFeeController = {
  async list(_req: Request, res: Response) {
    const repo = await getRepository();
    const deliveryFees = await getResourceArray(repo, STORE_KEYS.deliveryFees);
    res.json(deliveryFees);
  },

  async replace(req: Request, res: Response) {
    requireAdmin(req);

    const body = req.body as unknown;
    let deliveryFees: unknown[] | null = null;
    if (Array.isArray(body)) {
      deliveryFees = body;
    } else if (body && typeof body === "object" && Array.isArray((body as KvRecord).deliveryFees)) {
      deliveryFees = (body as { deliveryFees: unknown[] }).deliveryFees;
    }
    if (!deliveryFees) throw new HttpError(400, "deliveryFees must be an array");

    const validated = deliveryFees.map((item) => validateModelInput(deliveryFeeSchema, item));
    const repo = await getRepository();
    await setResourceArray(repo, STORE_KEYS.deliveryFees, validated);
    res.json(validated);
  },
};

export const discountController = {
  ...createArrayResourceController(resources.discounts),

  async apply(req: Request, res: Response) {
    const body = bodyRecord(req);
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const orderTotal = Number(body.orderTotal ?? body.subtotal ?? body.total ?? 0);
    if (!code) throw new HttpError(400, "code is required");
    if (!Number.isFinite(orderTotal) || orderTotal < 0) throw new HttpError(400, "orderTotal is required");

    const repo = await getRepository();
    const discounts = await getResourceArray(repo, STORE_KEYS.discounts);
    const discount = discounts.find(
      (item) => typeof item.code === "string" && item.code.toUpperCase() === code && item.active !== false,
    );
    if (!discount) throw new HttpError(404, "Discount code was not found");

    const minOrder = Number(discount.minOrder || 0);
    if (minOrder && orderTotal < minOrder) {
      throw new HttpError(400, `Discount code requires minimum order ${minOrder}`);
    }

    const value = Number(discount.value || 0);
    const type = discount.type === "percent" ? "percent" : "fixed";
    const discountAmt = Math.min(orderTotal, Math.max(0, type === "percent" ? Math.round((orderTotal * value) / 100) : value));

    res.json({
      discount,
      discountAmt,
      total: Math.max(0, orderTotal - discountAmt),
    });
  },
};

export const userController = {
  async list(_req: Request, res: Response) {
    const repo = await getRepository();
    const users = await getUsersMap(repo);
    res.json(users);
  },

  async getByGoogleId(req: Request, res: Response) {
    const repo = await getRepository();
    const user = await findUserByGoogleId(repo, req.params.googleId || "");
    res.json(user);
  },

  async upsert(req: Request, res: Response) {
    const body = bodyRecord(req);
    const repo = await getRepository();
    const result = await upsertUsers(repo, body);
    res.json(result.user || result.users);
  },
};
