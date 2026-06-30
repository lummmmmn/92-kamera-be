import { HttpError } from "../utils/httpError.js";

export type ModelFieldType = "id" | "string" | "number" | "boolean" | "array" | "object" | "dateTime" | "unknown";

export type ModelField = {
  type: ModelFieldType;
  required?: boolean;
  nullable?: boolean;
  enum?: readonly unknown[];
  arrayOf?: ModelField;
  fields?: Record<string, ModelField>;
};

export type ModelSchema = {
  name: string;
  fields: Record<string, ModelField>;
  allowUnknown?: boolean;
};

type ValidateOptions = {
  partial?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function typeMatches(value: unknown, field: ModelField): boolean {
  if (value == null) return field.nullable === true;

  switch (field.type) {
    case "id":
      return typeof value === "string" || typeof value === "number";
    case "string":
    case "dateTime":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "unknown":
      return true;
    default:
      return false;
  }
}

function validateField(value: unknown, field: ModelField, path: string, issues: string[]): void {
  if (!typeMatches(value, field)) {
    issues.push(`${path} must be ${field.nullable ? `${field.type} or null` : field.type}`);
    return;
  }

  if (value == null) return;

  if (field.enum && !field.enum.includes(value)) {
    issues.push(`${path} must be one of: ${field.enum.map(String).join(", ")}`);
    return;
  }

  if (field.type === "array" && field.arrayOf && Array.isArray(value)) {
    value.forEach((item, index) => validateField(item, field.arrayOf as ModelField, `${path}[${index}]`, issues));
  }

  if (field.type === "object" && field.fields && isRecord(value)) {
    validateObject({ name: path, fields: field.fields, allowUnknown: true }, value, { partial: false }, issues);
  }
}

function validateObject(
  schema: ModelSchema,
  value: Record<string, unknown>,
  options: ValidateOptions,
  issues: string[],
): void {
  for (const [name, field] of Object.entries(schema.fields)) {
    const hasValue = Object.prototype.hasOwnProperty.call(value, name);
    if (!options.partial && field.required && !hasValue) {
      issues.push(`${name} is required`);
      continue;
    }
    if (hasValue) validateField(value[name], field, name, issues);
  }

  if (schema.allowUnknown === false) {
    const allowed = new Set(Object.keys(schema.fields));
    for (const name of Object.keys(value)) {
      if (!allowed.has(name)) issues.push(`${name} is not allowed`);
    }
  }
}

export function validateModelInput(
  schema: ModelSchema,
  value: unknown,
  options: ValidateOptions = {},
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, `${schema.name} must be an object`);
  }

  const issues: string[] = [];
  validateObject(schema, value, options, issues);
  if (issues.length > 0) {
    throw new HttpError(400, `Invalid ${schema.name}`, issues);
  }

  return value;
}
