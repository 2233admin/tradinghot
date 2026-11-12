// From a bare address to a source that reads it. The address itself may be a feed; a page may name its
// feed, or keep one at a usual path; a page with neither is read as a list, from the group of links that
// looks most like its headlines. Whatever is found has returned posts before it is accepted.
import * as cheerio from "cheerio";
import { requireOk } from "../lib/http-fetch.ts";
import { collapseWhitespace } from "../lib/text.ts";
import { fetchListing } from "./listing-fetch.ts";
import { fetchRss } from "./rss.ts";
import { fromHtml } from "./web-list.ts";
import { FetchError, type SourceRow } from "./types.ts";

export interface Discovered {
  kind: "rss" | "web_list";
  config: Record<string, unknown>;
}

const FEED_PATHS = ["feed", "rss", "rss.xml", "atom.xml", "feed.xml", "index.xml"];
const MIN_HEADLINES = 5;
const MIN_HEADLINE_CHARS = 10;

const draft = (kind: Discovered["kind"], config: Record<string, unknown>) => ({ id: "discover", kind, config, cursor: null }) as unknown as SourceRow;

async function readsAsFeed(feedUrl: string): Promise<boolean> {
  try {
    return (await fetchRss(draft("rss", { feedUrl }), { force: true })).candidates.length > 0;
  } catch {
    return false;
  }
}

/** An element as a selector part: its tag and its first plain class (numbered classes differ per post). */
function part(el: { name: string; attribs?: Record<string, string> }): string {
  const cls = (el.attribs?.class ?? "").split(/\s+/).find((c) => /^[A-Za-z][A-Za-z_-]*$/.test(c));
  return cls ? `${el.name}.${cls}` : el.name;
}

/** The selector of the page's headline links: the links of one shape that carry the most headline text. */
export function headlineSelector(html: string, base: string): string | null {
  const $ = cheerio.load(html);
  const origin = new URL(base).origin;
  const groups = new Map<string, { links: Set<string>; chars: number }>();
  for (const node of $("a[href]").toArray()) {
    const chars = [...collapseWhitespace($(node).text())].length;
    if (chars < MIN_HEADLINE_CHARS) continue;
    let url: URL;
    try { url = new URL($(node).attr("href")!, base); } catch { continue; }
    if (url.origin !== origin) continue;
    const chain = [part(node)];
    for (let up = node.parent; up && up.type === "tag" && up.name !== "body" && chain.length < 4; up = up.parent) chain.unshift(part(up));
    const key = chain.join(" > ");
    const group = groups.get(key) ?? { links: new Set<string>(), chars: 0 };
    if (!group.links.has(url.href)) group.chars += chars;
    group.links.add(url.href);
    groups.set(key, group);
  }
  let best: string | null = null;
  for (const [key, group] of groups) {
    if (group.links.size >= MIN_HEADLINES && group.chars > (best ? groups.get(best)!.chars : 0)) best = key;
  }
  return best;
}

export async function discoverSource(address: string): Promise<Discovered> {
  if (await readsAsFeed(address)) return { kind: "rss", config: { feedUrl: address } };
  const res = requireOk(await fetchListing(address, { timeoutMs: 25_000 }));
  const html = res.text();
  const $ = cheerio.load(html);
  const feeds = new Set<string>();
  const add = (href: string | undefined, base: string) => {
    try { if (href) feeds.add(new URL(href, base).href); } catch { /* not an address */ }
  };
  for (const link of $('link[rel~="alternate"][href]').toArray()) {
    // A post's comment feed is announced the same way as the site's.
    if (/rss|atom/i.test($(link).attr("type") ?? "") && !/comments?/i.test($(link).attr("href")!)) add($(link).attr("href"), res.url);
  }
  const page = new URL(res.url);
  for (const path of FEED_PATHS) add(path, page.href.replace(/[^/]*$/, ""));
  for (const path of FEED_PATHS) add(`/${path}`, page.origin);
  feeds.delete(address);
  for (const feedUrl of feeds) if (await readsAsFeed(feedUrl)) return { kind: "rss", config: { feedUrl } };
  const itemSelector = headlineSelector(html, res.url);
  const config = { url: address, itemSelector };
  if (itemSelector && fromHtml(html, res.url, draft("web_list", config)).length >= MIN_HEADLINES) return { kind: "web_list", config };
  throw new FetchError("no feed and no headline list found");
}
