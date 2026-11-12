// industry/watchlist.txt: one source per line. A line is an X account (@handle or its x.com address), a
// Discord channel link, or any other address, which is worked out by discover.ts; then an optional
// display name; "!fast" checks it every minute, "!hot" counts it as heat evidence only. Lines are
// imported once and never overwrite a source; a discovered source that keeps failing is discovered
// again from the address on its line.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { audit } from "../audit.ts";
import { REPO_ROOT } from "../config.ts";
import { sql } from "../db.ts";
import { assertSupportedConfig } from "./config-keys.ts";
import { discoverSource } from "./discover.ts";
import type { SourceRow } from "./types.ts";

export interface WatchLine {
  id: string;
  name: string;
  participation_mode: "editorial" | "hot_signal";
  interval_minutes: number;
  tags: string[];
  fast: boolean;
  /** Known from the line itself; a line without it carries the address to discover. */
  source?: { kind: SourceRow["kind"]; config: Record<string, unknown> };
  watch?: string;
}

const X_HANDLE = /^(?:@|https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?)([A-Za-z0-9_]{1,15})\/?$/;
const DISCORD_CHANNEL = /^https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/?$/;
/** Consecutive failed reads before a discovered source is discovered again. */
const REPAIR_AFTER_FAILURES = 5;

export function parseWatchlist(text: string): WatchLine[] {
  const out = new Map<string, WatchLine>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [target, ...rest] = line.split(/\s+/) as [string, ...string[]];
    const flags = rest.filter((word) => word.startsWith("!"));
    const unknown = flags.find((flag) => flag !== "!fast" && flag !== "!hot");
    if (unknown) throw new Error(`watchlist.txt 第 ${index + 1} 行：不认识的标记 ${unknown}（只有 !fast 和 !hot）`);
    const label = rest.filter((word) => !word.startsWith("!")).join(" ");
    const fast = flags.includes("!fast");
    const shared = { participation_mode: flags.includes("!hot") ? "hot_signal" as const : "editorial" as const, fast };
    const aihot = fast ? { _aihot: { fast: true } } : {};
    const x = X_HANDLE.exec(target);
    const discord = DISCORD_CHANNEL.exec(target);
    let entry: WatchLine;
    if (x) {
      const handle = x[1]!;
      entry = {
        ...shared, id: `x-${handle.toLowerCase()}`, name: `X：${label || handle} (@${handle})`, interval_minutes: 30, tags: ["X"],
        source: { kind: "x_search", config: { query: `from:${handle} -filter:replies`, searchType: "Latest", ...aihot } },
      };
    } else if (discord) {
      const [, guild, channel] = discord;
      // The bot token is added when the channel is read (DISCORD_BOT_TOKEN), never stored with the source.
      // A message is its own body: discord.com has no public page to read one from.
      entry = {
        ...shared, id: `discord-${channel}`, name: label || `Discord ${channel}`, interval_minutes: 10, tags: ["Discord"],
        source: {
          kind: "json_list",
          config: {
            url: `https://discord.com/api/v10/channels/${channel}/messages?limit=50`,
            titlePaths: ["content", "embeds.0.title", "embeds.0.description"],
            summaryPaths: ["content", "embeds.0.description"],
            summaryIsBody: true,
            authorPaths: ["author.global_name", "author.username"],
            publishedAtPath: "timestamp",
            externalIdPath: "id",
            urlTemplate: `https://discord.com/channels/${guild}/${channel}/{id}`,
            ...aihot,
          },
        },
      };
    } else {
      let url: URL;
      try { url = new URL(target); } catch { throw new Error(`watchlist.txt 第 ${index + 1} 行：看不懂 ${target}（要 @账号、Discord 频道链接或网址）`); }
      if (!/^https?:$/.test(url.protocol)) throw new Error(`watchlist.txt 第 ${index + 1} 行：网址要以 http(s) 开头`);
      const host = url.hostname.replace(/^www\./, "");
      entry = {
        ...shared, id: `web-${host.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${createHash("sha256").update(url.href).digest("hex").slice(0, 6)}`,
        name: label || host, interval_minutes: 30, tags: ["网站"], watch: url.href,
      };
    }
    if (!out.has(entry.id)) out.set(entry.id, entry);
  });
  return [...out.values()];
}

const xAccount = (query: unknown) => /^from:(\w+)/i.exec(String(query ?? ""))?.[1]?.toLowerCase() ?? null;

