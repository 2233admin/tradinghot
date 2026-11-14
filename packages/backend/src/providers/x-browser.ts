// X reads through opencli's twitter adapter: the browser session the user is already logged into.
// This is the free fallback when SocialData's paid search key is not configured.
import { z } from "zod";
import { HttpStatusError } from "../lib/http-fetch.ts";
import type { SdMedia, SdTweet } from "./socialdata.ts";
import { openCliProfile, runOpenCli } from "./opencli.ts";

/**
 * The browser session is shared by every account: X limits how many searches one logged-in session
 * may start, and a refusal costs the whole session a long cooldown. The searches of an hour are
 * therefore counted here, and a refusal rests the session instead of being charged to one account.
 * Sixty accounts read every two hours need thirty searches an hour; the rest of the budget is the
 * room a first fetch and a retry need.
 */
export const BROWSER_X_SEARCHES_PER_HOUR = 40;
/** How long the session rests after X refused a search (opencli's own advice: 15-30 minutes). */
export const BROWSER_X_COOLDOWN_MS = 15 * 60_000;
/** The smallest gap between two searches of the session, so a burst never looks like scraping. */
const BROWSER_X_MIN_GAP_MS = 3_000;
const HOUR_MS = 3_600_000;

const TweetRow = z.object({
  id: z.union([z.string(), z.number()]),
  author: z.string(),
  text: z.string(),
  created_at: z.string(),
  media_urls: z.array(z.string()).optional(),
  media_posters: z.array(z.string()).optional(),
  quoted_tweet: z.object({
    id: z.union([z.string(), z.number()]).optional(),
    author: z.string(),
    name: z.string().optional(),
    text: z.string(),
    created_at: z.string().optional(),
    media_urls: z.array(z.string()).optional(),
    media_posters: z.array(z.string()).optional(),
  }).passthrough().nullish(),
}).passthrough();

const Rows = z.union([z.array(TweetRow), z.object({ data: z.array(TweetRow) }).passthrough()]);

export interface BrowserTweetOptions {
  /** X search query, without SocialData-only operators (`since_id:`). */
  query: string;
  limit: number;
  /** Browser Bridge profile; the adapter's default when null. */
  profile?: string | null;
  timeoutMs?: number;
}

/**
 * The session cannot search right now: its quota is spent, or it rests after a refusal. No account
 * is at fault, so the collector records a throttle instead of a failed source.
 */
export class BrowserXThrottleError extends Error {
  /** When the session may search again. */
  readonly until: number;
  constructor(message: string, until: number) {
    super(message);
    this.until = until;
  }
}

export interface BrowserXQuota {
  /** Searches the session may still start in this hour. */
  remaining: number;
  /** When the session may search again after a refusal. */
  cooldownUntil: number;
}

let windowStart = Date.now();
let searchesThisWindow = 0;
let lastSearchAt = 0;
let cooldownUntil = 0;
/** Permits are handed out one at a time, so two workers never start a search at the same moment. */
let permits: Promise<unknown> = Promise.resolve();

/** What the session may still do: the searches left in this hour and when it rests. */
export function browserXQuota(now = Date.now()): BrowserXQuota {
  if (now - windowStart >= HOUR_MS) {
    windowStart = now;
    searchesThisWindow = 0;
  }
  return { remaining: Math.max(0, BROWSER_X_SEARCHES_PER_HOUR - searchesThisWindow), cooldownUntil };
}

/**
 * The session's own state is cleared: a new login or a fresh quota window starts the hour over, and the
 * rest after a refusal ends with it.
 */
export function resetBrowserXSession(): void {
  windowStart = Date.now();
  searchesThisWindow = 0;
  lastSearchAt = 0;
  cooldownUntil = 0;
}

const sleep = async (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
};

/** Waits for the session's turn: outside a cooldown, inside this hour's budget, and spaced out. */
async function permit(): Promise<void> {
  const turn = permits.then(async () => {
    const now = Date.now();
    if (now < cooldownUntil) {
      throw new BrowserXThrottleError(`browser X session rests until ${new Date(cooldownUntil).toISOString()}`, cooldownUntil);
    }
    if (browserXQuota(now).remaining <= 0) {
      throw new BrowserXThrottleError("browser X session search budget for this hour is spent", windowStart + HOUR_MS);
    }
    const gap = lastSearchAt + BROWSER_X_MIN_GAP_MS - now;
    if (gap > 0) await sleep(gap);
    lastSearchAt = Date.now();
    searchesThisWindow += 1;
  });
  permits = turn.then(() => undefined, () => undefined);
  await turn;
}

