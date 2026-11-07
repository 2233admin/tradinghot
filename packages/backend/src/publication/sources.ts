// The public source pool (/sources and /api/v1/sources): the sources the site collects from and the
// outcome of each one's last collection. Only what a reader may see: an isolated source is never named
// publicly, and no source's address or error leaves this layer. The id is the public slug another client
// filters items with, so it is part of the answer rather than an internal detail.
import type { PublicSourceEntry, SourcePoolResponse } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { publicSourceName } from "./rules.ts";

interface Row {
  id: string;
  name: string;
  kind: string;
  tier: string;
  health: string;
  last_ok_at: Date | null;
  items_7d: number;
  tags: string[];
}

export async function loadSourcePool(now = Date.now()): Promise<SourcePoolResponse> {
  const rows = await sql<Row[]>`
    SELECT s.id, s.name, s.kind, s.tier, s.health, s.last_ok_at, coalesce(s.tags, '{}') AS tags,
      (SELECT count(*)::int FROM articles a
        WHERE a.source_id = s.id AND a.discovered_at > ${new Date(now - 7 * 86400_000)}) AS items_7d
    FROM sources s
    WHERE s.enabled AND s.participation_mode <> 'isolated'
    ORDER BY CASE s.health WHEN 'failing' THEN 0 WHEN 'degraded' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END,
      s.name, s.id`;
  const sources: PublicSourceEntry[] = rows.map((row) => ({
    id: row.id,
    name: publicSourceName(row.name),
    kind: row.kind,
    firstParty: row.tier === "T1",
    // The stored health of an enabled source; `paused` only belongs to a disabled one.
    status: row.health === "ok" || row.health === "degraded" || row.health === "failing" ? row.health : "unknown",
    lastOkAt: row.last_ok_at?.toISOString() ?? null,
    items7d: row.items_7d,
    tags: row.tags,
  }));
  const counts = { total: sources.length, ok: 0, degraded: 0, failing: 0, unknown: 0 };
  for (const source of sources) counts[source.status] += 1;
  return { counts, sources };
}
