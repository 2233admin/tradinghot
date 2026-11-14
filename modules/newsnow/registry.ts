// The upstream registry: which sources exist, what each of them is (a hot list or a running feed),
// how often it is read and where it lives. Upstream's own file, read as it is.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NewsnowSource, NewsnowSourceType } from "./types.ts";

interface RegistryEntry {
  name: string;
  title?: string;
  desc?: string;
  home?: string;
  column?: string;
  interval: number;
  type?: NewsnowSourceType;
  /** An alias: the id a reader may use, pointing at the source that is really read. */
  redirect?: string;
  /** Upstream's own note that a source is not read in its Cloudflare deployment. */
  disable?: boolean | "cf";
}

const registry = JSON.parse(readFileSync(path.join(import.meta.dirname, "upstream/registry.json"), "utf8")) as Record<string, RegistryEntry>;

/**
 * The adapters upstream's registry does not list. Their names and addresses are here, so every
 * adapter that came with the upstream can be read and shown; how often they are read is our own
 * choice, the registry saying nothing about them.
 */
const EXTRA_SOURCES: NewsnowSource[] = [
  { id: "ghxi", name: "好奇心日报", home: "https://www.ghxi.com/", type: "hottest", intervalMs: 600_000 },
  { id: "smzdm", name: "什么值得买", home: "https://www.smzdm.com/", type: "hottest", intervalMs: 600_000 },
  { id: "linuxdo", name: "LINUX DO", home: "https://linux.do/", type: "hottest", intervalMs: 600_000 },
  { id: "linuxdo-latest", name: "LINUX DO", title: "最新", home: "https://linux.do/", type: "realtime", intervalMs: 600_000 },
  { id: "linuxdo-hot", name: "LINUX DO", title: "热门", home: "https://linux.do/", type: "hottest", intervalMs: 600_000 },
  { id: "pcbeta-windows", name: "远景论坛", title: "Windows", home: "https://bbs.pcbeta.com/", type: "realtime", intervalMs: 300_000 },
];

/** The sources the site can read: the ones with a source of their own, not the aliases. */
export function newsnowSources(): NewsnowSource[] {
  const listed = Object.entries(registry)
    .filter(([, entry]) => !entry.redirect)
    .map(([id, entry]) => ({
      id,
      name: entry.name,
      ...(entry.title ? { title: entry.title } : {}),
      ...(entry.desc ? { description: entry.desc } : {}),
      ...(entry.home ? { home: entry.home } : {}),
      ...(entry.column ? { category: entry.column } : {}),
      type: entry.type ?? "realtime",
      intervalMs: entry.interval,
    }));
  const known = new Set(listed.map((source) => source.id));
  return [...listed, ...EXTRA_SOURCES.filter((source) => !known.has(source.id))];
}

/** The id a source is really read under: an alias points at the source that reads it. */
export function canonicalSourceId(id: string): string | null {
  const entry = registry[id];
  if (!entry) return null;
  return entry.redirect ?? id;
}

/** How often a source is read, in milliseconds. */
export function sourceIntervalMs(id: string): number {
  return registry[id]?.interval ?? EXTRA_SOURCES.find((source) => source.id === id)?.intervalMs ?? 600_000;
}

/** The name a source is known by. */
export function sourceName(id: string): string {
  const entry = registry[id];
  const extra = EXTRA_SOURCES.find((source) => source.id === id);
  return [entry?.name ?? extra?.name ?? id, entry?.title ?? extra?.title, entry?.desc].filter(Boolean).join(" · ");
}
