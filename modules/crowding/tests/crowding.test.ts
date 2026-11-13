import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { parseFeed, FeedError } from "../feed.ts";
import { loadCrowding, storeFeed } from "../server.ts";

after(closeDb);

const readyFeed = {
  schema_version: 1,
  data_product: "bagholder50_agent_feed",
  generated_at_utc: "2026-11-13T10:31:11.699198Z",
  canonical_url: "https://indices-toocoldcc.pages.dev/data/agent/bagholder50.json",
  index: {
    index_name_cn: "冷西西韭菜50指数",
    internal_code: "bagholder50_index",
    constituent_count: 50,
    data_end_date: "2026-11-13",
    summary: {
      latest_date: "2026-11-13",
      latest_point: 0.2483,
      annualized_return: -0.5344,
      recent_returns: {
        "1d": { return: -0.025510204081632737, start_date: "2026-11-12", end_date: "2026-11-13" },
        "5d": { return: 0.07862728062554303, start_date: "2026-11-06", end_date: "2026-11-13" },
        "20d": { return: -0.06794294294294301, start_date: "2026-10-16", end_date: "2026-11-13" },
      },
    },
  },
  views: {
    holdings_today: {
      status: "ready",
      signal_date: "2026-11-12",
      trade_date: "2026-11-13",
      items: [
        { ts_code: "600715.SH", name: "文投控股", bagholder_rank: 1, bagholder_score: 0.994782, today_return: 0.100324 },
      ],
    },
    avoid_tomorrow: {
      status: "ready",
      signal_date: "2026-11-13",
      trade_date: "2026-11-16",
      items: [
        { ts_code: "000530.SZ", name: "冰山冷热", bagholder_rank: 2, bagholder_score: 0.9903, today_return: -0.056621 },
        { ts_code: "600715.SH", name: "文投控股", bagholder_rank: 1, bagholder_score: 0.998629, today_return: 0.100324 },
      ],
    },
  },
};

test("the publisher's list is read as it was published", () => {
  const feed = parseFeed(readyFeed);
  assert.equal(feed.status, "ready");
  assert.equal(feed.view, "avoid_tomorrow", "the list that applies to the next session comes first");
  assert.equal(feed.signalDate, "2026-11-13");
  assert.equal(feed.tradeDate, "2026-11-16");
  assert.deepEqual(
    feed.items.map((item) => item.tsCode),
    ["600715.SH", "000530.SZ"],
    "the list is in the publisher's order, the most crowded first",
  );
  assert.equal(feed.index?.point, 0.2483);
  assert.equal(feed.index?.returns.d5, 0.07862728062554303);
});

test("the list in effect is shown when the next one is not out yet", () => {
  const feed = parseFeed({
    ...readyFeed,
    views: {
      ...readyFeed.views,
      avoid_tomorrow: { status: "not_ready", signal_date: "2026-11-13", trade_date: "2026-11-16", items: [] },
    },
  });
  assert.equal(feed.status, "ready");
  assert.equal(feed.view, "holdings_today");
  assert.equal(feed.items[0]?.tsCode, "600715.SH");
});

test("a feed that is not what it promises is refused", () => {
  assert.throws(
    () =>
      parseFeed({
        ...readyFeed,
        views: {
          ...readyFeed.views,
          avoid_tomorrow: {
            status: "ready",
            signal_date: "2026-11-13",
            trade_date: "2026-11-16",
            items: [{ ts_code: "600715", name: "文投控股", bagholder_rank: 1, bagholder_score: 1, today_return: 0.1 }],
          },
        },
      }),
    FeedError,
    "a code without its exchange is not a code we can serve",
  );
  assert.throws(() => parseFeed({ schema_version: 1, generated_at_utc: "now", views: {} }), FeedError);
});

test("the site serves the list it stored, in rank order", async () => {
  const feed = parseFeed(readyFeed);
  await storeFeed(feed, "a".repeat(64));
  const snapshot = await loadCrowding();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.signalDate, "2026-11-13");
  assert.equal(snapshot.tradeDate, "2026-11-16");
  assert.equal(snapshot.sourceView, "avoid_tomorrow");
  assert.deepEqual(
    snapshot.items.map((item) => item.rank),
    [1, 2],
  );
  assert.equal(snapshot.items[0]?.name, "文投控股");
  assert.equal(snapshot.index?.annualizedReturn, -0.5344);
  assert.equal(snapshot.source?.sha256, "a".repeat(64));

  const top = await loadCrowding(1);
  assert.equal(top.items.length, 1, "the reminder asks for a few names only");
  assert.equal(top.items[0]?.rank, 1);
});
