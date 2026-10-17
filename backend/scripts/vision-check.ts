// Runs the configured vision identifier (Gemma worker → Claude → caption parser) on a real listing photo
// from storage and prints the guess plus the auto-priced draft. `pnpm tsx --env-file=.env scripts/vision-check.ts`
import { buildServer } from "../src/server.js";
import { adminClient, publicMediaUrl } from "../src/lib/supabase.js";
import { claudeTextbookIdentifier } from "../src/adapters/claude-vision.js";
import { captionTextbookIdentifier } from "../src/adapters/stubs.js";
import { draftFromScreenshot } from "../src/services/listing-draft.js";

const { config, summary } = buildServer();
console.log("server:", summary);
const media = await adminClient().from("media").select("bucket, path").eq("bucket", "public-media").eq("uploaded", true).eq("kind", "image").order("created_at", { ascending: false }).limit(1);
if (media.error || !media.data?.length) throw new Error("no uploaded image in storage");
const url = publicMediaUrl(media.data[0]!.bucket, media.data[0]!.path);
console.log("image:", url);
const id = claudeTextbookIdentifier({ apiKey: config.ANTHROPIC_API_KEY!, model: config.CLAUDE_VISION_MODEL, fallback: captionTextbookIdentifier });
const t0 = Date.now();
const guess = await id.identify({ imageUrls: [url], caption: "" });
console.log(`guess (${Date.now() - t0} ms):`, JSON.stringify(guess));
console.log("draft:", JSON.stringify(draftFromScreenshot(guess, [], [])));
