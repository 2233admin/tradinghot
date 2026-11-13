// The crowding module's backend: it keeps the daily high-crowding list the public Bagholder 50 index
// publishes, and answers it as the site's own api. The publisher's method is fixed (four crowding
// factors, the most crowded 50 stocks, effective the next session); this module only reads what the
// publisher releases. It never turns the list into a buy list or a short list.
import { createHash } from "node:crypto";
import { sql } from "@aihot/backend/db";
import { defineServerModule } from "@aihot/backend/modules";
import { parseFeed, type ParsedFeed } from "./feed.ts";
import type { CrowdingItem, CrowdingSnapshot } from "./types.ts";

/** Where the publisher releases the list and the index summary (public, no key). */
const FEED_URL = "https://indices-toocoldcc.pages.dev/data/agent/bagholder50.json";
/** The page a reader can read the same numbers on. */
const SOURCE_URL = "https://indices-toocoldcc.pages.dev/";
/** How long a stored list stays "today's" before it is called stale. */
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

interface StateRow {
  status: string;
  message: string | null;
  signal_date: string | null;
  trade_date: string | null;
  source_view: string | null;
  index_date: string | null;
  index_point: string | null;
  index_annualized: string | null;
  index_return_1d: string | null;
  index_return_5d: string | null;
  index_return_20d: string | null;
  source_url: string | null;
  source_sha256: string | null;
  published_at: Date | null;
  fetched_at: Date;
}

interface ItemRow {
  ts_code: string;
  name: string;
  crowding_rank: number;
  score: string;
  today_return: string;
}

let cached: { at: number; snapshot: CrowdingSnapshot } | null = null;

