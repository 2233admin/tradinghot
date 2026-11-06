// The browser fallback turns opencli twitter rows into the SocialData shape the collector reads.
import assert from "node:assert/strict";
import test from "node:test";
import { browserRowsToTweets } from "../packages/backend/src/providers/x-browser.ts";

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

test("a wrapped or broken opencli output yields no rows instead of throwing", () => {
  assert.deepEqual(browserRowsToTweets(JSON.stringify({ data: [] })), []);
  assert.deepEqual(browserRowsToTweets("not json"), []);
  assert.deepEqual(browserRowsToTweets(JSON.stringify([{ id: "1" }])), []);
});
