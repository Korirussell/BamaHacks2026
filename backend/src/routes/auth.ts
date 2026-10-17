import { Hono } from "hono";
import { z } from "zod";
import { toSchool } from "../db/mappers.js";
import { SchoolRow } from "../db/rows.js";
import { one } from "../lib/respond.js";
import { adminClient } from "../lib/supabase.js";
import { parseBody } from "../lib/validate.js";

const CheckEmailReq = z.object({ email: z.email() });

/** Finds the school whose `email_domains` include this (lowercased) domain. */
export type SchoolLookup = (domain: string) => Promise<SchoolRow | null>;

export const supabaseSchoolLookup: SchoolLookup = async (domain) => {
  const { data, error } = await adminClient().from("schools").select("*").contains("email_domains", [domain]).limit(1).maybeSingle();
  if (error) throw error;
  return data ? SchoolRow.parse(data) : null;
};

// POST /auth/check-email: UX-only pre-check. The before-user-created hook (0004_auth.sql) enforces it for real.
export const authRoutes = (findSchool: SchoolLookup) =>
  new Hono().post("/check-email", async (c) => {
    const { email } = await parseBody(c, CheckEmailReq);
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    if (!domain.endsWith(".edu")) {
      return c.json(one({ allowed: false, school: null, reason: "NOT_EDU_EMAIL" }));
    }
    const school = await findSchool(domain);
    if (!school) return c.json(one({ allowed: false, school: null, reason: "SCHOOL_NOT_SUPPORTED" }));
    return c.json(one({ allowed: true, school: toSchool(school), reason: null }));
  });
