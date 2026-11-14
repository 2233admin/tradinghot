// The NewsNow service: the upstream adapters, self-hosted.
//
// It answers what the sources publish, and when they were really read: the site's api and the worker
// both read this service, and both must be able to tell a fresh reading from the last one.
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { canonicalSourceId, newsnowSources, sourceIntervalMs } from "./registry.ts";
import { readSource } from "./reader.ts";
import type { NewsnowFeedResponse, NewsnowSourcesResponse } from "./types.ts";
import type { SourceGetter } from "./upstream/runtime.ts";

const HOST = process.env.NEWSNOW_HOST ?? "127.0.0.1";
const PORT = Number(process.env.NEWSNOW_PORT ?? 3002);

let getters: Map<string, SourceGetter> | null = null;

/** The upstream adapters, one getter per source. */
export async function loadGetters(): Promise<Map<string, SourceGetter>> {
  if (getters) return getters;
  const folder = path.join(import.meta.dirname, "upstream/sources");
  const found = new Map<string, SourceGetter>();
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    // The adapters are a runtime registry: which files are there is only known when the service
    // starts, so they cannot be named at author time and are loaded one by one.
    const loaded = await import(path.join(entry.parentPath, entry.name)) as { default?: unknown };
    const exported = loaded.default;
    if (typeof exported === "function") {
      const id = entry.name === "index.ts" ? path.basename(entry.parentPath) : entry.name.replace(/\.ts$/, "");
      found.set(id, exported as SourceGetter);
    } else if (exported && typeof exported === "object") {
      for (const [id, getter] of Object.entries(exported as Record<string, unknown>)) {
        if (typeof getter === "function") found.set(id, getter as SourceGetter);
      }
    }
  }
  getters = found;
  return found;
}

/** What one source published, and when it was read. */
export async function readFeed(id: string): Promise<NewsnowFeedResponse> {
  const all = await loadGetters();
  // An alias points at the source that is really read; an adapter the registry does not list is
  // read under its own name.
  const wanted = canonicalSourceId(id) ?? id;
  const getter = all.get(wanted);
  if (!getter) return { id, status: "error", refreshedAt: null, items: [], error: `Unknown source ${id}` };
  return readSource(wanted, getter, sourceIntervalMs(wanted));
}

/** The sources the service knows, and what each of them is. */
export function sources(): NewsnowSourcesResponse {
  return { sources: newsnowSources() };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  response.end(text);
}

const server = createServer((request, response) => {
  const address = new URL(request.url ?? "/", "http://localhost");
  if (request.method !== "GET") {
    send(response, 405, { error: "Only GET is answered" });
    return;
  }
  if (address.pathname === "/health") {
    send(response, 200, { ok: true, sources: newsnowSources().length });
    return;
  }
  if (address.pathname === "/sources") {
    send(response, 200, sources());
    return;
  }
  if (address.pathname === "/feed") {
    const id = (address.searchParams.get("id") ?? "").trim();
    if (!id) {
      send(response, 400, { id: "", status: "error", refreshedAt: null, items: [], error: "id is required" });
      return;
    }
    readFeed(id).then((feed) => send(response, 200, feed), (error: unknown) => {
      send(response, 500, { id, status: "error", refreshedAt: null, items: [], error: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  send(response, 404, { error: "Not found" });
});

/** The service is started by the process that runs this file, not by whoever imports it. */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  server.listen(PORT, HOST, () => {
    console.log(`newsnow: listening on ${HOST}:${PORT}, ${newsnowSources().length} sources`);
  });
}
