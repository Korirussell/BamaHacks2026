import { loadEventRow } from "../db/events.js";
import { ApiError } from "../lib/errors.js";
import type { TicketInput } from "../schemas/listings.js";

export type TicketTransfer = TicketInput["transfer"];

const invalid = (field: string, message: string) => new ApiError(400, "VALIDATION", "Invalid request", { [field]: message });

/** A ticket changes hands one way, so its listing's fulfillment follows from the transfer. */
export const ticketFulfillment = (transfer: TicketTransfer) => (transfer === "app_transfer" ? "digital_transfer" : "in_person");

/** The ticket columns of a listing row: all null unless the listing is a ticket. */
export function ticketColumns(category: string, ticket: TicketInput | undefined) {
  if (category !== "ticket") {
    if (ticket) throw invalid("ticket", "Only ticket listings have ticket details");
    return { event_id: null, ticket_section: null, ticket_row: null, ticket_seat: null, ticket_transfer: null };
  }
  if (!ticket) throw invalid("ticket", "Tickets need an event, section and transfer method");
  return {
    event_id: ticket.event_id, ticket_section: ticket.section, ticket_row: ticket.row ?? null, ticket_seat: ticket.seat ?? null, ticket_transfer: ticket.transfer,
  };
}

/** A stored ticket as request input, so PATCH can re-check it when the body leaves it out. */
export function ticketInputOf(row: {
  event_id?: string | null | undefined; ticket_section?: string | null | undefined; ticket_row?: string | null | undefined;
  ticket_seat?: string | null | undefined; ticket_transfer?: TicketTransfer | null | undefined;
}): TicketInput | undefined {
  if (!row.event_id || !row.ticket_section || !row.ticket_transfer) return undefined;
  return { event_id: row.event_id, section: row.ticket_section, row: row.ticket_row, seat: row.ticket_seat, transfer: row.ticket_transfer };
}

export function assertUpcoming(startsAt: string, now = Date.now()) {
  if (Date.parse(startsAt) <= now) throw invalid("ticket.event_id", "This event already started");
}

/** Columns to store for a listing, plus the fulfillment a ticket forces (null for other categories). */
export async function ticketFields(category: string, ticket: TicketInput | undefined, schoolId: string) {
  const columns = ticketColumns(category, ticket);
  if (!ticket || !columns.event_id) return { columns, fulfillment: null };
  try {
    assertUpcoming((await loadEventRow(columns.event_id, schoolId)).starts_at);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw invalid("ticket.event_id", "Unknown event");
    throw err;
  }
  return { columns, fulfillment: [ticketFulfillment(ticket.transfer)] };
}

/** ticket-sent / ticket-received only apply to app-transfer ticket orders. */
export function assertAppTransfer(listing: { category: string; ticket_transfer?: TicketTransfer | null | undefined }) {
  if (listing.category !== "ticket") throw new ApiError(409, "INVALID_STATE", "This order isn't for a ticket");
  if (listing.ticket_transfer !== "app_transfer") throw new ApiError(409, "INVALID_STATE", "This ticket changes hands in person; use the handoff");
}
