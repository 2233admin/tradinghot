// The bridge: the worker reads the NewsNow sources the site wants and stores what they publish.
//
// The entries go in through the engine's own ingest path, so they keep the engine's identity rules,
// their bodies are read from the article pages, and a hot list's entries (which print no time of
// their own) stay evidence: a source in hot_signal mode never creates a story, and no time is made
// up for an entry that has none.
import { sql } from "@aihot/backend/db";
import { ingestItems } from "@aihot/backend/ingest/items";
import { readFeed } from "./client.ts";
import { sourceIntervalMs, sourceName } from "./registry.ts";
import { NEWSNOW_SOURCES } from "./sources.ts";

/** The id a NewsNow source is known by in the site's own sources. */
function siteSourceId(newsnowId: string): string {
  return `newsnow-${newsnowId}`;
}

/**
 * The sources the module reads, added to the site's own sources when the site's pack does not
 * name them already. A source an operator paused keeps its row: nothing here re-enables it.
 */
async function ensureSources(): Promise<void> {
  const existing = await sql<{ newsnow_id: string | null }[]>`
    SELECT config->>'collectorId' AS newsnow_id FROM sources
    WHERE kind = 'external' AND config->>'collector' = 'newsnow'`;
  const known = new Set(existing.map((row) => row.newsnow_id));
  for (const choice of NEWSNOW_SOURCES) {
    if (known.has(choice.id)) continue;
    const minutes = Math.max(1, Math.round(sourceIntervalMs(choice.id) / 60_000));
    const config = { collector: "newsnow", collectorId: choice.id };
    await sql`
      INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, enabled, health, tags)
      VALUES (${siteSourceId(choice.id)}, ${sourceName(choice.id)}, 'external',
              ${sql.json(config)}, 'T2', ${choice.mode}, ${minutes}, true, 'unknown', ${["newsnow"]})
      ON CONFLICT (id) DO NOTHING`;
  }
}

/** Reads every NewsNow source that is due, and stores what they published. */
export async function collectNewsnow(): Promise<{ read: number; stored: number; failed: number }> {
  await ensureSources();
  const due = await sql<{ id: string; name: string; config: { collectorId?: string }; interval_minutes: number }[]>`
    SELECT id, name, config, interval_minutes FROM sources
    WHERE enabled AND kind = 'external' AND config->>'collector' = 'newsnow'
      AND (next_fetch_at IS NULL OR next_fetch_at <= now())`;
  let stored = 0;
  let failed = 0;
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, due.length) }, async () => {
    while (index < due.length) {
      const source = due[index++]!;
      const newsnowId = source.config.collectorId;
      if (!newsnowId) continue;
      try {
        const feed = await readFeed(newsnowId);
        if (feed.error || feed.status === "error") throw new Error(feed.error ?? "source did not answer");
        const items = feed.items.map((item) => ({
          title: item.title,
          url: item.url,
          ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        }));
        if (items.length) {
          const result = await ingestItems({ sourceId: source.id, sourceName: source.name, items });
          stored += result.created;
        }
        await sql`UPDATE sources SET next_fetch_at = now() + make_interval(mins => ${source.interval_minutes}),
          last_fetch_at = now(), last_ok_at = now(), health = 'ok', fail_count = 0, last_error = null WHERE id = ${source.id}`;
      } catch (error) {
        failed += 1;
        const message = String(error instanceof Error ? error.message : error).slice(0, 500);
        await sql`UPDATE sources SET health = CASE WHEN fail_count + 1 >= 5 THEN 'failing' ELSE 'degraded' END,
          fail_count = fail_count + 1, last_fetch_at = now(), last_error = ${message},
          next_fetch_at = now() + make_interval(mins => LEAST(${source.interval_minutes} * (fail_count + 2), 60)) WHERE id = ${source.id}`;
      }
    }
  }));
  return { read: due.length, stored, failed };
}
