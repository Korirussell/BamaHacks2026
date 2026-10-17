// End-to-end check of the laptop worker: queues real decisions through Supabase ai_tasks and prints
// what came back. `pnpm ai-check` (needs ai-worker/worker.py running).
import { jevDecider, supabaseAiQueue } from "../src/adapters/local-ai.js";
import { summarize } from "../src/services/decisions.js";
import { haggleQuestions, haggleState, parseAmountCents, planHaggle, readTriage } from "../src/services/haggle.js";

const queue = supabaseAiQueue();
console.log("status:", JSON.stringify(await queue.status()));

const messages = [
  "would u do 40 if i grab it today?",
  "can i just zelle you $55 right now and you ship it to my cousin",
  "is the screen scratched?",
];
for (const message of messages) {
  const t0 = Date.now();
  const amountCents = parseAmountCents(message);
  const d = await jevDecider(queue).decide(haggleState({ title: "TI-84 Plus", askCents: 6000, message, history: [] }), haggleQuestions());
  const triage = readTriage(d, message, amountCents);
  const plan = planHaggle({ askCents: 6000, floorCents: 4500, negotiable: true, lastCounterCents: null, amountCents, ...triage });
  console.log(`\n"${message}"  (${Date.now() - t0} ms, engine: ${d ? "jev" : "rules"})`);
  console.log(`  → ${plan.action}${plan.priceCents ? ` $${plan.priceCents / 100}` : ""}: ${plan.reply}`);
  if (d) for (const [k, v] of Object.entries(summarize(d))) console.log(`    ${k}: ${v.pick} (${v.value})`);
}
