// Reading a source: the cache, the deadline and the entries it publishes.
//
// The cache is per source and lasts as long as the source says it changes. A reading that fails
// keeps the last one and says why it failed, and the time given with it is the time the source was
// really read: a reader is never shown a fresh time for an old list.
import { parseLooseDate } from "@aihot/backend/sources/dates";
import type { NewsnowFeedItem, NewsnowFeedResponse } from "./types.ts";
import type { NewsItem, SourceGetter } from "./upstream/runtime.ts";

/** How long one source may take, the adapter and all. */
const FETCH_DEADLINE_MS = 25_000;
/** How many entries one source keeps. */
const MAX_ITEMS = 30;
/** How many sources are read at the same time. */
const MAX_CONCURRENT = 4;

interface CacheEntry {
  items: NewsnowFeedItem[];
  /** When the source was really read, not when the answer was given. */
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const reading = new Map<string, Promise<CacheEntry>>();
let running = 0;
const waiting: Array<() => void> = [];

/** The time a source published an entry, when it printed one. */
function publishedAtOf(item: NewsItem): string | null {
  const raw = item.pubDate ?? item.extra?.date;
  if (raw === undefined || raw === null || raw === "") return null;
  const at = typeof raw === "number" ? new Date(raw) : parseLooseDate(String(raw));
  return at && Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

/** The entries of a source, without the repeats and without the empty ones. */
export function toFeedItems(items: NewsItem[]): NewsnowFeedItem[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const out: NewsnowFeedItem[] = [];
  for (const item of items) {
    const title = String(item.title ?? "").trim();
    const url = String(item.url ?? "").trim();
    if (!title || !url) continue;
    try {
      const link = new URL(url);
      if (!["http:", "https:"].includes(link.protocol) || link.username || link.password) continue;
    } catch { continue; }
    const id = String(item.id ?? url);
    if (seenIds.has(id) || seenUrls.has(url)) continue;
    seenIds.add(id);
    seenUrls.add(url);
    out.push({ id, title, url, publishedAt: publishedAtOf(item) });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** Only a few sources are read at once, so one slow site does not hold the others up. */
async function withRoom<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    const { promise, resolve } = Promise.withResolvers<void>();
    waiting.push(resolve);
    await promise;
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

async function read(id: string, getter: SourceGetter): Promise<CacheEntry> {
  const items = await withRoom(async () => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        getter(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${id} did not answer within ${FETCH_DEADLINE_MS} ms`)), FETCH_DEADLINE_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
  const entry: CacheEntry = { items: toFeedItems(items), fetchedAt: Date.now() };
  cache.set(id, entry);
  return entry;
}

/** What one source published, and when it was read. */
export async function readSource(id: string, getter: SourceGetter, intervalMs: number): Promise<NewsnowFeedResponse> {
  const cached = cache.get(id);
  if (cached && Date.now() - cached.fetchedAt < intervalMs) {
    return { id, status: "cache", refreshedAt: new Date(cached.fetchedAt).toISOString(), items: cached.items };
  }
  let pending = reading.get(id);
  if (!pending) {
    pending = read(id, getter).finally(() => reading.delete(id));
    reading.set(id, pending);
  }
  try {
    const fresh = await pending;
    return { id, status: "success", refreshedAt: new Date(fresh.fetchedAt).toISOString(), items: fresh.items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stale = cache.get(id);
    if (stale) return { id, status: "cache", refreshedAt: new Date(stale.fetchedAt).toISOString(), items: stale.items, error: message };
    return { id, status: "error", refreshedAt: null, items: [], error: message };
  }
}
