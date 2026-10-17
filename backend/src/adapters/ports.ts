// External services behind interfaces. Real adapters plug in later; stubs.ts has demo stand-ins.

export interface ExternalPost {
  channel: "instagram" | "groupme" | "facebook" | "snapchat";
  externalUrl: string;
  authorHandle: string;
  caption: string;
  imageUrls: string[];
  postedAt: string;
}

/** Instagram scraper / GroupMe bot / etc. */
export interface PostSource {
  fetchNew(since: string): Promise<ExternalPost[]>;
}

export interface TextbookGuess {
  isbn: string | null;
  title: string;
  authors: string[];
  edition: string | null;
  priceCents: number | null;
  condition: "new" | "like_new" | "good" | "fair" | "poor" | null;
  confidence: number;
  /** What made the call: Claude reading the photo, or the caption parser. */
  source?: "vision" | "caption";
  /** One line on how it was recognised, e.g. "Cover title and edition match a CH 101 book". */
  evidence?: string;
}

/** A book some class at the school requires (course_materials), so the photo can be matched to it. */
export interface KnownBook {
  isbn: string;
  title: string;
  edition: string | null;
  authors: string[];
}

/** Claude vision: post photo + caption → which textbook is this. */
export interface TextbookIdentifier {
  identify(input: { imageUrls: string[]; caption: string; knownBooks?: KnownBook[] }): Promise<TextbookGuess>;
}

/** ISBN → required-by courses (bookstore list, or our seeded course_materials table). */
export interface CourseMaterialsLookup {
  coursesForIsbn(schoolId: string, isbn: string): Promise<string[]>;
}

/**
 * Tells an external seller about an offer. Instagram: a public reply on the post that tagged us.
 * `sent: false` leaves the invite queued for a human to send by hand.
 */
export interface SellerOutreach {
  send(input: { channel: ExternalPost["channel"]; handle: string; message: string; listingId: string; offerCents: number | null; courseCode: string | null; claimUrl: string }): Promise<{ sent: boolean }>;
}

/** UA mail stop for a student, if a directory exists. */
export interface CampusDirectory {
  mailStopFor(email: string): Promise<string | null>;
}

export interface RoomBookingResult {
  status: "booked" | "manual_required";
  room: string | null;
  bookingUrl: string | null;
}

/** Library study-room booking. */
export interface RoomBooker {
  book(input: { schoolId: string; start: string; end: string; partySize: number }): Promise<RoomBookingResult>;
}

/** Label PDF rendering. */
export interface LabelRenderer {
  render(label: import("../services/shipping.js").LabelData): Promise<{ pdfUrl: string }>;
}
