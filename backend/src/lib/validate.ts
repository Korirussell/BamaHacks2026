import type { Context } from "hono";
import { z } from "zod";
import { ApiError } from "./errors.js";

function fieldErrors(issues: z.core.$ZodIssue[]): Record<string, string> {
  return Object.fromEntries(issues.map((issue) => [issue.path.map(String).join("."), issue.message]));
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError(422, "VALIDATION", "Invalid request", fieldErrors(result.error.issues));
}

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  return parse(schema, await c.req.json().catch(() => null));
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  return parse(schema, c.req.query());
}
