// Truth Social: one account's own posts, read from the platform's own API — no key, no third-party
// aggregator. The API is Mastodon-shaped: an account is looked up by its handle, and its statuses carry
// the post's own text (HTML), the moment it was published, the media it carries and whether it was
// edited since. A post here is a post of this platform: it is stored as its own material, with its own
// text, media and time, and never as an X post — the site's X line is for X.
import { z } from "zod";
import { HttpStatusError } from "../lib/http-fetch.ts";
import { fetchListing } from "./listing-fetch.ts";
import { collapseWhitespace, stripTags, truncate } from "../lib/text.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { readPublicationDate } from "./dates.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";
import type { MediaItem } from "../content/materials.ts";
import { browserTruthSocial } from "../providers/browsermcp.ts";

/** The platform's own page of posts: twenty statuses, newest first. */
export const PAGE_SIZE = 20;
/** Pages read in one run; each page is one request to the platform. */
const MAX_PAGES = 3;
const DEFAULT_PAGES = 2;
/** The title of a post: its own first words, cut short. */
const TITLE_CHARS = 140;
/** The excerpt of a post: its own words, cut short. */
const EXCERPT_CHARS = 2000;

// What the platform sent, read field by field: a field of another shape is not read as one.
const Account = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  acct: z.string().nullish(),
  display_name: z.string().nullish(),
  verified: z.boolean().nullish(),
}).passthrough();

const Attachment = z.object({
  type: z.string().nullish(),
  url: z.string().nullish(),
  preview_url: z.string().nullish(),
  description: z.string().nullish(),
  meta: z.object({
    original: z.object({
      width: z.number().nullish(),
      height: z.number().nullish(),
      duration: z.number().nullish(),
    }).passthrough().nullish(),
  }).passthrough().nullish(),
}).passthrough();

const Status = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  created_at: z.string().nullish(),
  content: z.string().nullish(),
  url: z.string().nullish(),
  uri: z.string().nullish(),
  language: z.string().nullish(),
  spoiler_text: z.string().nullish(),
  edited_at: z.string().nullish(),
  version: z.union([z.string(), z.number()]).nullish(),
  account: Account.nullish(),
  media_attachments: z.array(Attachment).nullish(),
  reblog: z.object({
    id: z.union([z.string(), z.number()]).nullish(),
    url: z.string().nullish(),
    content: z.string().nullish(),
    account: Account.nullish(),
    media_attachments: z.array(Attachment).nullish(),
  }).passthrough().nullish(),
  quote: z.object({ id: z.union([z.string(), z.number()]).nullish() }).passthrough().nullish(),
  replies_count: z.number().nullish(),
  reblogs_count: z.number().nullish(),
  favourites_count: z.number().nullish(),
}).passthrough();

export type TruthSocialAccount = z.infer<typeof Account>;
export type TruthSocialAttachment = z.infer<typeof Attachment>;
export type TruthSocialStatus = z.infer<typeof Status>;

export interface TruthSocialSettings {
  /** The handle the posts are attributed to (@realDonaldTrump). */
  account: string | null;
  /** The platform's own account id; without it the account is looked up, once per run. */
  accountId: string | null;
  /** Pages read in one run (each page is one request to the platform). */
  pages: number;
}

/** What the source's own configuration says about the account and the window of a run. */
export function truthSocialSettings(source: SourceRow): TruthSocialSettings {
  const raw = source.config?.truthSocial;
  const settings = raw && typeof raw === "object" ? raw : null;
  const account = settings && "account" in settings ? settings.account : null;
  const accountId = settings && "accountId" in settings ? settings.accountId : null;
  const pages = settings && "pages" in settings ? settings.pages : null;
  return {
    account: typeof account === "string" && account.trim() ? account.trim() : null,
    accountId: typeof accountId === "string" && accountId.trim() ? accountId.trim() : null,
    pages: typeof pages === "number" && Number.isSafeInteger(pages) ? Math.min(MAX_PAGES, Math.max(1, pages)) : DEFAULT_PAGES,
  };
}

/** The media a post carries: its own files, at their own size, with the description it gave them. */
export function truthSocialMedia(status: TruthSocialStatus): MediaItem[] {
  const out: MediaItem[] = [];
  for (const attachment of status.media_attachments?.length ? status.media_attachments : status.reblog?.media_attachments ?? []) {
    const url = attachment.url?.trim() ?? "";
    if (!url) continue;
    const original = attachment.meta?.original;
    const description = attachment.description ?? "";
    const preview = attachment.preview_url ?? "";
    const video = attachment.type === "video" || attachment.type === "gifv";
    out.push({
      kind: video ? "video" : "image",
      url,
      width: typeof original?.width === "number" && Number.isFinite(original.width) ? original.width : null,
      height: typeof original?.height === "number" && Number.isFinite(original.height) ? original.height : null,
      alt: description.trim() ? description.trim() : null,
      poster: video && preview.trim() ? preview.trim() : null,
    });
  }
  return out;
}

