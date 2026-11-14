// Every upstream source is scheduled. Rankings are signals, not independently published news;
// feeds retain their own publication times when the upstream adapter provides them.
import { newsnowSources } from "./registry.ts";

export interface NewsnowSourceChoice {
  /** The source's id in the upstream registry. */
  id: string;
  /** How its entries take part in the site's news. */
  mode: "editorial" | "hot_signal";
}

export const NEWSNOW_SOURCES: NewsnowSourceChoice[] = newsnowSources().map((source) => ({
  id: source.id,
  mode: source.type === "hottest" ? "hot_signal" : "editorial",
}));
