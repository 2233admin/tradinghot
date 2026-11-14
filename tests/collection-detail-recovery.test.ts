// Failure cases: a detail budget strands the tail forever; a temporary detail failure is swallowed;
// known complete articles consume the budget again; a successful page without a date starves later
// articles forever; a page larger than the response limit fails on every run; hot signals
// accidentally fetch article bodies; a page the site refuses (paywall, captcha, blocked address) is read
// again on every run, taking the budget from the entries behind it; a page that keeps failing with a
// recoverable error is read on every run for days (a challenge page, HN buzzing 2026-10-18: one page
// 47 times in two days), or is given up and never recovers (a Qoder post went online 25 hours late).
import { gate, tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectSource } from "@aihot/backend/sources/collect";

const T = tag();
const date = new Date(Date.now() - 60_000).toISOString();
const reads = new Map<string, number>();
let fail = false;
let refuse = 0;
let vanished = false;
type HeldDetail = { listing: string; detail: string; entered: { open(value: void): void }; release: { promise: Promise<void> } };
let heldDetail: HeldDetail | null = null;
type JsonItem = { title: string; url: string; date: string };
type JsonPage = { items: JsonItem[]; status?: number; entered?: { open(value: void): void }; release?: { promise: Promise<void> } };
const jsonPages = new Map<string, JsonPage>();
const jsonReads = new Map<string, number>();
const server = http.createServer((req, res) => {
  const path = req.url ?? "/";
  if (path.startsWith("/json/")) {
    jsonReads.set(path, (jsonReads.get(path) ?? 0) + 1);
    const page = jsonPages.get(path);
    if (!page) { res.writeHead(404); res.end(); return; }
    const answer = () => {
      res.writeHead(page.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(page.items));
    };
    if (page.release) {
      page.entered?.open(undefined);
      void page.release.promise.then(answer);
    } else answer();
    return;
  }
  const held = heldDetail;
  if (path === held?.listing) {
    res.end([0, 1].map(i => `<article><a href="${held.detail.slice(0, -1)}${i}">Listed article ${i}</a><time datetime="${date}"></time></article>`).join(""));
    return;
  }
  // A received detail request is held open until the test has queried the committed listing material.
  if (path === held?.detail) {
    held.entered.open(undefined);
    void held.release.promise.then(() => {
      res.setHeader("content-type", "text/html");
      res.end(`<html><body><article><h1>Verified detail title</h1><time datetime="${date}"></time></article></body></html>`);
    });
    return;
  }
  if (path.startsWith("/listing")) {
    const indices = path.includes("vanish-fast") && vanished ? [0] : [0, 1, 2];
    if (path.includes("vanish-fast")) vanished = true;
    res.end(indices.map(i => `<article><a href="/detail/${path.slice(9)}-${i}">Read more</a></article>`).join(""));
    return;
  }
  reads.set(path, (reads.get(path) ?? 0) + 1);
  if (fail) { res.writeHead(503); res.end("Unavailable"); return; }
  if (refuse && path.endsWith("-0")) { res.writeHead(refuse); res.end("Verify you are human"); return; }
  res.setHeader("content-type", "text/html");
  // A long paper with inline figures: larger than any response limit, its byline at the top.
  const figures = path.includes("oversized") ? `<p>${"figure ".repeat(1_500_000)}</p>` : "";
  const published = path.includes("old-fast") || path.includes("boundary-fast") && path.endsWith("-0") ? "2020-01-01T00:00:00.000Z" : date;
  res.end(`<html><body><article><h1>Verified title ${path}</h1>${path.includes("undated") ? "" : `<time datetime="${published}"></time>`}<p>${"Verified original article body. ".repeat(50)}</p>${figures}</article></body></html>`);
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await stopBoss(); await closeDb(); });