/** The post's own words: its text without the markup around it. */
export function truthSocialText(content: string): string {
  return stripTags(content);
}

/** The post's first paragraph: what its title says, before it is cut short. */
export function truthSocialHeadline(content: string): string {
  for (const match of content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = collapseWhitespace(stripTags(match[1]!));
    if (text) return text;
  }
  return collapseWhitespace(stripTags(content));
}

/** What a post with no words of its own is called: the media it carries, or nothing at all. */
export function truthSocialMediaName(media: MediaItem[]): string {
  if (!media.length) return "[无正文]";
  const kinds = new Set(media.map((item) => item.kind));
  if (kinds.has("image") && kinds.has("video")) return "[图片/视频]";
  return kinds.has("video") ? "[视频]" : "[图片]";
}

const escAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The post as the site shows it: its own text, and the media it carries, in the site's safe HTML. */
export function truthSocialBodyHtml(content: string, media: MediaItem[]): string {
  const blocks = media.map((item) => item.kind === "video"
    ? `<figure><video src="${escAttr(item.url)}"${item.poster ? ` poster="${escAttr(item.poster)}"` : ""} controls playsinline preload="none"></video></figure>`
    : `<figure><img src="${escAttr(item.url)}" alt="${escAttr(item.alt ?? "")}"${item.width ? ` width="${item.width}"` : ""}${item.height ? ` height="${item.height}"` : ""}></figure>`);
  return sanitizeBody([content, ...blocks].join(""));
}

/**
 * One post as the engine's material: its own text, its own time, its own media and its own edits.
 * A post of this platform is not an X post: it carries no X fields, and its source says which
 * platform it came from.
 */
export function truthSocialCandidate(status: TruthSocialStatus, source: SourceRow): Candidate | null {
  const id = status.id === undefined || status.id === null ? "" : String(status.id);
  const url = (status.url ?? status.uri ?? "").trim();
  if (!id || !url) return null;
  const settings = truthSocialSettings(source);
  // A repost carries the boosted post's words: that is what the platform shows for it.
  const own = status.content ?? "";
  const boosted = status.reblog?.content ?? "";
  const content = own.trim() ? own : boosted;
  const text = truthSocialText(content);
  const media = truthSocialMedia(status);
  const described = media.find((item) => item.alt)?.alt ?? null;
  // A post with no words of its own still has media: it is named, never dropped.
  const bodyText = text || described || truthSocialMediaName(media);
  const headline = truthSocialHeadline(content);
  const title = truncate(headline || described || truthSocialMediaName(media), TITLE_CHARS);
  const created = readPublicationDate(status.created_at ?? null, "+00:00");
  const edited = status.edited_at ? new Date(status.edited_at) : null;
  const handle = status.account?.acct ?? "";
  const language = status.language ?? "";
  const spoiler = status.spoiler_text ?? "";
  const acct = handle.trim() ? handle.trim() : settings.account;
  const accountId = status.account?.id === undefined || status.account?.id === null ? settings.accountId : String(status.account.id);
  return {
    url,
    title,
    author: acct,
    language: language.trim() ? language.trim() : null,
    publishedAt: created.publishedAt,
    publicationTime: created.publicationTime,
    sourceUpdatedAt: edited && Number.isFinite(edited.getTime()) ? edited : null,
    excerpt: bodyText.slice(0, EXCERPT_CHARS),
    bodyText,
    bodyHtml: truthSocialBodyHtml(content, media),
    bodyStatus: "ok",
    media,
    raw: {
      externalId: id,
      platform: "truthsocial",
      account: acct,
      accountId,
      displayName: status.account?.display_name ?? null,
      verified: status.account?.verified ?? null,
      permalink: url,
      createdAt: status.created_at ?? null,
      editedAt: status.edited_at ?? null,
      version: status.version ?? null,
      language: status.language ?? null,
      spoilerText: spoiler.trim() ? spoiler.trim() : null,
      mediaCount: media.length,
      replies: status.replies_count ?? null,
      reblogs: status.reblogs_count ?? null,
      favourites: status.favourites_count ?? null,
      quoteId: status.quote?.id ?? null,
      reblogId: status.reblog?.id ?? null,
      reblogUrl: status.reblog?.url ?? null,
    },
  };
}

