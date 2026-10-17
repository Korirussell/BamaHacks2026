import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.js";
import type { SchoolRow } from "../db/rows.js";

const UA: SchoolRow = {
  id: "00000000-0000-4000-a000-000000000001", name: "The University of Alabama", domain: "ua.edu",
  center_lat: 33.2114, center_lng: -87.5401, timezone: "America/Chicago", campus_mail_supported: true, tutor_min_grade: "A-",
};

test("POST /auth/check-email allows supported school domains only", async () => {
  const seen: string[] = [];
  const app = createApp({
    verify: async () => null,
    findSchool: async (domain) => (seen.push(domain), ["ua.edu", "crimson.ua.edu"].includes(domain) ? UA : null),
    log: false,
  });
  const check = async (email: unknown) => {
    const res = await app.request("/api/v1/auth/check-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    return { status: res.status, body: (await res.json()) as { data?: { allowed: boolean; reason: string | null; school: { id: string } | null } } };
  };

  const ok = await check("Kate@Crimson.UA.edu");
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.data?.allowed, ok.body.data?.reason, ok.body.data?.school?.id], [true, null, UA.id]);
  assert.equal((await check("kate@gmail.com")).body.data?.reason, "NOT_EDU_EMAIL");
  assert.equal((await check("kate@auburn.edu")).body.data?.reason, "SCHOOL_NOT_SUPPORTED");
  assert.equal((await check("not-an-email")).status, 400);
  assert.deepEqual(seen, ["crimson.ua.edu", "auburn.edu"], "gmail never hits the DB; domain is lowercased");
});
