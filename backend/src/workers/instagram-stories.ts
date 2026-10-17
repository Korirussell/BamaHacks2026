import type { InstagramGraph } from "../adapters/instagram.js";
import type { SellerOutreach, TextbookIdentifier } from "../adapters/ports.js";
import { ApiError } from "../lib/errors.js";
import { DmWindowClosedError, sellerDms } from "../services/instagram-dm.js";
import { asDm, listedReply, offerReply, pipelineEvent, type PipelineEvent } from "../services/instagram.js";
import type { IngestResult } from "./ingest.js";
import { appendEvents, ingestJobForListing, ingestJobForPost, mediaPoller, type InstagramPoller, type MediaSource, type StoryDms } from "./instagram-poller.js";

// INSTAGRAM=stories: the seller account (its own token) reads its own stories; each new one goes
// through the same ingest as tagged posts. Our account then DMs the seller ("listed", and the claim
// link on the first offer), but only while the 24 h window the seller opened by DMing us is open.

export function instagramStoriesPoller(deps: {
  /** Our account (INSTAGRAM_ACCESS_TOKEN): reads conversations, sends the DMs. */
  platform: InstagramGraph;
  /** The seller account (INSTAGRAM_SELLER_TOKEN): reads its own stories. */
  seller: InstagramGraph;
  sellerUsername?: string | undefined;
  sellerIgsid?: string | undefined;
  identifier: TextbookIdentifier;
  schoolId: string;
  appName: string;
  autoDm: boolean;
  intervalMs: number;
  fetch?: typeof fetch;
  now?: () => number;
}): InstagramPoller {
  let username = deps.sellerUsername?.replace(/^@+/, "") || undefined;
  const sellerUsername = async () => (username ??= (await deps.seller.me()).username);
  const window = sellerDms({ platform: deps.platform, sellerUsername, sellerIgsid: deps.sellerIgsid, ...(deps.now ? { now: deps.now } : {}) });

  /** DMs the seller and says how it went, as a feed event. */
  async function dm(text: string, sentText: string): Promise<PipelineEvent> {
    try {
      await window.send(text);
      return pipelineEvent("dm_sent", sentText);
    } catch (err) {
      if (err instanceof DmWindowClosedError) return pipelineEvent("dm_window_closed", err.message);
      return pipelineEvent("dm_failed", `Couldn't DM the seller: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  const listedDm = (handle: string, r: IngestResult) => asDm(listedReply({
    handle, title: r.title, priceCents: r.price_cents, courseCodes: r.course_codes, notified: r.notified, appName: deps.appName,
  }));

  const src: MediaSource = {
    mode: "stories",
    source: "instagram_stories",
    accounts: async () => ({ account: (await deps.platform.me()).username, seller_account: await sellerUsername() }),
    media: async () => deps.seller.stories(await sellerUsername()),
    detected: (m) => `@${m.username} posted a story`,
    async afterListed(m, result) {
      return deps.autoDm ? [await dm(listedDm(m.username, result), `DMed @${m.username} that it's listed`)] : [];
    },
    dmWindow: () => window.window(),
  };

  const outreach: SellerOutreach = {
    async send(input) {
      if (input.channel !== "instagram" || !deps.autoDm) return { sent: false };
      const job = await ingestJobForListing(input.listingId);
      if (job?.payload.source !== "instagram_stories") return { sent: false }; // not one of the seller's stories
      const event = await dm(
        asDm(offerReply({ handle: input.handle, offerCents: input.offerCents, courseCode: input.courseCode, url: input.claimUrl })),
        `First offer in: DMed @${input.handle} the claim link`,
      );
      if (job.result) await appendEvents(job.id, job.result, [event]);
      return { sent: event.step === "dm_sent" };
    },
  };

  const dms: StoryDms = {
    window: () => window.window(),
    send: (text) => window.send(text),
    refreshWindow: () => window.refresh(),
    async resendListed(ingestedPostId) {
      const job = await ingestJobForPost(ingestedPostId);
      if (!job || job.payload.source !== "instagram_stories") throw new ApiError(404, "NOT_FOUND", "No ingested story with that id");
      if (job.result?.status !== "active") throw new ApiError(409, "INVALID_STATE", "That story isn't a live listing");
      const handle = await sellerUsername();
      const event = await dm(listedDm(handle, job.result), `DMed @${handle} that it's listed (sent by hand)`);
      await appendEvents(job.id, job.result, [event]);
      if (event.step === "dm_window_closed") throw new DmWindowClosedError(event.text);
      return { sent: event.step === "dm_sent", event };
    },
  };

  return mediaPoller({
    src, identifier: deps.identifier, schoolId: deps.schoolId, intervalMs: deps.intervalMs, outreach, dms,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}
