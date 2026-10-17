import type {
  CampusDirectory,
  CourseMaterialsLookup,
  LabelRenderer,
  PostSource,
  RoomBooker,
  SellerOutreach,
  TextbookIdentifier,
} from "./ports.js";

// Demo stand-ins so every flow runs before the real integrations exist.

/** Nothing is scraped yet; posts come in through POST /admin/ingested-posts. */
export const noPostSource: PostSource = { fetchNew: async () => [] };

/** Pulls an ISBN out of the caption if there is one; real version calls Claude vision. */
export const captionTextbookIdentifier: TextbookIdentifier = {
  async identify({ caption }) {
    const isbn = caption.match(/\b(?:97[89][-\s]?)?\d[\d\s-]{8,}[\dXx]\b/)?.[0]?.replace(/[^0-9Xx]/g, "") ?? null;
    const price = caption.match(/\$\s?(\d+(?:\.\d{2})?)/)?.[1];
    return {
      isbn,
      title: caption.split("\n")[0]?.slice(0, 120) ?? "Textbook",
      authors: [],
      edition: caption.match(/(\d+)(?:st|nd|rd|th)\s+ed/i)?.[1] ?? null,
      priceCents: price ? Math.round(Number(price) * 100) : null,
      condition: null,
      confidence: isbn ? 0.6 : 0.2,
    };
  },
};

/** In-memory ISBN → course ids; the real one reads the course_materials table. */
export function staticCourseMaterials(map: Record<string, string[]>): CourseMaterialsLookup {
  return { coursesForIsbn: async (_schoolId, isbn) => map[isbn] ?? [] };
}

/** Leaves the DM queued for a human to send by hand from the team's Instagram. */
export const manualOutreach: SellerOutreach = { send: async () => ({ sent: false }) };

/** No UA directory yet; buyers type their mail stop in their profile. */
export const noDirectory: CampusDirectory = { mailStopFor: async () => null };

/** No booking API yet; send people to the library's booking page. */
export function manualRoomBooker(bookingUrl: string): RoomBooker {
  return { book: async () => ({ status: "manual_required", room: null, bookingUrl }) };
}

/** Label PDFs aren't rendered yet; the frontend can draw the label from the Shipment fields. */
export const placeholderLabelRenderer: LabelRenderer = {
  render: async (label) => ({ pdfUrl: `about:blank#label-${label.label_code}` }),
};

/**
 * Demo only (ROOM_BOOKER=demo): pretends the library confirmed a room so the Demo 1 flow
 * shows a booked state. The room name says it's a demo so nobody walks to it for real.
 */
export function demoRoomBooker(libraryName: string): RoomBooker {
  return {
    book: async ({ start }) => ({
      status: "booked",
      room: `${libraryName} · Group Study Room ${201 + (new Date(start).getUTCHours() % 8)} (demo)`,
      bookingUrl: null,
    }),
  };
}
