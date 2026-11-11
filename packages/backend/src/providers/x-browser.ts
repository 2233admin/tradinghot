// X reads through opencli's twitter adapter: the browser session the user is already logged into.
// This is the free fallback when SocialData's paid search key is not configured.
import { z } from "zod";
import { HttpStatusError } from "../lib/http-fetch.ts";
import type { SdTweet } from "./socialdata.ts";
import { openCliProfile, runOpenCli } from "./opencli.ts";

const TweetRow = z.object({
  id: z.union([z.string(), z.number()]),
  author: z.string(),
  text: z.string(),
  created_at: z.string(),
  media_urls: z.array(z.string()).optional(),
  quoted_tweet: z.object({ author: z.string().optional(), text: z.string().optional() }).passthrough().nullish(),
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

/** One opencli row to the SocialData shape the rest of the collector already reads. */
function toTweet(row: z.infer<typeof TweetRow>): SdTweet {
  const author = row.author.replace(/^@/, "");
  const text = row.text;
  const retweet = /^RT @/.test(text);
  const quoted = row.quoted_tweet;
  return {
    id_str: String(row.id),
    tweet_created_at: row.created_at,
    full_text: text,
    user: { name: author, screen_name: author },
    // The collector drops retweets; carry one so the row is filtered like a SocialData answer.
    retweeted_status: retweet ? { id_str: String(row.id), tweet_created_at: row.created_at, full_text: text, user: { name: author, screen_name: author } } : null,
    quoted_status: quoted && (quoted.text ?? "").trim()
      ? { id_str: "", tweet_created_at: row.created_at, full_text: quoted.text, user: { name: quoted.author ?? "", screen_name: quoted.author ?? "" } }
      : null,
    is_quote_status: !!(quoted && (quoted.text ?? "").trim()),
    entities: row.media_urls?.length
      ? { media: row.media_urls.map((url) => ({ type: "photo" as const, media_url_https: url })) }
      : undefined,
  };
}

function rowsFrom(stdout: string): Array<z.infer<typeof TweetRow>> {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return [];
  }
  const parsed = Rows.safeParse(raw);
  if (!parsed.success) return [];
  return Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
}

/** What opencli printed as SocialData-shaped tweets; exported for the shape test. */
export function browserRowsToTweets(stdout: string): SdTweet[] {
  return rowsFrom(stdout).map(toTweet);
}

/** Recent posts for one search, newest first; no cursor, so the next read starts from the watermark. */
export async function searchTweetsInBrowser(opts: BrowserTweetOptions): Promise<SdTweet[]> {
  const query = opts.query.replace(/\s*since_id:\S+/g, "").trim();
  if (!query) return [];
  const profile = opts.profile ?? process.env.X_OPENCLI_PROFILE ?? null;
  let stdout: string;
  try {
    stdout = await runOpenCli(
      [...openCliProfile(profile), "twitter", "search", query, "--product", "live", "--limit", String(opts.limit), "-f", "json"],
      opts.timeoutMs ?? 120_000,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("opencli failed: HTTP 429:")) {
      throw new HttpStatusError(429, error.message);
    }
    throw error;
  }
  return browserRowsToTweets(stdout);
}
