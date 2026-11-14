// The browser fallback turns opencli twitter rows into the SocialData shape the collector reads.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BROWSER_X_SEARCHES_PER_HOUR, BrowserXThrottleError, browserRowsToTweets, browserXQuota, resetBrowserXSession, searchTweetsInBrowser } from "../packages/backend/src/providers/x-browser.ts";
import { HttpStatusError } from "../packages/backend/src/lib/http-fetch.ts";
import { readXSearch } from "../packages/backend/src/sources/x.ts";

test("opencli rows map to tweets the X collector understands", () => {
  const stdout = JSON.stringify([
    {
      id: "2118801135872172351", author: "FirstSquawk", bio: "", text: "IBM UNVEILS ITS MOST ADVANCED QUANTUM COMPUTER IN CHICAGO - CT",
      created_at: "Fri Nov 06 20:22:10 +0000 2026", likes: 25, views: "17735",
      url: "https://x.com/i/status/2118801135872172351", has_media: false, media_urls: [], media_posters: [], card: null, quoted_tweet: null,
    },
    {
      id: "2118801114711851130", author: "@KobeissiLetter", text: "RT @zerohedge: something happened",
      created_at: "Fri Nov 06 20:22:05 +0000 2026", media_urls: ["https://pbs.twimg.com/media/one.jpg"], quoted_tweet: null,
    },
  ]);
  const [plain, retweet] = browserRowsToTweets(stdout);
  assert.equal(plain!.id_str, "2118801135872172351");
  assert.equal(plain!.user.screen_name, "FirstSquawk");
  assert.equal(plain!.full_text, "IBM UNVEILS ITS MOST ADVANCED QUANTUM COMPUTER IN CHICAGO - CT");
  assert.equal(new Date(plain!.tweet_created_at).toISOString(), "2026-11-06T20:22:10.000Z");
  assert.equal(plain!.retweeted_status, null);
  assert.equal(retweet!.user.screen_name, "KobeissiLetter");
  assert.ok(retweet!.retweeted_status, "a retweet is marked so the collector drops it");
  assert.equal(retweet!.entities?.media?.[0]?.media_url_https, "https://pbs.twimg.com/media/one.jpg");
});

test("a valid empty search stays empty, while malformed output fails without exposing it", () => {
  assert.deepEqual(browserRowsToTweets("[]\n"), []);
  assert.deepEqual(browserRowsToTweets(JSON.stringify({ data: [] })), []);
  for (const input of ["private-marker not json", JSON.stringify({ items: ["private-marker"] }), JSON.stringify([{ id: "private-marker" }])]) {
    assert.throws(() => browserRowsToTweets(input), (error: Error) => {
      assert.match(error.message, /^opencli X search returned (invalid JSON|an invalid response shape)$/);
      assert.doesNotMatch(error.message, /private-marker/);
      return true;
    });
  }
});

