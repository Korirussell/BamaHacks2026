import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";

const base = { PORT: "8787", WEB_ORIGIN: "http://localhost:3000", PLATFORM_FEE_BPS: "500" };

describe("config", () => {
  it("Instagram is off by default", () => {
    const c = loadConfig(base);
    assert.equal(c.INSTAGRAM, "off");
    assert.equal(c.INSTAGRAM_AUTO_REPLY, "on");
    assert.equal(c.INSTAGRAM_SELLER_TOKEN, undefined);
  });

  it("parses the stories mode and the seller account", () => {
    const c = loadConfig({ ...base, INSTAGRAM: "stories", INSTAGRAM_ACCESS_TOKEN: "p", INSTAGRAM_SELLER_TOKEN: "s", INSTAGRAM_SELLER_USERNAME: "bamahacks2", INSTAGRAM_POLL_SECONDS: "20" });
    assert.equal(c.INSTAGRAM, "stories");
    assert.equal(c.INSTAGRAM_SELLER_TOKEN, "s");
    assert.equal(c.INSTAGRAM_SELLER_USERNAME, "bamahacks2");
    assert.equal(c.INSTAGRAM_POLL_SECONDS, 20);
  });

  it("still parses graph mode, and rejects unknown modes", () => {
    assert.equal(loadConfig({ ...base, INSTAGRAM: "graph" }).INSTAGRAM, "graph");
    assert.throws(() => loadConfig({ ...base, INSTAGRAM: "dms" }), /INSTAGRAM/);
  });
});

describe("payments config", () => {
  it("demo needs no Stripe keys; stripe mode needs both", async () => {
    const { assertPaymentsConfig } = await import("./config.js");
    assertPaymentsConfig(loadConfig(base));
    assert.throws(() => assertPaymentsConfig(loadConfig({ ...base, PAYMENTS: "stripe", STRIPE_SECRET_KEY: "k" })), /STRIPE_WEBHOOK_SECRET/);
    assertPaymentsConfig(loadConfig({ ...base, PAYMENTS: "stripe", STRIPE_SECRET_KEY: "k", STRIPE_WEBHOOK_SECRET: "w" }));
  });
});
