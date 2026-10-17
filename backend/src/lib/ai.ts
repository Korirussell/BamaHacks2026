import { noDecider, offlineAiQueue, type AiQueue } from "../adapters/local-ai.js";
import type { Decider } from "../adapters/ports.js";

// The process-wide decision model and AI queue. createApp() sets them from its deps, so deep helpers
// (wishlist alerts, ingest) can ask JEV without threading a parameter through every caller.

let current: { decider: Decider; queue: AiQueue } = { decider: noDecider, queue: offlineAiQueue };

export function setAi(next: { decider: Decider; queue: AiQueue }) {
  current = next;
}

export const decider = (): Decider => current.decider;
export const aiQueue = (): AiQueue => current.queue;
