// The NewsNow module on its own: the registry, the adapters that came with it, and the cache the
// reader keeps. No database, no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalSourceId, newsnowSources } from "../registry.ts";
import { readSource, toFeedItems } from "../reader.ts";
import { NEWSNOW_SOURCES } from "../sources.ts";
import { loadGetters } from "../service.ts";
import { readKuaishou } from "../upstream/sources/kuaishou.ts";
import type { NewsItem } from "../upstream/runtime.ts";

test("the registry lists every source once, with its kind and its interval", () => {
  const sources = newsnowSources();
  assert.ok(sources.length > 40, "the upstream registry has more sources than this");
  const ids = sources.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length, "a source is listed twice");
  for (const source of sources) {
    assert.ok(source.name, `${source.id} has no name`);
    assert.ok(source.type === "hottest" || source.type === "realtime", `${source.id} has no kind`);
    assert.ok(source.intervalMs > 0, `${source.id} has no interval`);
  }
});

test("an alias points at the source that is really read", () => {
  assert.equal(canonicalSourceId("v2ex"), "v2ex-share");
  assert.equal(canonicalSourceId("v2ex-share"), "v2ex-share");
  assert.equal(canonicalSourceId("nothing-like-this"), null);
  // An alias is not a source of its own.
  assert.equal(newsnowSources().some((source) => source.id === "v2ex"), false);
});

test("every source the registry lists has an adapter", async () => {
  const getters = await loadGetters();
  const missing = newsnowSources().filter((source) => !getters.has(source.id)).map((source) => source.id);
  assert.deepEqual(missing, [], "a source is listed that cannot be read");
});
test("every available upstream source is scheduled and hot lists stay signals", () => {
  const choices = new Map(NEWSNOW_SOURCES.map((source) => [source.id, source.mode]));
  for (const source of newsnowSources()) {
    assert.equal(choices.get(source.id), source.type === "hottest" ? "hot_signal" : "editorial", source.id);
  }
  assert.equal(choices.size, newsnowSources().length);
});

test("unsafe links and unrecognisable dates do not enter the feed", () => {
  const feed = toFeedItems([
    { id: "bad", title: "Bad", url: "javascript:alert(1)" },
    { id: "credentials", title: "Bad", url: "https://name:secret@example.com/post" },
    { id: "unknown", title: "Unknown", url: "https://example.com/post", pubDate: "not a publication date" },
  ]);
  assert.deepEqual(feed, [{ id: "unknown", title: "Unknown", url: "https://example.com/post", publishedAt: null }]);
});

test("Kuaishou reads the browser-compatible response as a hot list", async () => {
  const state = { defaultClient: {
    ROOT_QUERY: { 'visionHotRank({"page":"home"})': { id: "rank" } },
    rank: { items: [{ id: "VisionHotRankItem:测试" }] },
    "VisionHotRankItem:测试": { name: "真实热搜", tagType: "普通" },
  } };
  const fetchHtml = async (_url: string, options: { headers: Record<string, string>; responseType: "text" }) =>
    options.headers["user-agent"]?.includes("Chrome/") && options.responseType === "text"
      ? `window.__APOLLO_STATE__ = ${JSON.stringify(state)};`
      : '{"result":2}';
  const items = await readKuaishou(fetchHtml);
  assert.equal(items[0]?.title, "真实热搜");
  assert.equal("pubDate" in items[0]!, false);
  assert.match(items[0]?.url ?? "", /^https:\/\/www\.kuaishou\.com\/search\/video\?/);
});


test("an entry without a time of its own has none, and the repeats are dropped", () => {
  const items: NewsItem[] = [
    { id: "1", title: "First", url: "https://example.com/a" },
    { id: "1", title: "First again", url: "https://example.com/a" },
    { id: "2", title: "Second", url: "https://example.com/b", pubDate: 1750000000000 },
    { id: "3", title: "", url: "https://example.com/c" },
  ];
  const feed = toFeedItems(items);
  assert.equal(feed.length, 2);
  assert.equal(feed[0]!.publishedAt, null);
  assert.equal(feed[1]!.publishedAt, new Date(1750000000000).toISOString());
});

test("a cached reading keeps the time the source was really read", async () => {
  const getter = async () => [{ id: "1", title: "First", url: "https://example.com/a" }];
  const fresh = await readSource("test-fresh", getter, 60_000);
  assert.equal(fresh.status, "success");
  assert.ok(fresh.refreshedAt);
  const cached = await readSource("test-fresh", getter, 60_000);
  assert.equal(cached.status, "cache");
  assert.equal(cached.refreshedAt, fresh.refreshedAt, "a cached list was given a new time");
  assert.deepEqual(cached.items, fresh.items);
});

test("a source that fails keeps its last reading and says why", async () => {
  let calls = 0;
  const getter = async () => {
    calls += 1;
    if (calls === 1) return [{ id: "1", title: "First", url: "https://example.com/a" }];
    throw new Error("the site did not answer");
  };
  const first = await readSource("test-failing", getter, 0);
  assert.equal(first.status, "success");
  const failed = await readSource("test-failing", getter, 0);
  assert.equal(failed.status, "cache");
  assert.equal(failed.refreshedAt, first.refreshedAt);
  assert.match(failed.error ?? "", /did not answer/);
});

test("a source that never answered has nothing to serve", async () => {
  const failed = await readSource("test-empty", async () => { throw new Error("no answer"); }, 0);
  assert.equal(failed.status, "error");
  assert.equal(failed.refreshedAt, null);
  assert.deepEqual(failed.items, []);
});