async function readFeed(): Promise<{ feed: ParsedFeed; sha256: string }> {
  // The engine's fetcher refuses the local resolver's addresses, which is right for addresses a source
  // gives us and wrong for this one: the publisher is a fixed host we chose, and there is no user input
  // here to protect.
  const response = await fetch(FEED_URL, {
    headers: { accept: "application/json", "user-agent": "aihot-crowding/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`crowding feed answered ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const feed = parseFeed(JSON.parse(body.toString("utf8")));
  return { feed, sha256: createHash("sha256").update(body).digest("hex") };
}

/** Writes what the publisher released: the list for its signal day, and the state of the last fetch. */
export async function storeFeed(feed: ParsedFeed, sha256: string): Promise<void> {
  await sql.begin(async (tx) => {
    if (feed.status === "ready" && feed.signalDate && feed.tradeDate) {
      await tx`DELETE FROM crowding_snapshots WHERE signal_date = ${feed.signalDate}`;
      for (const item of feed.items) {
        await tx`
          INSERT INTO crowding_snapshots (signal_date, trade_date, ts_code, name, crowding_rank, score, today_return)
          VALUES (${feed.signalDate}, ${feed.tradeDate}, ${item.tsCode}, ${item.name}, ${item.rank}, ${item.score}, ${item.todayReturn})
        `;
      }
    }
    await tx`
      INSERT INTO crowding_state (
        id, status, message, signal_date, trade_date, source_view, index_date, index_point,
        index_annualized, index_return_1d, index_return_5d, index_return_20d, source_url, source_sha256,
        published_at, fetched_at
      ) VALUES (
        'latest', ${feed.status}, ${feed.message}, ${feed.signalDate}, ${feed.tradeDate}, ${feed.view},
        ${feed.index?.date ?? null}, ${feed.index?.point ?? null}, ${feed.index?.annualizedReturn ?? null},
        ${feed.index?.returns.d1 ?? null}, ${feed.index?.returns.d5 ?? null}, ${feed.index?.returns.d20 ?? null},
        ${SOURCE_URL}, ${sha256}, ${feed.publishedAt}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status, message = EXCLUDED.message, signal_date = EXCLUDED.signal_date,
        trade_date = EXCLUDED.trade_date, source_view = EXCLUDED.source_view, index_date = EXCLUDED.index_date,
        index_point = EXCLUDED.index_point, index_annualized = EXCLUDED.index_annualized,
        index_return_1d = EXCLUDED.index_return_1d, index_return_5d = EXCLUDED.index_return_5d,
        index_return_20d = EXCLUDED.index_return_20d, source_url = EXCLUDED.source_url,
        source_sha256 = EXCLUDED.source_sha256, published_at = EXCLUDED.published_at, fetched_at = EXCLUDED.fetched_at
    `;
  });
  cached = null;
}

/** Fetches the publisher's release and stores it. The schedule runs this once a day. */
export async function refreshCrowding(): Promise<{ status: string; items: number }> {
  const { feed, sha256 } = await readFeed();
  await storeFeed(feed, sha256);
  return { status: feed.status, items: feed.items.length };
}

/** What the site serves: the last list the publisher released, with the day it belongs to. */
export async function loadCrowding(top?: number): Promise<CrowdingSnapshot> {
  if (cached && Date.now() - cached.at < 30_000 && !top) return cached.snapshot;
  const states = await sql<StateRow[]>`
    SELECT status, message, signal_date::text AS signal_date, trade_date::text AS trade_date, source_view,
           index_date::text AS index_date, index_point::text AS index_point, index_annualized::text AS index_annualized,
           index_return_1d::text AS index_return_1d, index_return_5d::text AS index_return_5d,
           index_return_20d::text AS index_return_20d, source_url, source_sha256, published_at, fetched_at
    FROM crowding_state WHERE id = 'latest'
  `;
  const state = states[0];
  if (!state) {
    return {
      status: "empty",
      message: "还没有拉到名单。",
      signalDate: null,
      tradeDate: null,
      sourceView: null,
      updatedAt: null,
      publishedAt: null,
      source: null,
      index: null,
      items: [],
    };
  }
  const rows = state.signal_date
    ? await sql<ItemRow[]>`
        SELECT ts_code, name, crowding_rank, score::text AS score, today_return::text AS today_return
        FROM crowding_snapshots WHERE signal_date = ${state.signal_date} ORDER BY crowding_rank
      `
    : [];
  const items: CrowdingItem[] = rows.map((row) => ({
    tsCode: row.ts_code,
    name: row.name,
    rank: row.crowding_rank,
    score: Number(row.score),
    todayReturn: Number(row.today_return),
  }));
  const stale = Date.now() - state.fetched_at.getTime() > STALE_AFTER_MS;
  const status: CrowdingSnapshot["status"] =
    stale ? "stale" : state.status === "ready" || state.status === "not_ready" ? state.status : "empty";
  const snapshot: CrowdingSnapshot = {
    status,
    message: stale ? `上一次更新在 ${state.fetched_at.toISOString()}，已经不是当天。` : state.message,
    signalDate: state.signal_date,
    tradeDate: state.trade_date,
    sourceView: state.source_view,
    updatedAt: state.fetched_at.toISOString(),
    publishedAt: state.published_at ? state.published_at.toISOString() : null,
    source: { url: state.source_url ?? SOURCE_URL, sha256: state.source_sha256 },
    index:
      state.index_date === null
        ? null
        : {
            date: state.index_date,
            point: Number(state.index_point),
            annualizedReturn: Number(state.index_annualized),
            returns: {
              d1: Number(state.index_return_1d),
              d5: Number(state.index_return_5d),
              d20: Number(state.index_return_20d),
            },
          },
    items: top && top > 0 ? items.slice(0, top) : items,
  };
  if (!top) cached = { at: Date.now(), snapshot };
  return snapshot;
}

export default defineServerModule({
  name: "crowding",
  http: (app) => {
    app.get("/api/site/crowding", async (request, reply) => {
      const asked = Number((request.query as { top?: string }).top ?? "");
      const snapshot = await loadCrowding(Number.isFinite(asked) && asked > 0 ? asked : undefined);
      return reply.header("Cache-Control", "public, max-age=120").send(snapshot);
    });
  },
  schedules: [
    // The publisher says it publishes at 20:00 Beijing; the morning run is the catch-up for a day the
    // evening one missed.
    { name: "crowding.refresh", cron: "10 20 * * 1-5", missed: "once", run: refreshCrowding },
    { name: "crowding.refresh-morning", cron: "25 8 * * 1-5", missed: "once", run: refreshCrowding },
  ],
});
