// What the movers module publishes: the unusual moves the news wires reported in the last while.
// A move is a keyword reading of a headline, not a quote feed: the site collects reports, not prices,
// so the module says "the wires reported a limit-up", never "the stock is up 10%".
import { z } from "zod";

export const moverKindSchema = z.enum(["limit", "halt", "breaker", "spike", "extreme", "up", "down"]);

export const moverSchema = z.object({
  /** The item's id (the same one its page uses) for a reported move, the symbol for a quoted one. */
  id: z.string(),
  title: z.string(),
  kind: moverKindSchema,
  /** What kind of move it is, in the reader's words. */
  label: z.string(),
  sourceName: z.string(),
  /** When the item came in, in ISO time. */
  at: z.string(),
  /** The day's change in percent, when a quote gave it; null for a move read off a headline. */
  changePercent: z.number().nullable(),
});

export const moversResponseSchema = z.object({
  /** How far back the module looks. */
  windowMinutes: z.number(),
  generatedAt: z.string(),
  items: z.array(moverSchema),
});

export type MoverKind = z.infer<typeof moverKindSchema>;
export type Mover = z.infer<typeof moverSchema>;
export type MoversResponse = z.infer<typeof moversResponseSchema>;
