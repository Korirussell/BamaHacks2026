import type { DecisionQuestion, Decisions } from "../adapters/ports.js";

// Haggle triage. JEV reads the buyer's message and answers typed questions (what kind of message,
// how serious, is it a scam). Plain code then picks the price, so the seller's floor can never be
// crossed or revealed by a model. Without JEV the same questions get keyword-rule answers.

export const INTENTS = ["offer", "accept", "decline", "question", "logistics", "spam"] as const;
export type Intent = (typeof INTENTS)[number];

const INTENT_OPTIONS: Record<Intent, string> = {
  offer: "makes or changes a price offer",
  accept: "agrees to the seller's last price",
  decline: "says no or walks away",
  question: "asks about the item (condition, edition, details)",
  logistics: "talks about pickup, meetup time or place",
  spam: "unrelated, spam, or nonsense",
};

/** Scam signals, each a yes/no JEV answers. Any one above SCAM_THRESHOLD flags the message. */
export const SCAM_QUESTIONS: Record<string, string> = {
  off_platform_payment: "Does the message ask to pay or be paid outside the app (Zelle, Cash App, Venmo, gift cards, wire, crypto)?",
  urgency_pressure: "Does the message pressure the other person to act immediately or skip safety steps?",
  meetup_change: "Does the message push to meet somewhere private or off campus, or to ship to a different address?",
  phishing: "Does the message ask for a code, password, login, personal info, or to click an outside link?",
};
export const SCAM_THRESHOLD = 0.7;

export function haggleState(input: { title: string; askCents: number; message: string; history: { from: "buyer" | "seller"; text: string }[] }): string {
  const lines = input.history.slice(-6).map((h) => `${h.from}: ${h.text}`);
  return [
    `Campus marketplace chat about "${input.title}", listed at $${(input.askCents / 100).toFixed(2)}.`,
    lines.length ? `Earlier messages:\n${lines.join("\n")}` : "",
    `New message from the buyer: "${input.message.slice(0, 1000)}"`,
  ].filter(Boolean).join("\n");
}

export function haggleQuestions(): DecisionQuestion[] {
  return [
    { key: "intent", kind: "choice", question: "What is the buyer's new message mainly doing?", options: INTENTS.map((i) => INTENT_OPTIONS[i]) },
    { key: "seriousness", kind: "score", question: "How serious is this buyer about actually buying (0 = not at all, 5 = ready to pay now)?" },
    { key: "lowball", kind: "noul", question: "Is the buyer's offer an unreasonable lowball compared to the listed price?" },
    ...scamQuestions(),
  ];
}

export const scamQuestions = (): DecisionQuestion[] =>
  Object.entries(SCAM_QUESTIONS).map(([key, question]) => ({ key, kind: "noul" as const, question }));

/** "$40", "40 bucks", "do 40?", "35.50" → cents. Picks the last number that looks like a price. */
export function parseAmountCents(text: string): number | null {
  const hits = [...text.matchAll(/\$\s?(\d{1,5}(?:\.\d{1,2})?)|(\d{1,5}(?:\.\d{1,2})?)\s?(?:\$|dollars?|bucks?|usd)\b|\b(?:do|take|for|at|offer|pay|give)\s+\$?(\d{1,5}(?:\.\d{1,2})?)\b/gi)];
  const raw = hits.map((m) => m[1] ?? m[2] ?? m[3]).filter((x): x is string => !!x).at(-1);
  if (!raw) return null;
  const cents = Math.round(Number(raw) * 100);
  return cents > 0 ? cents : null;
}

/** Keyword stand-in for JEV's answers when the laptop is offline. Same shape, so one code path decides. */
export function ruleIntent(message: string, amountCents: number | null): Intent {
  const m = message.toLowerCase();
  if (/\b(deal|sounds good|i'?ll take it|works for me|ok(ay)? let'?s do it)\b/.test(m)) return "accept";
  if (amountCents !== null) return "offer";
  if (/\b(no thanks|nvm|never ?mind|pass|too much|not interested)\b/.test(m)) return "decline";
  if (/\b(where|when|meet|pick ?up|tonight|tomorrow|library|dorm)\b/.test(m)) return "logistics";
  if (/\?|\b(condition|edition|work|scratch|damage)\b/.test(m)) return "question";
  return "spam";
}

export function ruleScamFlags(message: string): string[] {
  const m = message.toLowerCase();
  const flags: string[] = [];
  if (/\b(zelle|cash ?app|venmo|paypal|gift ?card|wire|crypto|bitcoin)\b/.test(m)) flags.push("off_platform_payment");
  if (/\b(right now|asap|immediately|urgent|today only)\b/.test(m)) flags.push("urgency_pressure");
  if (/\b(my (place|car|apartment)|ship (it )?to|different address)\b/.test(m)) flags.push("meetup_change");
  if (/\b(code|password|login|verify|https?:\/\/)\b/.test(m)) flags.push("phishing");
  return flags;
}

