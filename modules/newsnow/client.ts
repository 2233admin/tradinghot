// The client of the NewsNow service: the site's api and the worker both read the service over HTTP,
// never the adapters themselves, so the adapters run in one place.
import type { NewsnowFeedResponse, NewsnowSourcesResponse } from "./types.ts";

/** Where the service listens. The compose deployment puts it next to the api. */
export const NEWSNOW_BASE_URL = (process.env.NEWSNOW_BASE_URL ?? "http://127.0.0.1:3002").replace(/\/+$/, "");
/** How long a source may take, the service and the site waiting. */
const TIMEOUT_MS = 30_000;

/** What one source published, and when it was read. */
export async function readFeed(id: string): Promise<NewsnowFeedResponse> {
  const response = await fetch(`${NEWSNOW_BASE_URL}/feed?id=${encodeURIComponent(id)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The NewsNow service answered ${response.status} for ${id}`);
  const body = await response.json() as Partial<NewsnowFeedResponse>;
  if (!body || typeof body !== "object" || !Array.isArray(body.items)) throw new Error(`The NewsNow service answered nothing usable for ${id}`);
  return {
    id: typeof body.id === "string" ? body.id : id,
    status: body.status === "success" || body.status === "cache" ? body.status : "error",
    refreshedAt: typeof body.refreshedAt === "string" ? body.refreshedAt : null,
    items: body.items.map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : null,
    })),
    ...(typeof body.error === "string" ? { error: body.error } : {}),
  };
}

/** The sources the service knows. */
export async function readSources(): Promise<NewsnowSourcesResponse> {
  const response = await fetch(`${NEWSNOW_BASE_URL}/sources`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The NewsNow service answered ${response.status}`);
  const body = await response.json() as Partial<NewsnowSourcesResponse>;
  return { sources: Array.isArray(body.sources) ? body.sources : [] };
}
