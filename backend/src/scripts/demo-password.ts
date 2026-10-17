// Sets a password on a seeded demo persona so it can sign in on the live site with email +
// password (no laptop needed during the demo). You type the password; it is never printed.
//
//   pnpm demo:password buyer      (also: seller, student, ava, marcus, priya, alex)
//
// Only the bamahacks.*/ajgundrum@ demo accounts; real users are never touched. Needs SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY in .env.

import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { adminClient } from "../lib/supabase.js";

const PERSONAS = ["buyer", "seller", "student", "ava", "marcus", "priya", "alex"] as const;
type Persona = (typeof PERSONAS)[number];
/** Alex is the on-stage demo account; everyone else follows the bamahacks.<persona> pattern. */
const EMAIL_OVERRIDES: Partial<Record<Persona, string>> = { alex: "ajgundrum@crimson.ua.edu" };

function ask(prompt: string): Promise<string> {
  let muted = false;
  const out = new Writable({ write(chunk, _enc, cb) { if (!muted) process.stdout.write(chunk); cb(); } });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    muted = true;
    rl.question("", (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const persona = process.argv[2] as Persona | undefined;
if (!persona || !PERSONAS.includes(persona)) {
  console.error(`Usage: pnpm demo:password <${PERSONAS.join("|")}>`);
  process.exit(1);
}
const email = EMAIL_OVERRIDES[persona] ?? `bamahacks.${persona}@crimson.ua.edu`;

const db = adminClient();
const found = await db.from("profiles").select("id, display_name").eq("email", email).maybeSingle<{ id: string; display_name: string }>();
if (found.error) throw found.error;
if (!found.data) {
  console.error(`No account for ${email}. Run \`pnpm seed:demo\` first.`);
  process.exit(1);
}

const password = await ask(`New password for ${found.data.display_name} <${email}> (10+ chars, hidden): `);
const again = await ask("Again: ");
if (password.length < 10) { console.error("Too short: use at least 10 characters."); process.exit(1); }
if (password !== again) { console.error("The two passwords don't match."); process.exit(1); }

const { error } = await db.auth.admin.updateUserById(found.data.id, { password });
if (error) { console.error(`Couldn't set the password: ${error.message}`); process.exit(1); }
console.log(`Done. Sign in on the site with ${email} → "Use a password instead".`);
