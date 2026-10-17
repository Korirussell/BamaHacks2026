import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key(): Buffer {
  const secret = process.env["TOKEN_ENCRYPTION_KEY"];
  if (!secret || secret.length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set or shorter than 32 characters (see backend/.env.example)");
  }
  return createHash("sha256").update(secret).digest();
}

// AES-256-GCM for OAuth refresh tokens at rest. Output: iv.tag.ciphertext (base64url).
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !data) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// Signed, expiring payload for the OAuth `state` param (the callback has no bearer token).
export function signState(payload: object, ttlSeconds = 600, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlSeconds * 1000 })).toString("base64url");
  const sig = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** The payload, or null when the signature is wrong, the state is malformed, or it has expired. */
export function verifyState<T extends object>(state: string, now = Date.now()): T | null {
  const [body, sig, extra] = state.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", key()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: unknown };
    return typeof payload.exp === "number" && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}
