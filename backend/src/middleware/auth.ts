import type { MiddlewareHandler } from "hono";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";

export interface AuthUser {
  id: string;
  schoolId: string;
  email: string | null;
  accessToken: string;
}

export type AuthEnv = { Variables: { user: AuthUser } };

export interface VerifiedToken {
  sub: string;
  email: string | null;
  /** From app_metadata, set by the auth hook. Never read from user_metadata (users can edit it). */
  schoolId: string | null;
}

/** Returns the token's claims, or null when it's invalid, expired or not a signed-in user. */
export type TokenVerifier = (token: string) => Promise<VerifiedToken | null>;

/** Verifies Supabase access tokens locally against the project's JWKS (cached by supabase-js). */
export const supabaseVerifier: TokenVerifier = async (token) => {
  const { data, error } = await adminClient().auth.getClaims(token);
  if (error || !data) return null;
  const { claims } = data;
  if (claims.role !== "authenticated" || !claims.sub) return null;
  const schoolId: unknown = claims.app_metadata?.["school_id"];
  return {
    sub: claims.sub,
    email: claims.email ?? null,
    schoolId: typeof schoolId === "string" && schoolId ? schoolId : null,
  };
};

const BEARER = /^Bearer\s+(\S+)$/i;

/** Requires `Authorization: Bearer <supabase_access_token>` and sets `c.var.user`. */
export function requireUser(verify: TokenVerifier): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = BEARER.exec(c.req.header("Authorization") ?? "")?.[1];
    if (!token) throw new ApiError(401, "UNAUTHENTICATED", "Missing bearer token");
    const verified = await verify(token);
    if (!verified) throw new ApiError(401, "UNAUTHENTICATED", "Invalid or expired token");
    if (!verified.schoolId) throw new ApiError(403, "SCHOOL_NOT_SUPPORTED", "Account isn't linked to a supported school");
    c.set("user", { id: verified.sub, schoolId: verified.schoolId, email: verified.email, accessToken: token });
    await next();
  };
}
