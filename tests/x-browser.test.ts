// The browser fallback turns opencli twitter rows into the SocialData shape the collector reads.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { browserRowsToTweets, searchTweetsInBrowser } from "../packages/backend/src/providers/x-browser.ts";
import { HttpStatusError } from "../packages/backend/src/lib/http-fetch.ts";

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
    const search = () => searchTweetsInBrowser({ query: "from:example -filter:replies", limit: 60 });
    const throttled = "HTTP 429: SearchTimeline fetch failed — rate-limited by Twitter (session quota); retry after cooldown (typically 15-30 min)";
    process.env.X_OPENCLI_TEST_ERROR = throttled;
    await assert.rejects(search(), (error: unknown) => {
      assert.ok(error instanceof HttpStatusError);
      assert.equal(error.status, 429);
      assert.equal(error.message, `opencli failed: ${throttled}`);
      return true;
    });

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
  } finally {
    if (previousBin === undefined) delete process.env.OPENCLI_BIN;
    else process.env.OPENCLI_BIN = previousBin;
    if (previousError === undefined) delete process.env.X_OPENCLI_TEST_ERROR;
    else process.env.X_OPENCLI_TEST_ERROR = previousError;
    rmSync(dir, { recursive: true, force: true });
  }
});