/** The platform's own answer, read through the collector's guarded fetch. */
async function readJson(url: string, source: SourceRow): Promise<unknown> {
  if (source.id === "truthsocial-donald-trump") {
    const browserResult = await browserTruthSocial(url);
    if (browserResult !== null) return browserResult;
  }
  const headers: Record<string, string> = { accept: "application/json, text/plain, */*", ...(source.config?.headers ?? {}) };
  const res = await fetchListing(url, { redirectPolicy: "same-origin", headers, timeoutMs: 25_000 });
  if (res.status !== 200) {
    // A challenge page answers with HTML and a refusal: say what happened instead of "not JSON".
    const challenge = res.text().trimStart().startsWith("<");
    throw new HttpStatusError(res.status, `Truth Social answered HTTP ${res.status}${challenge ? " with a challenge page, not JSON" : ""}`);
  }
  try {
    return JSON.parse(res.text());
  } catch {
    throw new FetchError("Truth Social answered with something that is not JSON");
  }
}

async function readStatuses(url: string, source: SourceRow): Promise<TruthSocialStatus[]> {
  const data = await readJson(url, source);
  if (!Array.isArray(data)) throw new FetchError("Truth Social answered with something that is not a list of posts");
  // A post of another shape is left out rather than read as one; the rest of the page is still read.
  const posts: TruthSocialStatus[] = [];
  for (const item of data) {
    const parsed = Status.safeParse(item);
    if (parsed.success) posts.push(parsed.data);
  }
  return posts;
}

/** The API's own base, read off the statuses address: https://truthsocial.com/api/v1. */
function apiBase(statusesUrl: string): string {
  const url = new URL(statusesUrl);
  return `${url.origin}${url.pathname.replace(/\/accounts\/[^/]+\/statuses\/?$/, "")}`;
}

/** The account's own id, read from the platform's own lookup. */
export async function lookupAccountId(statusesUrl: string, acct: string, source: SourceRow): Promise<string | null> {
  const url = new URL(`${apiBase(statusesUrl)}/accounts/lookup`);
  url.searchParams.set("acct", acct);
  const data = await readJson(url.toString(), source);
  const parsed = z.object({ id: z.union([z.string(), z.number()]).nullish() }).passthrough().safeParse(data);
  const id = parsed.success ? parsed.data.id : null;
  return id === undefined || id === null || id === "" ? null : String(id);
}

/** The next page of the listing: the posts older than the oldest one read. */
function withMaxId(statusesUrl: string, id: string): string {
  const url = new URL(statusesUrl);
  url.searchParams.set("max_id", id);
  return url.toString();
}

export interface TruthSocialFetchOptions {
  onPage?: (items: Candidate[]) => Promise<void>;
  onPageError?: (error: unknown) => void;
}

/**
 * One account's posts, newest first. The window is bounded: a run reads at most the configured number
 * of pages of the platform's own listing, one request each, so a busy account cannot turn a run into a
 * crawl. The listing always starts at the newest post, so what the window missed is read again later.
 */
export async function fetchTruthSocialStatuses(source: SourceRow, opts: TruthSocialFetchOptions = {}): Promise<Candidate[]> {
  const settings = truthSocialSettings(source);
  const base = String(source.config?.url ?? "").trim();
  if (!base) throw new FetchError("url is not configured");
  const accountId = settings.accountId ?? (settings.account ? await lookupAccountId(base, settings.account, source) : null);
  if (!accountId) throw new FetchError("the account id is not configured (truthSocial.accountId)");
  // A configured id keeps the configured address; a looked-up one builds its own.
  const statusesUrl = settings.accountId ? base : `${apiBase(base)}/accounts/${accountId}/statuses`;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let next: string | null = statusesUrl;
  for (let page = 0; page < settings.pages && next; page++) {
    let statuses: TruthSocialStatus[];
    try {
      statuses = await readStatuses(next, source);
    } catch (error) {
      // A later page failing keeps the pages already read; the run goes on from there next time.
      if (!out.length || !opts.onPageError) throw error;
      opts.onPageError(error);
      return out;
    }
    const fresh = statuses.filter((status) => {
      const id = String(status.id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const candidates = fresh.map((status) => truthSocialCandidate(status, source)).filter((item): item is Candidate => item !== null);
    out.push(...candidates);
    if (opts.onPage) await opts.onPage(candidates);
    // A listing shorter than a full page: the account has nothing older in this window.
    if (statuses.length < PAGE_SIZE) break;
    const oldest = statuses[statuses.length - 1];
    const oldestId = oldest ? String(oldest.id ?? "") : "";
    if (!oldestId) break;
    next = withMaxId(statusesUrl, oldestId);
  }
  return out;
}
