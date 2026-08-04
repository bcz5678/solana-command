import { z } from "zod";

/** Bump on any breaking shape change. Persisted with every stored payload. */
export const SCHEMA_VERSION = 1 as const;

// ============================================================================
// SECTION 1 — src/field-meta.ts
//
// Form metadata attached to schemas. This is what makes "adding a field to the
// schema makes it appear in the form" true. If the form ever needs a hardcoded
// branch, this metadata is missing an expressive capability — extend FieldMeta
// rather than branching in the form.
// ============================================================================

export type FieldWidget =
  | "text" | "textarea" | "richtext" | "url" | "slug"
  | "number" | "length" | "color" | "select" | "toggle"
  | "image" | "focalPoint" | "icon" | "repeater";

// interface -> type. Interfaces lack an implicit index signature, so FieldMeta
// as an interface does not satisfy Zod's registry meta constraint
// (Record<string, unknown>). A type alias does.
export type FieldMeta = {
  label: string;
  help?: string;
  placeholder?: string;
  widget?: FieldWidget;
  group?: string;
  order?: number;
  options?: Array<{ value: string; label: string }>;
  visibleWhen?: { path: string; equals: unknown };
  advanced?: boolean;
};

export const fieldRegistry = z.registry<FieldMeta>();

export function field<T extends z.ZodType>(schema: T, meta: FieldMeta): T {
  fieldRegistry.add(schema as z.ZodType, meta);
  return schema;
}

export function getFieldMeta(schema: z.ZodType): FieldMeta | undefined {
  return fieldRegistry.get(schema as z.ZodType);
}