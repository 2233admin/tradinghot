// What the crowding module publishes: the list the public Bagholder 50 index releases each day, and the
// summary that came with it. The list is the index's high-crowding tail, a warning about where money is
// piling up; it is not a buy list and the module never turns it into one.
import { z } from "zod";

export const crowdingItemSchema = z.object({
  /** "600715.SH" */
  tsCode: z.string(),
  name: z.string(),
  /** 1 is the most crowded. */
  rank: z.number(),
  /** The index's own crowding score, 0 to 1. */
  score: z.number(),
  /** The day's return, a decimal. */
  todayReturn: z.number(),
});

export const crowdingIndexSchema = z.object({
  /** The day the index point belongs to. */
  date: z.string(),
  point: z.number(),
  annualizedReturn: z.number(),
  returns: z.object({ d1: z.number(), d5: z.number(), d20: z.number() }),
});

export const crowdingSnapshotSchema = z.object({
  /** "ready": today's list is here. "not_ready": the publisher has not released it yet. "empty": nothing fetched yet. "stale": what we hold is too old to call today's. */
  status: z.enum(["ready", "not_ready", "empty", "stale"]),
  message: z.string().nullable(),
  /** The close the list was computed from. */
  signalDate: z.string().nullable(),
  /** The session the list applies to. */
  tradeDate: z.string().nullable(),
  /** Which of the publisher's views the list is: the session in progress, or the next one. */
  sourceView: z.string().nullable(),
  updatedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  source: z.object({ url: z.string(), sha256: z.string().nullable() }).nullable(),
  index: crowdingIndexSchema.nullable(),
  items: z.array(crowdingItemSchema),
});

export type CrowdingItem = z.infer<typeof crowdingItemSchema>;
export type CrowdingIndexSummary = z.infer<typeof crowdingIndexSchema>;
export type CrowdingSnapshot = z.infer<typeof crowdingSnapshotSchema>;
