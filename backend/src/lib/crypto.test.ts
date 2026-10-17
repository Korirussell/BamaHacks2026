import assert from "node:assert/strict";
import test from "node:test";
import { decrypt, encrypt, signState, verifyState } from "./crypto.js";

process.env["TOKEN_ENCRYPTION_KEY"] = "test-key-test-key-test-key-test-key-1234";

test("encrypt/decrypt round-trips and is randomized", () => {
  const sealed = encrypt("1//refresh-token");
  assert.notEqual(sealed, encrypt("1//refresh-token"));
  assert.equal(decrypt(sealed), "1//refresh-token");
});

test("tampered ciphertext fails to decrypt", () => {
  const [iv, tag, data] = encrypt("secret").split(".") as [string, string, string];
  const flipped = (data[0] === "A" ? "B" : "A") + data.slice(1);
  assert.throws(() => decrypt([iv, tag, flipped].join(".")));
  assert.throws(() => decrypt("garbage"));
});

test("state round-trips, rejects tampering and expiry", () => {
  const state = signState({ uid: "u1", sid: "s1" });
  assert.deepEqual({ uid: "u1", sid: "s1" }, (({ uid, sid }) => ({ uid, sid }))(verifyState<{ uid: string; sid: string }>(state)!));
  const [body, sig] = state.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ uid: "evil", sid: "s1", exp: Date.now() + 60_000 })).toString("base64url");
  assert.equal(verifyState(`${forged}.${sig}`), null);
  assert.equal(verifyState(`${body}.${sig}x`), null);
  assert.equal(verifyState("nope"), null);
  assert.equal(verifyState(signState({ uid: "u1" }, 10, Date.now() - 60_000)), null);
});

test("missing or short key throws a clear error", () => {
  const saved = process.env["TOKEN_ENCRYPTION_KEY"];
  delete process.env["TOKEN_ENCRYPTION_KEY"];
  try {
    assert.throws(() => encrypt("x"), /TOKEN_ENCRYPTION_KEY/);
  } finally {
    process.env["TOKEN_ENCRYPTION_KEY"] = saved;
  }
});
