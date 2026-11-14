// X reads through opencli's twitter adapter: the browser session the user is already logged into.
// This is the free fallback when SocialData's paid search key is not configured.
import { z } from "zod";
import { HttpStatusError } from "../lib/http-fetch.ts";
import type { SdMedia, SdTweet } from "./socialdata.ts";
import { openCliProfile, runOpenCli } from "./opencli.ts";

export {
  BROWSER_X_COOLDOWN_MS,
  BROWSER_X_SEARCHES_PER_HOUR,
  BrowserXThrottleError,
  browserXQuota,
  permitBrowserXSearch,
  resetBrowserXSession,
  restBrowserXSession,
} from "./x-quota.ts";
import { permitBrowserXSearch, restBrowserXSession } from "./x-quota.ts";

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
  await permitBrowserXSearch();
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
      restBrowserXSession();
      throw new HttpStatusError(429, error.message);
    }
    throw error;
  }
  return browserRowsToTweets(stdout);
}
