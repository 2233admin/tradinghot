// The movers module's backend: it watches the published news for unusual moves and answers them as
// the site's own api.
//
// What it is: a keyword reading of the headlines the wires published in the last while. "涨停",
// "停牌", "熔断", "暴涨" and the like are the words a market's unusual move comes with, and the wires
// write them the moment it happens — the fast lanes run every minute, so a move shows up here within
// about a minute of the report.
//
// What it is not: a quote feed. The site collects reports, not prices, so the module never says a
// stock moved by how much, only that the wires reported it. The reader's own channels keep the forum
// chatter out: only the news lane is read, because a forum's "涨停" is a poster's hope, not a move.
//
// The read goes through the engine's one publication layer (packages/backend/src/publication/), like
// every other public exit: the same visibility, release date and browsing rules apply, and the
// module keeps no second definition of what the public may read.
import { sql } from "@aihot/backend/db";
import { loadPool } from "@aihot/backend/publication/pool";
import { defineServerModule } from "@aihot/backend/modules";
import { fetchMovers } from "./quotes.ts";
import { moversResponseSchema, type Mover, type MoverKind, type MoversResponse } from "./types.ts";

/** How far back the module looks for moves. */
const WINDOW_MINUTES = 120;
/** How many moves the site shows at once. */
const MAX_ITEMS = 8;
/** How many published headlines it reads to find them. */
const SCAN_PAGES = 2;
/** How long an answer is reused before the api reads the headlines again. */
const CACHE_MS = 30_000;
/** How many percentage points a change has to move in one poll to count as a jump. */
const JUMP_POINTS = 3;
/** How many quote alerts one poll may write. */
const MAX_QUOTE_ALERTS = 8;
/** How long a quote alert is kept. */
const ALERT_KEEP_DAYS = 2;

/** The words a move comes with, and what the reader is told about it. */
const RULES: ReadonlyArray<{ kind: MoverKind; label: string; re: RegExp }> = [
  { kind: "limit", label: "涨停跌停", re: /涨停|跌停/ },
  { kind: "halt", label: "停牌复牌", re: /停牌|复牌/ },
  { kind: "breaker", label: "熔断", re: /熔断/ },
  {
    kind: "spike",
    label: "急涨急跌",
    re: /暴涨|暴跌|飙升|跳水|逼空|重挫|闪崩|大跌|跌破|\b(?:tumbles?|plunges?|slumps?)\b|\b(?:drops?|dropped|falls?|fell|rises?|rose|jumps?|jumped|gains?|gained)\s+(?:[2-9]\d|\d{3})(?:\.\d+)?%/i,
  },
  {
    kind: "extreme",
    label: "创新高低",
    re: /创新高|创新低|历史新高|历史最低|\b(?:new|all-time) (?:high|low)\b|\b\d+-week (?:high|low)\b/i,
  },
];

let cached: { at: number; response: MoversResponse } | null = null;

/** The rule a headline trips, or null when it is ordinary news. */
export function matchKind(text: string): { kind: MoverKind; label: string } | null {
  for (const rule of RULES) {
    if (rule.re.test(text)) return { kind: rule.kind, label: rule.label };
  }
  return null;
}

/**
 * The published news, newest first, read through the publication layer like every other public exit.
 * Only the news lane: the forum's and the accounts' own words about limits and halts are talk, not
 * moves.
 */
async function readHeadlines(): Promise<Array<{ id: string; title: string; sourceName: string; at: string }>> {
  const pages = await Promise.all(
    Array.from({ length: SCAN_PAGES }, (_, index) => loadPool({ channel: "news", category: null, tag: null, page: index + 1 })),
  );
  return pages.flatMap((page) =>
    page.items.map((item) => ({
      id: item.id,
      title: item.title,
      sourceName: item.source.name,
      at: item.timelineAt,
    })),
  );
}

interface SnapshotRow {
  symbol: string;
  change_percent: number;
}

interface AlertRow {
  symbol: string;
  name: string;
  direction: "up" | "down";
  change_percent: number;
  detected_at: Date;
}

/** One name in the market's movers list. */
export interface QuotePoint {
  symbol: string;
  name: string;
  change: number;
  direction: "up" | "down";
}

/** What the comparison found: a name that entered the list, or one whose change jumped. */
export interface QuoteAlert {
  symbol: string;
  name: string;
  direction: "up" | "down";
  change: number;
  reason: "new" | "jump";
}

/**
 * Compares this poll with the one before it. A name that was not on the list has just entered it; a
 * name whose change moved by a few points has jumped. With nothing to compare against — the first
 * poll — nothing is reported: there is no change yet.
 */