test("X browser search classifies explicit OpenCLI HTTP 429 without reclassifying other failures", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aihot-x-rate-limit-"));
  const bin = path.join(dir, "opencli.mjs");
  writeFileSync(bin, `process.stderr.write(process.env.X_OPENCLI_TEST_ERROR); process.exitCode = 1;`);
  const previousBin = process.env.OPENCLI_BIN;
  const previousError = process.env.X_OPENCLI_TEST_ERROR;
  try {
    process.env.OPENCLI_BIN = bin;
    resetBrowserXSession();
    const search = () => searchTweetsInBrowser({ query: "from:example -filter:replies", limit: 60 });
    const throttled = "HTTP 429: SearchTimeline fetch failed \u2014 rate-limited by Twitter (session quota); retry after cooldown (typically 15-30 min)";
    // A failure that is not a refusal stays a plain failure.
    for (const detail of [
      "HTTP 503: SearchTimeline fetch failed",
      "SearchTimeline request 429 failed without an HTTP status",
      "HTTP 503: upstream mentions HTTP 429: in diagnostic text",
    ]) {
      process.env.X_OPENCLI_TEST_ERROR = detail;
      await assert.rejects(search(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.constructor, Error);
        assert.equal(error.message, `opencli failed: ${detail}`);
        return true;
      });
    }
    process.env.X_OPENCLI_TEST_ERROR = throttled;
    await assert.rejects(search(), (error: unknown) => {
      assert.ok(error instanceof HttpStatusError);
      assert.equal(error.status, 429);
      assert.equal(error.message, `opencli failed: ${throttled}`);
      return true;
    });
    // Installed OpenCLI serializes adapter errors as YAML, folding long messages.
    const envelope = `ok: false\nerror:\n  code: UNKNOWN\n  message: >-\n    ${throttled}\n  exitCode: 1\n`;
    resetBrowserXSession();
    process.env.X_OPENCLI_TEST_ERROR = envelope;
    await assert.rejects(search(), (error: unknown) => {
      assert.ok(error instanceof HttpStatusError);
      assert.equal(error.status, 429);
      return true;
    });
    // The refusal spent the session's quota, so the session rests and the next account is skipped
    // instead of being told that it failed.
    process.env.X_OPENCLI_TEST_ERROR = "HTTP 503: SearchTimeline fetch failed";
    await assert.rejects(search(), (error: unknown) => {
      assert.ok(error instanceof BrowserXThrottleError);
      assert.match(error.message, /rests until/);
      return true;
    });
  } finally {
    if (previousBin === undefined) delete process.env.OPENCLI_BIN;
    else process.env.OPENCLI_BIN = previousBin;
    if (previousError === undefined) delete process.env.X_OPENCLI_TEST_ERROR;
    else process.env.X_OPENCLI_TEST_ERROR = previousError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the session's budget is counted in searches an hour, and a refusal rests it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aihot-x-budget-"));
  const bin = path.join(dir, "opencli.mjs");
  writeFileSync(bin, `process.stderr.write(process.env.X_OPENCLI_TEST_ERROR); process.exitCode = 1;`);
  const previousBin = process.env.OPENCLI_BIN;
  const previousError = process.env.X_OPENCLI_TEST_ERROR;
  try {
    process.env.OPENCLI_BIN = bin;
    resetBrowserXSession();
    const quota = browserXQuota();
    assert.ok(quota.remaining <= BROWSER_X_SEARCHES_PER_HOUR, "the session has a budget of searches an hour");
    assert.equal(quota.cooldownUntil, 0, "a session that was not refused may search");
    const throttled = "HTTP 429: SearchTimeline fetch failed \u2014 rate-limited by Twitter (session quota); retry after cooldown (typically 15-30 min)";
    process.env.X_OPENCLI_TEST_ERROR = throttled;
    await assert.rejects(searchTweetsInBrowser({ query: "from:example -filter:replies", limit: 60 }), (error: unknown) => {
      assert.ok(error instanceof HttpStatusError);
      assert.equal(error.status, 429);
      return true;
    });
    const resting = browserXQuota();
    assert.ok(resting.cooldownUntil > Date.now(), "the refusal rests the session");
    assert.equal(resting.remaining, quota.remaining - 1, "the refusal spent one search of the budget");
  } finally {
    if (previousBin === undefined) delete process.env.OPENCLI_BIN;
    else process.env.OPENCLI_BIN = previousBin;
    if (previousError === undefined) delete process.env.X_OPENCLI_TEST_ERROR;
    else process.env.X_OPENCLI_TEST_ERROR = previousError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the browser read moves the watermark only when it covered the stretch since it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aihot-x-watermark-"));
  const bin = path.join(dir, "opencli.mjs");
  writeFileSync(bin, `const ids = (process.env.X_OPENCLI_TEST_ROWS || "").split(",").filter(Boolean);
console.log(JSON.stringify(ids.map((id) => ({ id, author: "example", text: "post " + id, created_at: "Fri Nov 06 20:22:10 +0000 2026", media_urls: [], media_posters: [] }))));`);
  const previousBin = process.env.OPENCLI_BIN;
  const previousRows = process.env.X_OPENCLI_TEST_ROWS;
  const previousKey = process.env.SOCIALDATA_API_KEY;
  try {
    process.env.OPENCLI_BIN = bin;
    delete process.env.SOCIALDATA_API_KEY;
    resetBrowserXSession();
    // The newest post is 300, the oldest 100: the stretch since the watermark 200 was read, so the
    // watermark moves to the newest post.
    process.env.X_OPENCLI_TEST_ROWS = "300,200,100";
    const covered = await readXSearch("from:example -filter:replies", { lastId: "200", backlog: [], subject: "test", type: "Latest" });
    assert.equal(covered.coverageUnverified, true, "the browser cannot prove its coverage");
    assert.equal(covered.lastId, "300");
    // The oldest post is still newer than the watermark: posts may be missing between, so it stays.
    process.env.X_OPENCLI_TEST_ROWS = "400,300";
    const uncovered = await readXSearch("from:example -filter:replies", { lastId: "200", backlog: [], subject: "test", type: "Latest" });
    assert.equal(uncovered.lastId, "200");
    // A first read has no stretch to miss, so the watermark starts at the newest post.
    process.env.X_OPENCLI_TEST_ROWS = "500,400";
    const first = await readXSearch("from:example -filter:replies", { lastId: null, backlog: [], subject: "test", type: "Latest" });
    assert.equal(first.lastId, "500");
  } finally {
    if (previousBin === undefined) delete process.env.OPENCLI_BIN;
    else process.env.OPENCLI_BIN = previousBin;
    if (previousRows === undefined) delete process.env.X_OPENCLI_TEST_ROWS;
    else process.env.X_OPENCLI_TEST_ROWS = previousRows;
    if (previousKey === undefined) delete process.env.SOCIALDATA_API_KEY;
    else process.env.SOCIALDATA_API_KEY = previousKey;
    rmSync(dir, { recursive: true, force: true });
  }
});
