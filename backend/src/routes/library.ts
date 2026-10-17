import { Hono } from "hono";
import type { RoomAvailability } from "../adapters/ports.js";
import { one } from "../lib/respond.js";
import { parseQuery } from "../lib/validate.js";
import { requireUser, type AuthEnv, type TokenVerifier } from "../middleware/auth.js";
import { LibraryRoomsQuery } from "../schemas/tutoring.js";

export const libraryRoutes = (verify: TokenVerifier, availability: RoomAvailability) => new Hono<AuthEnv>()
  .use("/library/*", requireUser(verify))

  /** Free study-room slots on a library-local day, for a "rooms free now" card. [] when LibCal is off or down. */
  .get("/library/rooms", async (c) => {
    const { date } = parseQuery(c, LibraryRoomsQuery);
    return c.json(one(await availability.freeRooms(date)));
  });