/**
 * The media a row carries, as the collector reads it. A video keeps its still (the site shows the
 * still and links to the original post; it never pretends the file plays here) and a photo keeps its
 * own address.
 */
function rowMedia(urls: string[] | undefined, posters: string[] | undefined): SdMedia[] {
  return (urls ?? []).map((url, i) => {
    const poster = posters?.[i];
    // opencli lists a video's file and its still in two arrays; a photo is the same address twice.
    const video = (poster && poster !== url) || /\.mp4(\?|$)/i.test(url);
    return video ? { type: "video", media_url_https: poster ?? url } : { type: "photo", media_url_https: url };
  });
}

/** One opencli row to the SocialData shape the rest of the collector already reads. */
function toTweet(row: z.infer<typeof TweetRow>): SdTweet {
  const author = row.author.replace(/^@/, "");
  const text = row.text;
  const retweet = /^RT @/.test(text);
  const quoted = row.quoted_tweet;
  const quotedText = quoted?.text?.trim() ?? "";
  const quotedMedia = rowMedia(quoted?.media_urls, quoted?.media_posters);
  const media = rowMedia(row.media_urls, row.media_posters);
  return {
    id_str: String(row.id),
    tweet_created_at: row.created_at,
    full_text: text,
    user: { name: author, screen_name: author },
    // The collector drops retweets; carry one so the row is filtered like a SocialData answer.
    retweeted_status: retweet ? { id_str: String(row.id), tweet_created_at: row.created_at, full_text: text, user: { name: author, screen_name: author } } : null,
    // The quoted post keeps its own id, so its link and its translation can be found.
    quoted_status: quoted && quotedText
      ? {
        id_str: quoted.id === undefined ? "" : String(quoted.id),
        tweet_created_at: quoted.created_at ?? row.created_at,
        full_text: quoted.text,
        user: { name: quoted.name ?? quoted.author, screen_name: quoted.author },
        entities: quotedMedia.length ? { media: quotedMedia } : undefined,
        retweeted_status: null,
      }
      : null,
    is_quote_status: !!(quoted && quotedText),
    entities: media.length ? { media } : undefined,
  };
}

function rowsFrom(stdout: string): Array<z.infer<typeof TweetRow>> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("opencli X search returned invalid JSON");
  }
  const parsed = Rows.safeParse(raw);
  if (!parsed.success) throw new Error("opencli X search returned an invalid response shape");
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
}

/** What opencli printed as SocialData-shaped tweets; exported for the shape test. */
export function browserRowsToTweets(stdout: string): SdTweet[] {
  return rowsFrom(stdout).map(toTweet);
}

/** Recent posts from opencli; its output does not prove that the requested interval is complete. */
export async function searchTweetsInBrowser(opts: BrowserTweetOptions): Promise<SdTweet[]> {
  const query = opts.query.replace(/\s*since_id:\S+/g, "").trim();
  if (!query) return [];
  const profile = opts.profile ?? process.env.X_OPENCLI_PROFILE ?? null;
  await permit();
  let stdout: string;
  try {
    stdout = await runOpenCli(
      [...openCliProfile(profile), "twitter", "search", query, "--product", "live", "--limit", String(opts.limit), "-f", "json"],
      opts.timeoutMs ?? 120_000,
      { parallelXSearch: true },
    );
  } catch (error) {
    // A refusal by X rests the whole session: the quota it spent is the session's, not one account's.
    if (error instanceof Error && /^opencli failed: (?:HTTP 429:|ok: false error: code: \S+ message: (?:>[-+]? )?['"]?HTTP 429:)/.test(error.message)) {
      cooldownUntil = Date.now() + BROWSER_X_COOLDOWN_MS;
      throw new HttpStatusError(429, error.message);
    }
    throw error;
  }
  return browserRowsToTweets(stdout);
}