async function source(name: string, mode = "editorial", maxFetches = 1) {
  const id = `detail-${T}-${name}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,config,cursor,next_fetch_at)
    VALUES (${id},${name},'web_list','T1',${mode},${sql.json({ url: `${base}/listing/${id}`, itemSelector: "article", linkSelector: "a",
      detail: { maxFetches, titleSelector: "h1", titleAuthoritative: true, publishedAtSelector: "time", publishedAtAuthoritative: true } })},
      ${sql.json({ initializedAt: new Date().toISOString() })},'2100-01-01')`;
  return id;
}
const rows = (id: string) => sql`SELECT title,published_at,body_text,revision FROM articles WHERE source_id=${id} ORDER BY url`;
const detail = async (id: string) => (await sql`SELECT detail FROM fetch_runs WHERE source_id=${id} ORDER BY id DESC LIMIT 1`)[0]!.detail;

async function jsonFastSource(name: string, maxPages: number) {
  const id = `detail-${T}-${name}`;
  const path = `/json/${id}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,config,cursor,next_fetch_at)
    VALUES (${id},${name},'json_list','T1','editorial',
      ${sql.json({ url: `${base}${path}`, titlePaths: ["title"], urlTemplate: "{raw:url}", publishedAtPath: "date",
        _aihot: { fast: true }, pagination: { pageParam: "page", startPage: 1, maxPages } })},
      ${sql.json({ initializedAt: new Date().toISOString() })},'2100-01-01')`;
  return { id, path };
}
const jsonItem = (id: string, page: number): JsonItem => ({
  title: `JSON page ${page}`, url: `${base}/post/${id}-${page}`, date,
});

test("later listing runs fill missing detail fields left beyond the existing budget", async () => {
  const id = await source("budget");
  assert.equal((await collectSource(id)).created, 3);
  assert.equal((await rows(id)).filter(r => r.published_at).length, 1);
  await collectSource(id);
  await collectSource(id);
  const complete = await rows(id);
  assert.equal(complete.filter(r => r.published_at).length, 3);
  assert.ok(complete.every(r => r.title.startsWith("Verified title")));
  assert.ok(complete.every(r => r.body_text?.includes("Verified original article body")));
  const before = [...reads.values()].reduce((a, b) => a + b, 0);
  const repeat = await collectSource(id);
  assert.equal(repeat.revised, 0);
  assert.equal([...reads.values()].reduce((a, b) => a + b, 0), before, "complete articles are not read again");
});

test("a failed detail read stays observable and can recover on a later listing run", async () => {
  const id = await source("failure", "hot_signal");
  fail = true;
  try {
    assert.equal((await collectSource(id)).status, "ok", "the successful listing is retained");
    const failed = await detail(id);
    assert.equal(failed.detailAttempts, 1);
    assert.equal(failed.detailFailures, 1);
    assert.match(failed.detailErrors[0].error, /503/);
    assert.match(failed.detailErrors[0].url, /detail/);
  } finally { fail = false; }
  await collectSource(id);
  assert.equal((await rows(id)).filter(r => r.published_at).length, 1);
  assert.ok((await rows(id)).every(r => r.body_text === null), "hot signals do not gain extracted bodies");
  assert.equal((await detail(id)).detailFailures, 0);
});

// 10-20..11-01: every "详情补全失败" follow-up left after the fixes was HN links to sites refusing us
// (401/403/419), closed as accepted each week; the site's answer is final, nothing of ours failed.
test("a page the site refuses is recorded once, not counted as a failure and not read again; the entries behind it get the budget", async () => {
  for (const status of [402, 403, 468]) {
    const id = await source(`refused-${status}`, "hot_signal");
    refuse = status;
    try {
      await collectSource(id);
      const first = await detail(id);
      assert.equal(first.detailFailures, 0);
      assert.match(first.detailErrors[0].error, new RegExp(String(status)));
      await collectSource(id);
      await collectSource(id);
    } finally { refuse = 0; }
    assert.equal(reads.get(`/detail/${id}-0`), 1, "the refused page is not bought again");
    assert.equal((await detail(id)).detailFailures, 0);
    const dated = await sql`SELECT url FROM articles WHERE source_id=${id} AND published_at IS NOT NULL ORDER BY url`;
    assert.deepEqual(dated.map(r => r.url.slice(-2)), ["-1", "-2"], "the refused entry keeps no date; the others get theirs");
  }
});

