import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

// Error codes from docs/API_CONTRACT.md → Conventions.
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "NOT_EDU_EMAIL",
  "SCHOOL_NOT_SUPPORTED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "INVALID_STATE",
  "STRIPE_ONBOARDING_REQUIRED",
  "PAYMENT_FAILED",
  "NOT_NEARBY",
  "MAIL_INFO_REQUIRED",
  "CLAIM_INVALID",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export function errorResponse(c: Context, err: ApiError) {
  return c.json(
    {
      error: {
        code: err.code,
        message: err.message,
        ...(err.fieldErrors ? { field_errors: err.fieldErrors } : {}),
      },
    },
    err.status,
  );
}
