// BrowserMCP's own X adapter: it reads the search the signed-in web UI makes, in the browser
// session the user is logged into, and returns one tweet as a flat row. The host's bridge runs
// it in a tab of its own and closes that tab again, so the tab the user works in is never
// touched — unlike the opencli path, which works in the tab that is in front.
import net from "node:net";
import { credential } from "../config.ts";
import type { SdMedia, SdTweet } from "./socialdata.ts";
import { browserXQuota, BrowserXThrottleError, permitBrowserXSearch, restBrowserXSession } from "./x-quota.ts";

/** One tweet as BrowserMCP's X adapter returns it. */
export interface XAdapterRow {
  id: string;
  author: string;
  name?: string;
  text: string;
  created_at: string;
  url?: string;
  links?: string[];
  media?: string[];
}

/**
 * The media a row carries, as the collector reads it: a video keeps its still (the site shows the
 * still and links to the original post; it never pretends the file plays here) and a photo keeps its
 * own address.
 */
function rowMedia(urls: string[] | undefined): SdMedia[] {
  return (urls ?? []).map((url) => (/[?&]format=mp4|\.mp4(\?|$)/i.test(url)
    ? { type: "video" as const, media_url_https: url }
    : { type: "photo" as const, media_url_https: url }));
}

/** One row of the X adapter, as the collector's tweet. */
export function adapterRowToTweet(row: XAdapterRow): SdTweet {
  const media = rowMedia(row.media);
  const text = row.text ?? "";
  const author = row.name ?? row.author;
  return {
    id_str: String(row.id),
    tweet_created_at: row.created_at,
    full_text: text,
    user: { name: author, screen_name: row.author },
    entities: {
      ...(media.length ? { media } : {}),
      ...(row.links?.length ? { urls: row.links.map((url) => ({ url, expanded_url: url })) } : {}),
    },
    // The collector drops retweets; carry one so the row is filtered like a SocialData answer.
    retweeted_status: /^RT @/.test(text)
      ? { id_str: String(row.id), tweet_created_at: row.created_at, full_text: text, user: { name: author, screen_name: row.author } }
      : null,
    quoted_status: null,
    is_quote_status: false,
  };
}

/** The browser reader is not there: the search cannot run at all. */
export class BrowserXUnavailable extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** The X session refused the search: its quota is spent, so the whole session rests. */
function refusedByX(reason: string): BrowserXThrottleError {
  restBrowserXSession();
  return new BrowserXThrottleError(reason, browserXQuota().cooldownUntil);
}

/** One search through the host's bridge, in the browser session the user is signed into. */
async function browserXSearch(query: string, limit: number): Promise<XAdapterRow[]> {
  const socketPath = credential("collectors", "BROWSERMCP_BRIDGE_SOCKET");
  if (!socketPath) throw new BrowserXUnavailable("no browser reader on this machine");
  const { promise, resolve, reject } = Promise.withResolvers<XAdapterRow[]>();
  const socket = net.createConnection(socketPath);
  let buffer = "";
  let done = false;
  const fail = (error: Error) => { if (!done) { done = true; socket.destroy(); reject(error); } };
  socket.setEncoding("utf8");
  socket.setTimeout(70_000, () => fail(new BrowserXUnavailable("the browser reader did not answer in time")));
  socket.on("error", () => fail(new BrowserXUnavailable("the browser reader is not reachable")));
  socket.on("close", () => { if (!done) fail(new BrowserXUnavailable("the browser reader closed the connection")); });
  socket.on("connect", () => socket.write(JSON.stringify({ source: "x-search", query, limit }) + "\n"));
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 400_000) return fail(new BrowserXUnavailable("the browser reader's answer was too large"));
    const end = buffer.indexOf("\n");
    if (end < 0) return;
    try {
      const value = JSON.parse(buffer.slice(0, end));
      if (value.ok !== true || !Array.isArray(value.rows)) {
        const reason = typeof value.reason === "string" ? value.reason : "the browser reader refused the search";
        // A refusal by X is the session's quota, so the whole session rests.
        if (/rate|quota|429/i.test(reason)) return fail(refusedByX(reason));
        return fail(new BrowserXUnavailable(reason));
      }
      done = true;
      socket.destroy();
      resolve(value.rows as XAdapterRow[]);
    } catch { fail(new BrowserXUnavailable("the browser reader answered with something that is not JSON")); }
  });
  return promise;
}

/**
 * One X search in the browser session. The session's hour of searches is counted here as well:
 * X limits how many searches one signed-in session may start, and a refusal costs the whole
 * session a long cooldown.
 */
export async function searchTweetsInBrowserMcp(opts: { query: string; limit: number }): Promise<SdTweet[]> {
  await permitBrowserXSearch();
  const rows = await browserXSearch(opts.query, opts.limit);
  return rows.map(adapterRowToTweet);
}
