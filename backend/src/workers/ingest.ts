import { z } from "zod";
import type { KnownBook, TextbookIdentifier } from "../adapters/ports.js";
import { CourseRow } from "../db/academics.js";
import { loadListingRow } from "../db/market.js";
import { notifyWishlistMatch } from "../db/wishlist.js";
import { notify } from "../lib/notify.js";
import { adminClient, publicMediaUrl } from "../lib/supabase.js";
import { draftFromPost, type KnownMaterial } from "../services/ingest.js";
import { pipelineEvent, type PipelineEvent } from "../services/instagram.js";
import { interestedStudents, normalizeIsbn } from "../services/materials.js";

// ingest_classify: an external post becomes an unclaimed listing, and every student whose
// class needs the book hears about it. Runs inline for now; the job row records the outcome.

const PostRow = z.object({
  id: z.guid(), school_id: z.guid(), channel: z.enum(["instagram", "groupme", "facebook", "snapchat"]),
  external_url: z.string(), author_handle: z.string(), caption: z.string(), media_ids: z.array(z.guid()), posted_at: z.string(),
});
const MaterialRow = z.object({ course_id: z.guid(), isbn: z.string(), title: z.string(), authors: z.array(z.string()), edition: z.string().nullable() });
const PostMediaRow = z.object({ id: z.guid(), bucket: z.string(), path: z.string() });

export interface IngestResult {
  listing_id: string;
  status: "active" | "draft";
  isbn: string | null;
  missing: string[];
  matched_course_ids: string[];
  course_codes: string[];
  notified: number;
  title: string;
  price_cents: number;
  identified_by: "vision" | "caption";
  confidence: number;
  /** Each step, for the admin live-sources feed. */
  events: PipelineEvent[];
}

const check = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

export async function materialsFor(schoolId: string, isbn: string): Promise<KnownMaterial[]> {
  const data = check(await adminClient().from("course_materials").select("course_id, isbn, title, authors, edition").eq("school_id", schoolId).eq("isbn", isbn));
  return z.array(MaterialRow).parse(data).map((m) => ({ courseId: m.course_id, title: m.title, authors: m.authors, edition: m.edition }));
}

/** Every book a class at the school requires, so vision can match a cover photo to an ISBN. */
export async function knownBooks(schoolId: string): Promise<KnownBook[]> {
  const data = check(await adminClient().from("course_materials").select("course_id, isbn, title, authors, edition").eq("school_id", schoolId).limit(500));
  const byIsbn = new Map(z.array(MaterialRow).parse(data).map((m) => [m.isbn, { isbn: m.isbn, title: m.title, edition: m.edition, authors: m.authors }]));
  return [...byIsbn.values()];
}

/** The post's photos that were actually uploaded to the public bucket (listing photos are public). */
async function postPhotos(schoolId: string, mediaIds: string[]) {
  if (!mediaIds.length) return [];
  const data = check(
    await adminClient().from("media").select("id, bucket, path").eq("school_id", schoolId).eq("bucket", "public-media").eq("uploaded", true).in("id", mediaIds),
  );
  const found = new Map(z.array(PostMediaRow).parse(data).map((m) => [m.id, m]));
  return mediaIds.flatMap((id) => found.get(id) ?? []);
}

/** material.match for every student whose current or planned class needs this listing's book. Returns how many were told. */
export async function notifyMaterialMatch(input: {
  schoolId: string; listingId: string; courseIds: string[]; title: string; priceCents: number; sellerId: string | null; from: string;
}) {
  const { schoolId, listingId, courseIds, title, priceCents } = input;
  if (!courseIds.length) return 0;
  const db = adminClient();
  const [records, courses] = await Promise.all([
    db.from("class_records").select("user_id, course_id, status").eq("school_id", schoolId).in("course_id", courseIds).in("status", ["current", "planned"]),
    db.from("courses").select("*").in("id", courseIds),
  ]);
  const classes = z.array(z.object({ user_id: z.guid(), course_id: z.guid(), status: z.enum(["current", "past", "planned"]) })).parse(check(records));
  const byId = new Map(z.array(CourseRow).parse(check(courses)).map((c) => [c.id, c]));
  const matches = interestedStudents({
    requiredByCourseIds: courseIds,
    classes: classes.map((c) => ({ userId: c.user_id, courseId: c.course_id, status: c.status })),
    sellerUserId: input.sellerId,
  });
  const price = `$${(priceCents / 100).toFixed(2).replace(/\.00$/, "")}`;
  await Promise.all(matches.map((m) => {
    const code = byId.get(m.courseId)?.code ?? "your class";
    return notify({
      schoolId, userId: m.userId, type: "material.match",
      title: `A book for ${code} is for sale`,
      body: `${title} · ${price} from ${input.from}`,
      deepLink: `/listings/${listingId}`,
      data: { listing_id: listingId, course_id: m.courseId },
    });
  }));
  return matches.length;
}