/** Imports the lines no source follows yet (by id, X account or address). A line that cannot be worked out is reported and tried again at the next sync. */
export async function syncWatchlist(text: string): Promise<{ added: string[]; failed: Array<{ line: string; error: string }> }> {
  const lines = parseWatchlist(text);
  const stored = await sql<{ id: string; query: string | null; address: string | null; watch: string | null }[]>`
    SELECT id, config->>'query' AS query, coalesce(config->>'feedUrl', config->>'url') AS address, config->'_aihot'->>'watch' AS watch FROM sources`;
  const ids = new Set(stored.map((s) => s.id));
  const accounts = new Set(stored.map((s) => xAccount(s.query)).filter(Boolean));
  const addresses = new Set(stored.flatMap((s) => [s.address, s.watch]).filter(Boolean));
  const added: string[] = [];
  const failed: Array<{ line: string; error: string }> = [];
  for (const line of lines) {
    if (ids.has(line.id) || line.source?.kind === "x_search" && accounts.has(xAccount(line.source.config.query))
      || addresses.has(line.watch ?? String(line.source?.config.url ?? ""))) continue;
    let source = line.source;
    if (!source) {
      try {
        const found = await discoverSource(line.watch!);
        if (addresses.has(String(found.config.feedUrl ?? found.config.url))) continue;
        source = { kind: found.kind, config: { ...found.config, _aihot: { watch: line.watch, ...(line.fast ? { fast: true } : {}) } } };
      } catch (error) {
        failed.push({ line: line.watch!, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }
    assertSupportedConfig(source.kind, source.config);
    const inserted = await sql`
      INSERT INTO sources (id, name, kind, config, tier, first_party, participation_mode, interval_minutes, tags, enabled, next_fetch_at)
      VALUES (${line.id}, ${line.name}, ${source.kind}, ${sql.json(source.config as never)}, 'T2', false, ${line.participation_mode}, ${line.interval_minutes}, ${line.tags}, true, now())
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (inserted.length) added.push(line.id);
  }
  return { added, failed };
}

/**
 * Discovered sources whose reads keep failing (the feed moved, the page was redesigned) are discovered
 * again from the address on their line. A source is changed only when discovery finds a way that returns
 * posts and differs from the stored one; settings added to it since are kept.
 */
export async function repairWatched(): Promise<{ checked: number; repaired: string[] }> {
  const failing = await sql<Pick<SourceRow, "id" | "kind" | "config" | "cursor">[]>`
    SELECT id, kind, config, cursor FROM sources
    WHERE enabled AND config->'_aihot'->>'watch' IS NOT NULL AND fail_count >= ${REPAIR_AFTER_FAILURES} ORDER BY id`;
  const repaired: string[] = [];
  for (const s of failing) {
    let found;
    try { found = await discoverSource(String(s.config._aihot.watch)); } catch { continue; }
    const kindChanged = found.kind !== s.kind;
    if (!kindChanged && Object.entries(found.config).every(([key, value]) => s.config[key] === value)) continue;
    const config = kindChanged ? { ...found.config, _aihot: s.config._aihot } : { ...s.config, ...found.config };
    assertSupportedConfig(found.kind, config);
    const cursor = s.cursor ? { ...s.cursor } : null;
    if (kindChanged && cursor) {
      delete cursor.rss;
      delete cursor.detailRules;
    }
    await sql.begin(async (tx) => {
      await tx`UPDATE sources SET kind = ${found.kind}, config = ${tx.json(config as never)}, cursor = ${cursor ? tx.json(cursor as never) : null}::jsonb,
               health = 'unknown', next_fetch_at = now(), updated_at = now() WHERE id = ${s.id}`;
      await audit("system", "source.update", `source:${s.id}`, `连续 ${REPAIR_AFTER_FAILURES} 次抓取失败，按 watchlist 的网址重新识别了采集方式`,
        { kind: s.kind, config: s.config }, { kind: found.kind, config }, { db: tx });
    });
    repaired.push(s.id);
  }
  return { checked: failing.length, repaired };
}

/** The hourly upkeep: new lines of industry/watchlist.txt are imported, broken discovered sources repaired. */
export async function maintainWatchlist() {
  const file = path.join(REPO_ROOT, "industry/watchlist.txt");
  const synced = existsSync(file) ? await syncWatchlist(readFileSync(file, "utf8")) : { added: [], failed: [] };
  return { ...synced, ...(await repairWatched()) };
}
