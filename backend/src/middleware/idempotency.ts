import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../lib/errors.js";
import { adminClient } from "../lib/supabase.js";
import type { AuthEnv } from "./auth.js";

/** `status: 0` marks a request that is still running. */
export interface StoredResponse {
  requestHash: string;
  status: number;
  body: unknown;
}

export interface IdempotencyStore {
  /** Claims the key. Returns null if it was free, otherwise what is already stored for it. */
  begin(userId: string, key: string, requestHash: string): Promise<StoredResponse | null>;
  complete(userId: string, key: string, status: number, body: unknown): Promise<void>;
  /** Frees the key after a failed request so the client can retry. */
  abandon(userId: string, key: string): Promise<void>;
}

const IN_PROGRESS = 0;

/**
 * For calls that move money or advance an order/handoff (contract: Conventions → Idempotency).
 * Mount after `requireUser`. Same key + same request → the first 2xx response is replayed.
 */
export function idempotent(store: IdempotencyStore): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const key = c.req.header("Idempotency-Key");
    if (!key || key.length > 255) {
      throw new ApiError(400, "VALIDATION", "Idempotency-Key header is required", {
        "Idempotency-Key": "Required, at most 255 characters",
      });
    }
    const userId = c.var.user.id;
    const body = await c.req.text(); // Hono caches it, so the handler can still read the body
    const requestHash = createHash("sha256").update(`${c.req.method} ${c.req.path}\n${body}`).digest("hex");

    const existing = await store.begin(userId, key, requestHash);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(422, "VALIDATION", "Idempotency-Key was already used for a different request");
      }
      if (existing.status === IN_PROGRESS) {
        throw new ApiError(409, "INVALID_STATE", "A request with this Idempotency-Key is still in progress");
      }
      return c.body(JSON.stringify(existing.body), existing.status as ContentfulStatusCode, {
        "Content-Type": "application/json",
        "Idempotent-Replayed": "true",
      });
    }

    try {
      await next();
    } catch (err) {
      await store.abandon(userId, key);
      throw err;
    }
    if (c.res.status >= 200 && c.res.status < 300) {
      await store.complete(userId, key, c.res.status, await c.res.clone().json().catch(() => null));
    } else {
      await store.abandon(userId, key);
    }
  };
}

export function memoryIdempotencyStore(): IdempotencyStore {
  const rows = new Map<string, StoredResponse>();
  const id = (userId: string, key: string) => `${userId}:${key}`;
  return {
    async begin(userId, key, requestHash) {
      const found = rows.get(id(userId, key));
      if (found) return found;
      rows.set(id(userId, key), { requestHash, status: IN_PROGRESS, body: null });
      return null;
    },
    async complete(userId, key, status, body) {
      const found = rows.get(id(userId, key));
      if (found) rows.set(id(userId, key), { ...found, status, body });
    },
    async abandon(userId, key) {
      rows.delete(id(userId, key));
    },
  };
}

const UNIQUE_VIOLATION = "23505";

/** Backed by `public.idempotency_keys` (0001_core.sql). */
export function supabaseIdempotencyStore(): IdempotencyStore {
  const table = () => adminClient().from("idempotency_keys");
  return {
    async begin(userId, key, requestHash) {
      const inserted = await table().insert({
        user_id: userId, key, request_hash: requestHash, response_status: IN_PROGRESS, response_body: {},
      });
      if (!inserted.error) return null;
      if (inserted.error.code !== UNIQUE_VIOLATION) throw inserted.error;
      const { data, error } = await table()
        .select("request_hash, response_status, response_body")
        .eq("user_id", userId).eq("key", key).single<{ request_hash: string; response_status: number; response_body: unknown }>();
      if (error) throw error;
      return { requestHash: data.request_hash, status: data.response_status, body: data.response_body };
    },
    async complete(userId, key, status, body) {
      const { error } = await table().update({ response_status: status, response_body: body ?? {} })
        .eq("user_id", userId).eq("key", key);
      if (error) throw error;
    },
    async abandon(userId, key) {
      const { error } = await table().delete().eq("user_id", userId).eq("key", key);
      if (error) throw error;
    },
  };
}
