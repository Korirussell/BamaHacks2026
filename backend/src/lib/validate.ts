import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors.js";

function toApiError(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fieldErrors[key] ??= issue.message;
  }
  return new ApiError(400, "VALIDATION", "Invalid request", fieldErrors);
}

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw toApiError(parsed.error);
  return parsed.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw toApiError(parsed.error);
  return parsed.data;
}