async function courseCodes(courseIds: string[]) {
  if (!courseIds.length) return [];
  const data = check(await adminClient().from("courses").select("code").in("id", courseIds));
  return z.array(z.object({ code: z.string() })).parse(data).map((c) => c.code).sort();
}

export async function runIngest(postId: string, identifier: TextbookIdentifier): Promise<IngestResult> {
  const db = adminClient();
  const post = PostRow.parse(check(await db.from("ingested_posts").select("*").eq("id", postId).single()));
  const photos = await postPhotos(post.school_id, post.media_ids);
  const events: PipelineEvent[] = [];
  const guess = await identifier.identify({ imageUrls: photos.map((p) => publicMediaUrl(p.bucket, p.path)), caption: post.caption, knownBooks: await knownBooks(post.school_id) });
  const isbn = guess.isbn ? normalizeIsbn(guess.isbn) : null;
  const materials = isbn ? await materialsFor(post.school_id, isbn) : [];
  const result = draftFromPost({ channel: post.channel, authorHandle: post.author_handle, caption: post.caption }, guess, () => materials);
  const by = guess.source === "vision" ? `Claude read the ${photos.length ? "photo" : "caption"}` : "Caption parser";
  const what = result.isbn ? `${result.textbookTitle ?? result.title} · ISBN ${result.isbn}` : "no textbook found";
  events.push(pipelineEvent("identified", `${by}: ${what} (${Math.round(guess.confidence * 100)}% sure)${guess.evidence ? ` · ${guess.evidence}` : ""}`));

  const listing = check(
    await db.from("listings").insert({
      school_id: post.school_id, seller_id: null,
      external_channel: post.channel, external_handle: result.externalHandle, external_profile_url: result.externalProfileUrl,
      category: result.category, title: result.title, description: result.description, price_cents: result.priceCents,
      negotiable: true, condition: result.condition, isbn: result.isbn, textbook_title: result.textbookTitle,
      authors: result.authors, edition: result.edition, fulfillment: ["in_person", "campus_mail"], status: result.status,
      source_channel: post.channel, external_url: post.external_url, ingested_post_id: post.id,
    }).select("id").single(),
  ) as { id: string };

  const children = await Promise.all([
    result.courseIds.length ? db.from("listing_courses").insert(result.courseIds.map((course_id) => ({ listing_id: listing.id, course_id }))) : null,
    photos.length ? db.from("listing_media").insert(photos.map((p, position) => ({ listing_id: listing.id, media_id: p.id, position }))) : null,
  ]);
  for (const r of children) if (r?.error) throw r.error;

  const codes = await courseCodes(result.courseIds);
  if (codes.length) events.push(pipelineEvent("matched_courses", `Required for ${codes.join(", ")}`));
  events.push(pipelineEvent("listed", result.status === "active" ? `Listed at $${(result.priceCents / 100).toFixed(2)}` : `Saved as a draft (missing ${result.missing.join(", ")})`));

  const notified = result.status === "active"
    ? await notifyMaterialMatch({
      schoolId: post.school_id, listingId: listing.id, courseIds: result.courseIds, title: result.textbookTitle ?? result.title,
      priceCents: result.priceCents, sellerId: null, from: `@${result.externalHandle}`,
    })
    : 0;
  if (notified) events.push(pipelineEvent("notified", `Told ${notified} student${notified === 1 ? "" : "s"} who need it`));
  const wished = result.status === "active" ? await notifyWishlistMatch(await loadListingRow(listing.id, post.school_id), `@${result.externalHandle}`) : 0;
  if (wished) events.push(pipelineEvent("notified", `Told ${wished} student${wished === 1 ? "" : "s"} it's on their wishlist`));
  const posted = await db.from("ingested_posts").update({ status: "processed" }).eq("id", post.id);
  if (posted.error) throw posted.error;
  return {
    listing_id: listing.id, status: result.status, isbn: result.isbn, missing: result.missing, matched_course_ids: result.courseIds,
    course_codes: codes, notified, title: result.textbookTitle ?? result.title, price_cents: result.priceCents,
    identified_by: guess.source ?? "caption", confidence: guess.confidence, events,
  };
}
