// The NewsNow adapters' support code, ported from upstream (MIT, © 2024 ourongxing).
//
// Upstream's Nuxt build injected these names into every adapter file (defineSource, myFetch, …) and
// read the RSS helper from server/utils. Here the adapters import them by name, and the helpers are
// adapted: the requests go through this module's own fetch layer, the dates through the engine's
// date readers, and the hashes through node:crypto. What the adapters do with the results is
// upstream's, unchanged.
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { parseLooseDate, readRelativeDate } from "@aihot/backend/sources/dates";
import { fetchUrl, type FetchOptions } from "../fetch.ts";
import type { NewsItem } from "./types.ts";

export type { NewsItem };

export type SourceGetter = () => Promise<NewsItem[]>;

export interface SourceOption {
  /** The source's dates are not published. */
  hiddenDate?: boolean;
}

/** One adapter, or a few under their own names. */
export function defineSource(source: SourceGetter): SourceGetter;
export function defineSource(source: Record<string, SourceGetter>): Record<string, SourceGetter>;
export function defineSource(source: SourceGetter | Record<string, SourceGetter>): SourceGetter | Record<string, SourceGetter> {
  return source;
}

/** A source that publishes an RSS feed. */
export function defineRSSSource(url: string, option?: SourceOption): SourceGetter {
  return async () => {
    const data = await rss2json(url);
    if (!data?.items.length) throw new Error("Cannot fetch rss data");
    return data.items.map((item) => ({
      title: item.title,
      url: item.link,
      id: item.link,
      pubDate: !option?.hiddenDate ? item.created : undefined,
    }));
  };
}

interface RawResponse {
  status: number;
  headers: Headers;
  /** The body, as the response type asked for. */
  _data: unknown;
}

/** A request, with the body read as the content type asks for. */
async function myFetchImpl<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const response = await fetchUrl(url, opts);
  return response.data as T;
}

/** A request whose response is read whole, status and headers included. */
async function myFetchRaw<T = unknown>(url: string, opts: FetchOptions = {}): Promise<RawResponse> {
  const response = await fetchUrl(url, opts);
  return { status: response.status, headers: response.headers, _data: response.data as T };
}

/** The request the adapters make; `.raw` reads the whole response. */
export const myFetch = Object.assign(myFetchImpl, { raw: myFetchRaw });

/** The plain request upstream's adapters read cookies from. */
async function fetchImpl<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  return myFetchImpl<T>(url, opts);
}

/** The plain request; `.raw` reads the whole response. */
export const $fetch = Object.assign(fetchImpl, { raw: myFetchRaw });

export interface RSSItem {
  title: string;
  description: string;
  link: string;
  created?: string;
}

export interface RSSInfo {
  title: string;
  description: string;
  link: string;
  image: string;
  updatedTime: string;
  items: RSSItem[];
}

/** An RSS or Atom feed, read as a list of items. */
export async function rss2json(url: string): Promise<RSSInfo | undefined> {
  if (!/^https?:\/\/[^\s$.?#].\S*/i.test(url)) return;
  const data = await myFetch<string>(url, { responseType: "text" });
  const xml = new XMLParser({ attributeNamePrefix: "", textNodeName: "$text", ignoreAttributes: false });
  const result = xml.parse(data as string);
  let channel = result.rss && result.rss.channel ? result.rss.channel : result.feed;
  if (Array.isArray(channel)) channel = channel[0];
  const rss: RSSInfo = {
    title: channel.title ?? "",
    description: channel.description ?? "",
    link: channel.link && channel.link.href ? channel.link.href : channel.link,
    image: channel.image ? channel.image.url : channel["itunes:image"] ? channel["itunes:image"].href : "",
    updatedTime: channel.lastBuildDate ?? channel.updated,
    items: [],
  };
  let items = channel.item || channel.entry || [];
  if (items && !Array.isArray(items)) items = [items];
  for (const val of items) {
    rss.items.push({
      id: val.guid && val.guid.$text ? val.guid.$text : val.id,
      title: val.title && val.title.$text ? val.title.$text : val.title,
      description: val.summary && val.summary.$text ? val.summary.$text : val.description,
      link: val.link && val.link.href ? val.link.href : val.link,
      author: val.author && val.author.name ? val.author.name : val["dc:creator"],
      created: val.pubDate ?? val.published ?? val.created,
    } as RSSItem);
  }
  return rss;
}

/** The offsets the adapters' own zones are read in. */
const ZONE_OFFSETS: Record<string, string> = {
  "Asia/Shanghai": "+08:00",
  UTC: "+00:00",
};

/**
 * A date as the source prints it: an age ("3分钟前", "昨天 15:46") counted back from now, or a
 * calendar date in the source's own offset. The result is a Date, so the adapters' `.valueOf()`
 * keeps working; a date that cannot be read is an invalid Date.
 */
export function parseRelativeDate(date: string, timezone = "UTC"): Date {
  const offset = ZONE_OFFSETS[timezone] ?? "+08:00";
  const relative = readRelativeDate(date, new Date(), offset);
  if (relative.publishedAt) return relative.publishedAt;
  return parseLooseDate(date, offset) ?? new Date(NaN);
}

/** A date in the source's own offset, as a timestamp. */
export function tranformToUTC(date: string, timezone = "Asia/Shanghai"): number {
  const parsed = parseLooseDate(date, ZONE_OFFSETS[timezone] ?? "+08:00");
  return parsed ? parsed.getTime() : NaN;
}

/** The MD5 the Coolapk and Cailianpress signatures are built from. */
export async function md5(text: string): Promise<string> {
  return createHash("md5").update(text, "utf8").digest("hex");
}

/** A digest of a text, as the upstream signatures use it. */
export async function myCrypto(text: string, algorithm: "MD5" | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512"): Promise<string> {
  return createHash(algorithm.toLowerCase().replace("-", "")).update(text, "utf8").digest("hex");
}

/** The base64 the Coolapk token is built from. */
export function encodeBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}
