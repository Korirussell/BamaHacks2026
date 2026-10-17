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
}

/** Claude vision: post photo + caption → which textbook is this. */
export interface TextbookIdentifier {
  identify(input: { imageUrls: string[]; caption: string }): Promise<TextbookGuess>;
}

/** ISBN → required-by courses (bookstore list, or our seeded course_materials table). */
export interface CourseMaterialsLookup {
  coursesForIsbn(schoolId: string, isbn: string): Promise<string[]>;
}

/** Sends the claim DM. Until automated, "sending" = queueing for a human. */
export interface SellerOutreach {
  send(input: { channel: ExternalPost["channel"]; handle: string; message: string }): Promise<{ sent: boolean }>;
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