test("successful detail pages without dates do not consume every later run's budget", async () => {
  const id = await source("undated");
  for (let i = 0; i < 4; i++) await collectSource(id);
  const saved = await rows(id);
  assert.ok(saved.every(r => r.title.startsWith("Verified title")));
  assert.ok(saved.every(r => r.published_at === null));
  assert.equal([...reads.entries()].filter(([url]) => url.includes(id)).reduce((sum, [, n]) => sum + n, 0), 3);
});

test("a refused entry excluded by the publication boundary is not read again after a day", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const id = await source("refused-excluded", "hot_signal", 3);
  await sql`UPDATE sources SET config = config || ${sql.json({ publishedAfter: new Date(Date.now() + 3600_000).toISOString() })} WHERE id=${id}`;
  refuse = 403;
  try {
    await collectSource(id);
    t.mock.timers.tick(24 * 3600_000);
    await collectSource(id);
    assert.equal(reads.get(`/detail/${id}-0`), 1, "expiry of a date check cannot revive an explicit access refusal");
    assert.equal((await rows(id)).length, 0);
  } finally { refuse = 0; }
});

test("a detail page larger than the response limit is read once up to the limit, without a cut-off body", async () => {
  const id = await source("oversized");
  for (let i = 0; i < 3; i++) await collectSource(id);
  assert.equal((await detail(id)).detailFailures, 0);
  const saved = await rows(id);
  assert.ok(saved.every(r => r.title.startsWith("Verified title") && r.published_at?.toISOString() === date));
  assert.ok(saved.every(r => r.body_text === null), "a body cut at the limit is not stored");
  const readsOf = () => [...reads.entries()].filter(([url]) => url.includes(id)).reduce((sum, [, n]) => sum + n, 0);
  assert.equal(readsOf(), 3);
  await collectSource(id);
  assert.equal(readsOf(), 3, "the page is not read again");
});

test('recoverable errors at the front cannot consume every later detail budget', async () => {
  for (const status of [404, 429, 503]) {
    const id = await source(`retry-tail-${status}`, 'hot_signal');
    refuse = status;
    try {
      for (let run = 0; run < 3; run++) await collectSource(id);
      const dated = await sql`SELECT url FROM articles WHERE source_id=${id} AND published_at IS NOT NULL ORDER BY url`;
      assert.deepEqual(dated.map(r => r.url.slice(-2)), ['-1', '-2'], `${status}: later entries must be reached before retrying the first`);
      assert.equal(reads.get(`/detail/${id}-0`), 1);
      await collectSource(id);
      assert.equal(reads.get(`/detail/${id}-0`), 2, 'a transient error remains eligible for recovery');
    } finally { refuse = 0; }
    await collectSource(id);
    assert.equal((await rows(id)).filter(r => r.published_at).length, 3, 'the failed entry still recovers');
  }
});