export function compareQuotes(points: QuotePoint[], previous: Map<string, number>): QuoteAlert[] {
  if (previous.size === 0) return [];
  const alerts: QuoteAlert[] = [];
  for (const point of points) {
    const last = previous.get(point.symbol);
    if (last === undefined) {
      alerts.push({ symbol: point.symbol, name: point.name, direction: point.direction, change: point.change, reason: "new" });
    } else if (Math.abs(point.change - last) >= JUMP_POINTS) {
      alerts.push({ symbol: point.symbol, name: point.name, direction: point.direction, change: point.change, reason: "jump" });
    }
  }
  return alerts;
}

/**
 * Reads the market's movers list and writes what changed: a name that just entered the list, or one
 * whose change moved by a few points since the last poll. The first poll only learns the list — there
 * is nothing to compare it with yet.
 */
export async function pollQuotes(): Promise<{ symbols: number; alerts: number }> {
  const lists = await fetchMovers();
  const seen = new Map<string, { name: string; change: number; direction: "up" | "down" }>();
  for (const list of lists) {
    for (const row of list.rows) {
      seen.set(row.symbol, { name: row.name, change: row.changepercent, direction: list.direction });
    }
  }
  const previous = await sql<SnapshotRow[]>`
    SELECT symbol, change_percent FROM mover_quote_snapshots
  `;
  const before = new Map(previous.map((row) => [row.symbol, row.change_percent]));
  const alerts = compareQuotes(
    [...seen].map(([symbol, entry]) => ({ symbol, ...entry })),
    before,
  );
  await sql.begin(async (tx) => {
    for (const [symbol, entry] of seen) {
      await tx`
        INSERT INTO mover_quote_snapshots (symbol, name, change_percent)
        VALUES (${symbol}, ${entry.name}, ${entry.change})
        ON CONFLICT (symbol) DO UPDATE SET
          name = EXCLUDED.name, change_percent = EXCLUDED.change_percent, seen_at = now()
      `;
    }
    for (const alert of alerts.slice(0, MAX_QUOTE_ALERTS)) {
      await tx`
        INSERT INTO mover_quote_alerts (symbol, name, direction, change_percent, reason)
        VALUES (${alert.symbol}, ${alert.name}, ${alert.direction}, ${alert.change}, ${alert.reason})
      `;
    }
    // The alerts are a window, not a history.
    await tx`DELETE FROM mover_quote_alerts WHERE detected_at < now() - make_interval(days => ${ALERT_KEEP_DAYS})`;
  });
  return { symbols: seen.size, alerts: alerts.length };
}

/** The quoted moves of the last while, newest first. */
async function readQuoteAlerts(): Promise<Mover[]> {
  const rows = await sql<AlertRow[]>`
    SELECT symbol, name, direction, change_percent, detected_at
    FROM mover_quote_alerts
    WHERE detected_at > now() - make_interval(mins => ${WINDOW_MINUTES})
    ORDER BY detected_at DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    id: row.symbol,
    title: row.name,
    kind: row.direction,
    label: row.direction === "up" ? "涨" : "跌",
    sourceName: "行情",
    at: row.detected_at.toISOString(),
    changePercent: row.change_percent,
  }));
}

/** What the site serves: the moves the wires reported, newest first. */
export async function loadMovers(): Promise<MoversResponse> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.response;
  const rows = await readHeadlines();
  const newest = Date.now() - WINDOW_MINUTES * 60_000;
  const items: Mover[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const title = row.title.trim();
    if (!title) continue;
    // The move's own time, not the moment the site read it: a report collected late is still the
    // report it was, and an old report is not a move of the last two hours.
    const at = Date.parse(row.at);
    if (!Number.isFinite(at) || at < newest) continue;
    // The same move reported twice is one move: the headline's own words are the key.
    const key = title.slice(0, 24);
    if (seen.has(key)) continue;
    // Only the headline is read: it is the source's own words for the move, and the body of a report
    // mentions "a new high" about many things that are not a move at all.
    const hit = matchKind(title);
    if (!hit) continue;
    seen.add(key);
    items.push({
      id: row.id,
      title,
      kind: hit.kind,
      label: hit.label,
      sourceName: row.sourceName,
      at: new Date(at).toISOString(),
      changePercent: null,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  const quotes = await readQuoteAlerts();
  const response: MoversResponse = {
    windowMinutes: WINDOW_MINUTES,
    generatedAt: new Date().toISOString(),
    items: [...quotes, ...items].slice(0, MAX_ITEMS),
  };
  cached = { at: Date.now(), response };
  return response;
}

export default defineServerModule({
  name: "movers",
  http: (app) => {
    app.get("/api/site/movers", async (_request, reply) => {
      const response = await loadMovers();
      return reply.header("Cache-Control", "public, max-age=30").send(moversResponseSchema.parse(response));
    });
  },
  schedules: [
    // The market's movers list, once a minute: what entered it and what jumped since the last look.
    { name: "movers.quotes", cron: "* * * * *", missed: "skip", run: pollQuotes },
  ],
});