export type HaggleAction = "accept" | "counter" | "hold_firm" | "reply" | "warn" | "ignore";

export interface HagglePlan {
  intent: Intent;
  amountCents: number | null;
  action: HaggleAction;
  /** Price the seller's agent proposes or agrees to. Never below the floor. */
  priceCents: number | null;
  scamFlags: string[];
  reply: string;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** Picks the move. Deterministic: models only supply intent / seriousness / flags. */
export function planHaggle(input: {
  askCents: number;
  floorCents: number;
  negotiable: boolean;
  /** Last price the seller's agent offered in this chat, if any. */
  lastCounterCents: number | null;
  intent: Intent;
  amountCents: number | null;
  /** 0–5. */
  seriousness: number;
  lowball: boolean;
  scamFlags: string[];
}): HagglePlan {
  const { askCents: ask, intent, amountCents: amount, scamFlags } = input;
  const floor = Math.min(ask, input.negotiable ? input.floorCents : ask);
  const base = { intent, amountCents: amount, scamFlags };
  const standing = input.lastCounterCents ?? ask;

  if (scamFlags.length) {
    return { ...base, action: "warn", priceCents: null, reply: "Heads up: let's keep payment and the meetup inside the app (in-app pay, campus safe zone). That protects both of us." };
  }
  if (intent === "spam") return { ...base, action: "ignore", priceCents: null, reply: "" };
  if (intent === "decline") return { ...base, action: "reply", priceCents: null, reply: "No worries! It's here if you change your mind." };
  if (intent === "question") return { ...base, action: "reply", priceCents: null, reply: "Good question, I'll get the seller to answer that." };
  if (intent === "logistics") return { ...base, action: "reply", priceCents: null, reply: "Once you've paid in the app you can pick a campus safe zone and time for the handoff." };
  if (intent === "accept" && amount === null) {
    return { ...base, action: "accept", priceCents: standing, reply: `Deal at ${usd(standing)}! Sending you the offer to confirm.` };
  }
  if (amount === null) return { ...base, action: "reply", priceCents: null, reply: `It's listed at ${usd(ask)}. What were you thinking?` };

  if (amount >= standing) return { ...base, action: "accept", priceCents: standing, reply: `Deal at ${usd(standing)}! Sending you the offer to confirm.` };
  if (!input.negotiable || floor >= ask) {
    return { ...base, action: "hold_firm", priceCents: ask, reply: `Sorry, the price is firm at ${usd(ask)}.` };
  }
  if (amount >= floor && (input.seriousness >= 3 || amount >= standing - Math.round((standing - floor) * 0.25))) {
    return { ...base, action: "accept", priceCents: amount, reply: `You've got a deal at ${usd(amount)}. Sending you the offer to confirm.` };
  }
  // Counter: meet in the middle of the buyer's number and our standing price, never under the floor.
  // A lowball (or an unserious buyer) only gets a quarter-step down.
  const step = input.lowball || input.seriousness < 2 ? 0.25 : 0.5;
  const counter = Math.max(floor, Math.ceil((standing - (standing - Math.max(amount, floor)) * step) / 100) * 100);
  if (counter >= standing) {
    return { ...base, action: "hold_firm", priceCents: standing, reply: `${usd(standing)} is the best I can do on this one.` };
  }
  return { ...base, action: "counter", priceCents: Math.min(counter, standing), reply: `Can't go that low, but I could do ${usd(Math.min(counter, standing))}.` };
}

/** JEV's answers (or null) → the inputs planHaggle needs, falling back to rules per question. */
export function readTriage(d: Decisions | null, message: string, amountCents: number | null) {
  const intentIdx = d?.intent ? d.intent.options.indexOf(d.intent.pick) : -1;
  const intent = intentIdx >= 0 ? INTENTS[intentIdx]! : ruleIntent(message, amountCents);
  const seriousness = d?.seriousness?.value ?? (amountCents !== null ? 3 : 2);
  const lowball = d?.lowball ? d.lowball.value >= 0.5 : false;
  const scamFlags = d && Object.keys(SCAM_QUESTIONS).every((k) => d[k])
    ? Object.keys(SCAM_QUESTIONS).filter((k) => d[k]!.value >= SCAM_THRESHOLD)
    : ruleScamFlags(message);
  return { intent, seriousness, lowball, scamFlags };
}