test("a page that keeps failing is read less and less often, never given up, and recovers", async (t) => {
  const HOUR = 3_600_000;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const id = await source("backoff", "hot_signal", 3);
  const readsOf = () => reads.get(`/detail/${id}-0`) ?? 0;
  refuse = 503;
  try {
    for (let run = 0; run < 4; run++) await collectSource(id);
    assert.equal(readsOf(), 3, "three straight tries, then it waits");
    const waiting = await detail(id);
    assert.equal(waiting.detailFailures, 0, "a page waiting for its next try is not another failure");
    assert.equal(waiting.detailPending, 1);
    t.mock.timers.tick(HOUR);
    await collectSource(id);
    await collectSource(id);
    assert.equal(readsOf(), 4, "an hour later it is tried once, then waits longer");
    t.mock.timers.tick(HOUR);
    await collectSource(id);
    assert.equal(readsOf(), 4, "the second wait is two hours");
    t.mock.timers.tick(HOUR);
    await collectSource(id);
    assert.equal(readsOf(), 5);
    for (let day = 0; day < 4; day++) {
      t.mock.timers.tick(24 * HOUR);
      await collectSource(id);
    }
    assert.equal(readsOf(), 9, "the wait stops growing at a day: the page is never given up");
  } finally { refuse = 0; }
  t.mock.timers.tick(24 * HOUR);
  await collectSource(id);
  assert.equal(readsOf(), 10);
  assert.equal((await rows(id)).filter(r => r.published_at).length, 3, "the page recovers");
  await collectSource(id);
  assert.equal(readsOf(), 10, "a recovered page is not read again");
});

test("a fast source caches listings before a slow detail page and admits them separately", async () => {
  const id = `detail-${T}-fast-early`;
  const entered = gate();
  const release = gate();
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,config,cursor,next_fetch_at)
    VALUES (${id},${id},'web_list','T1','editorial',
      ${sql.json({ url: `${base}/listing/${id}`, itemSelector: "article", linkSelector: "a", publishedAtSelector: "time",
        _aihot: { fast: true }, detail: { maxFetches: 2, titleSelector: "h1", titleAuthoritative: true, publishedAtSelector: "time" } })},
      ${sql.json({ initializedAt: new Date().toISOString() })},'2100-01-01')`;
  heldDetail = { listing: `/listing/${id}`, detail: `/detail/${id}-0`, entered, release };
  const collecting = collectSource(id);
  try {
    await Promise.race([
      entered.promise,
      collecting.then((result) => { throw new Error(`detail was not requested before collection finished: ${result.status} ${result.error ?? ""}`); }),
    ]);
    const cached = await sql<{ payload: { title: string; publishedAt: string; publicationTime: string } }[]>`
      SELECT payload FROM fast_source_items WHERE source_id = ${id} ORDER BY payload->>'url'`;
    assert.deepEqual(cached.map(({ payload }) => [payload.title, payload.publishedAt, payload.publicationTime]), [
      ["Listed article 0", date, date], ["Listed article 1", date, date],
    ], "both entries and their source-provided times are durable while the first detail response is still blocked");
    const articles = await sql`SELECT id FROM articles WHERE source_id = ${id}`;
    assert.equal(articles.length, 0, "unverified listing material has not entered the publication pipeline");
    const [pending] = await sql<{ last_fetch_at: Date | null }[]>`SELECT last_fetch_at FROM sources WHERE id = ${id}`;
    assert.equal(pending!.last_fetch_at, null, "the source run has not completed just because listing material was stored");
  } finally {
    release.open(undefined);
    try { await collecting; }
    finally { heldDetail = null; }
  }
  const [finished] = await sql<{ last_fetch_at: Date | null }[]>`SELECT last_fetch_at FROM sources WHERE id = ${id}`;
  assert.ok(finished!.last_fetch_at, "the source's successful-fetch time follows detail completion");
});

test("fast JSON pagination commits page one before the next request completes, then caches page two", async () => {
  const { id, path } = await jsonFastSource("json-pages", 3);
  const entered = gate();
  const release = gate();
  const first = `${path}?page=1`;
  const second = `${path}?page=2`;
  const empty = `${path}?page=3`;
  jsonPages.set(first, { items: [jsonItem(id, 1)] });
  jsonPages.set(second, { items: [jsonItem(id, 2)], entered, release });
  jsonPages.set(empty, { items: [] });
  const collecting = collectSource(id);
  try {
    await Promise.race([
      entered.promise,
      collecting.then((result) => { throw new Error(`second JSON page was not requested before collection finished: ${result.status} ${result.error ?? ""}`); }),
    ]);
    const cached = await sql<{ payload: { title: string } }[]>`
      SELECT payload FROM fast_source_items WHERE source_id = ${id} ORDER BY payload->>'url'`;
    assert.deepEqual(cached.map(({ payload }) => payload.title), ["JSON page 1"]);
    const [run] = await sql<{ finished_at: Date | null }[]>`
      SELECT finished_at FROM fetch_runs WHERE source_id = ${id} ORDER BY id DESC LIMIT 1`;
    assert.equal(run!.finished_at, null);
  } finally {
    release.open(undefined);
    try { await collecting; }
    finally { jsonPages.delete(first); jsonPages.delete(second); jsonPages.delete(empty); }
  }
  assert.equal((await collecting).status, "ok");
  const cached = await sql<{ payload: { title: string } }[]>`
    SELECT payload FROM fast_source_items WHERE source_id = ${id} ORDER BY payload->>'url'`;
  assert.deepEqual(cached.map(({ payload }) => payload.title), ["JSON page 1", "JSON page 2"]);
  assert.deepEqual([jsonReads.get(first), jsonReads.get(second), jsonReads.get(empty)], [1, 1, 1]);
});

test("fast JSON pagination keeps the first version when an item shifts across pages", async () => {
  const { id, path } = await jsonFastSource("json-page-overlap", 3);
  const first = `${path}?page=1`;
  const second = `${path}?page=2`;
  const empty = `${path}?page=3`;
  const item = jsonItem(id, 1);
  jsonPages.set(first, { items: [item] });
  jsonPages.set(second, { items: [{ ...item, title: "Older listing version" }] });
  jsonPages.set(empty, { items: [] });
  try {
    assert.equal((await collectSource(id)).status, "ok");
    const [cached] = await sql<{ payload: { title: string } }[]>`SELECT payload FROM fast_source_items WHERE source_id = ${id}`;
    const [article] = await sql<{ title: string }[]>`SELECT title FROM articles WHERE source_id = ${id}`;
    assert.equal(cached!.payload.title, "JSON page 1");
    assert.equal(article!.title, "JSON page 1");
  } finally { jsonPages.delete(first); jsonPages.delete(second); jsonPages.delete(empty); }
});

test("a changed source cannot add later pages from an obsolete configuration", async () => {
  const { id, path } = await jsonFastSource("json-config-change", 3);
  const entered = gate();
  const release = gate();
  const first = `${path}?page=1`;
  const second = `${path}?page=2`;
  jsonPages.set(first, { items: [jsonItem(id, 1)] });
  jsonPages.set(second, { items: [jsonItem(id, 2)], entered, release });
  const collecting = collectSource(id);
  try {
    await Promise.race([
      entered.promise,
      collecting.then((result) => { throw new Error(`second page was not reached: ${result.error ?? result.status}`); }),
    ]);
    await sql`UPDATE sources SET config = jsonb_set(config, '{pagination,maxPages}', '2'::jsonb) WHERE id = ${id}`;
  } finally {
    release.open(undefined);
  }
  try {
    const result = await collecting;
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /source changed during collection/);
    const cached = await sql<{ payload: { title: string } }[]>`SELECT payload FROM fast_source_items WHERE source_id = ${id}`;
    assert.deepEqual(cached.map(({ payload }) => payload.title), ["JSON page 1"]);
    const [state] = await sql<{ last_fetch_at: Date | null; config: { pagination: { maxPages: number } } }[]>`
      SELECT last_fetch_at,config FROM sources WHERE id = ${id}`;
    assert.equal(state!.last_fetch_at, null);
    assert.equal(state!.config.pagination.maxPages, 2);
  } finally { jsonPages.delete(first); jsonPages.delete(second); }
});

test("fast JSON pagination keeps and processes the first page when a later page fails", async () => {
  const { id, path } = await jsonFastSource("json-failed-page", 3);
  const first = `${path}?page=1`;
  const second = `${path}?page=2`;
  jsonPages.set(first, { items: [jsonItem(id, 1)] });
  jsonPages.set(second, { items: [], status: 503 });
  try {
    const result = await collectSource(id);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /503/);
    const cached = await sql<{ payload: { title: string } }[]>`
      SELECT payload FROM fast_source_items WHERE source_id = ${id}`;
    assert.deepEqual(cached.map(({ payload }) => payload.title), ["JSON page 1"]);
    const articles = await sql<{ title: string }[]>`SELECT title FROM articles WHERE source_id = ${id}`;
    assert.deepEqual(articles.map((article) => article.title), ["JSON page 1"]);
    const [run] = await sql<{ status: string; error: string }[]>`
      SELECT status,error FROM fetch_runs WHERE source_id = ${id} ORDER BY id DESC LIMIT 1`;
    assert.equal(run!.status, "failed");
    assert.match(run!.error, /503/);
    const [sourceState] = await sql<{ last_fetch_at: Date; next_fetch_at: Date }[]>`
      SELECT last_fetch_at,next_fetch_at FROM sources WHERE id = ${id}`;
    assert.equal(sourceState!.next_fetch_at.getTime() - sourceState!.last_fetch_at.getTime(), 2 * 60_000);
    assert.deepEqual([jsonReads.get(first), jsonReads.get(second)], [1, 2]);
  } finally { jsonPages.delete(first); jsonPages.delete(second); }
});

test("fast JSON pagination treats a nonempty final allowed page as unverified coverage", async () => {
  const { id, path } = await jsonFastSource("json-page-cap", 2);
  const first = `${path}?page=1`;
  const second = `${path}?page=2`;
  const third = `${path}?page=3`;
  jsonPages.set(first, { items: [jsonItem(id, 1)] });
  jsonPages.set(second, { items: [jsonItem(id, 2)] });
  jsonPages.set(third, { items: [] });
  try {
    const result = await collectSource(id);
    // The source answered and its pages were stored; what it cannot prove is that it answered for the
    // whole window, so the round succeeds with a note instead of failing.
    assert.equal(result.status, "ok");
    assert.match(result.note ?? "", /page limit; coverage is unverified/);
    const [run] = await sql<{ status: string; error: string | null; detail: { paginationLimited: boolean; coverageNote?: string } }[]>`
      SELECT status,error,detail FROM fetch_runs WHERE source_id = ${id} ORDER BY id DESC LIMIT 1`;
    assert.equal(run!.status, "ok");
    assert.equal(run!.error, null);
    assert.match(run!.detail.coverageNote ?? "", /page limit; coverage is unverified/);
    assert.equal(run!.detail.paginationLimited, true);
    assert.deepEqual([jsonReads.get(first), jsonReads.get(second), jsonReads.get(third) ?? 0], [1, 1, 0]);
    const cached = await sql<{ payload: { title: string } }[]>`
      SELECT payload FROM fast_source_items WHERE source_id = ${id} ORDER BY payload->>'url'`;
    assert.deepEqual(cached.map(({ payload }) => payload.title), ["JSON page 1", "JSON page 2"]);
    const [sourceState] = await sql<{ cursor: { lastOkAt?: string }; last_error: string }[]>`
      SELECT cursor,last_error FROM sources WHERE id = ${id}`;
    assert.equal(sourceState!.cursor.lastOkAt, undefined);
    assert.match(sourceState!.last_error, /coverage is unverified/);
  } finally { jsonPages.delete(first); jsonPages.delete(second); jsonPages.delete(third); }
});

test("fast cache does not admit an old post rejected by its authoritative detail date", async () => {
  const id = await source("old-fast", "editorial", 3);
  await sql`UPDATE sources SET config = jsonb_set(config, '{_aihot}', '{"fast":true}'::jsonb) WHERE id = ${id}`;
  assert.equal((await collectSource(id)).status, "ok");
  const cached = await sql`SELECT identity_key FROM fast_source_items WHERE source_id = ${id}`;
  assert.equal(cached.length, 3, "the original listing is cached independently");
  const articles = await sql`SELECT url FROM articles WHERE source_id = ${id}`;
  assert.ok(articles.every((a) => !String(a.url).endsWith("-0")), "the dated-out item is not admitted");
});

test("a cached post is enriched after it disappears from the source listing", async () => {
  const id = await source("vanish-fast", "editorial", 3);
  await sql`UPDATE sources SET config = jsonb_set(config, '{_aihot}', '{"fast":true}'::jsonb) WHERE id = ${id}`;
  for (let i = 0; i < 3; i++) assert.equal((await collectSource(id)).status, "ok");
  const completed = await sql<{ payload: { url: string }; pending: boolean }[]>`
    SELECT payload, pending FROM fast_source_items WHERE source_id = ${id} ORDER BY payload->>'url'`;
  assert.equal(completed.length, 3);
  assert.ok(completed.every((row) => !row.pending), "all cached entries have completed their detail work");
  const articles = await rows(id);
  assert.ok(articles.every((a) => String(a.title).startsWith("Verified title")), "the missing listing entries gained their verified details");
});

test("fast sources with a publication boundary cache undated listings until their authoritative dates are known", async () => {
  const id = await source("boundary-fast", "editorial", 3);
  const boundary = new Date(Date.parse(date) - 60_000).toISOString();
  await sql`UPDATE sources SET config = config || ${sql.json({ _aihot: { fast: true }, publishedAfter: boundary })} WHERE id = ${id}`;
  for (let i = 0; i < 3; i++) assert.equal((await collectSource(id)).status, "ok");
  const cached = await sql`SELECT identity_key FROM fast_source_items WHERE source_id = ${id}`;
  assert.equal(cached.length, 3);
  const articles = await sql<{ url: string }[]>`SELECT url FROM articles WHERE source_id = ${id} ORDER BY url`;
  assert.deepEqual(articles.map((a) => a.url.slice(-2)), ["-1", "-2"]);
});

test("fast sources apply a publication boundary after ordinary detail dating too", async () => {
  const id = await source("boundary-fast-ordinary", "editorial", 3);
  const boundary = new Date(Date.parse(date) - 60_000).toISOString();
  await sql`UPDATE sources SET config = (config #- '{detail,publishedAtAuthoritative}') || ${sql.json({ _aihot: { fast: true }, publishedAfter: boundary })} WHERE id = ${id}`;
  for (let i = 0; i < 3; i++) assert.equal((await collectSource(id)).status, "ok");
  const cached = await sql`SELECT identity_key FROM fast_source_items WHERE source_id = ${id}`;
  assert.equal(cached.length, 3);
  const articles = await sql<{ url: string }[]>`SELECT url FROM articles WHERE source_id = ${id} ORDER BY url`;
  assert.deepEqual(articles.map((a) => a.url.slice(-2)), ["-1", "-2"]);
});

test("changed detail rules revisit completed fast-cache entries still in the listing", async () => {
  const id = await source("rules-fast", "editorial", 3);
  await sql`UPDATE sources SET config = jsonb_set(config, '{_aihot}', '{"fast":true}'::jsonb) WHERE id = ${id}`;
  for (let i = 0; i < 3; i++) assert.equal((await collectSource(id)).status, "ok");
  const before = reads.get(`/detail/${id}-0`);
  await sql`UPDATE sources SET config = jsonb_set(config, '{detail,summarySelector}', '"p"'::jsonb) WHERE id = ${id}`;
  for (let i = 0; i < 3; i++) assert.equal((await collectSource(id)).status, "ok");
  assert.equal(reads.get(`/detail/${id}-0`), (before ?? 0) + 1);
  const [article] = await sql<{ excerpt: string | null }[]>`SELECT excerpt FROM articles WHERE source_id = ${id} AND url LIKE '%-0'`;
  assert.match(article!.excerpt ?? "", /Verified original article body/);
});
