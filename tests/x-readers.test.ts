// The X sources are read in the browser session the user is signed into: BrowserMCP's own X adapter
// through the host's bridge, or Kaze's own browser over MCP. Both share one session quota.
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { adapterRowToTweet, searchTweetsInBrowserMcp } from "../packages/backend/src/providers/x-adapter.ts";
import { BROWSER_X_SEARCHES_PER_HOUR, browserXQuota, resetBrowserXSession } from "../packages/backend/src/providers/x-quota.ts";
import { readXSearch } from "../packages/backend/src/sources/x.ts";

/** A bridge that answers every search with the rows it was told to answer. */
async function bridgeAnswering(answer: (request: { source: string; query: string; limit: number }) => unknown): Promise<{ socketPath: string; close: () => Promise<void>; requests: Array<{ source: string; query: string; limit: number }> }> {
  const dir = mkdtempSync(path.join(tmpdir(), "aihot-x-browsermcp-"));
  const socketPath = path.join(dir, "bridge.sock");
  const requests: Array<{ source: string; query: string; limit: number }> = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      const request = JSON.parse(String(chunk).trim());
      requests.push(request);
      socket.end(JSON.stringify(answer(request)) + "\n");
    });
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(socketPath, resolve);
  await promise;
  return {
    socketPath,
    requests,
    close: () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      server.close(() => { rmSync(dir, { recursive: true, force: true }); resolve(); });
      return promise;
    },
  };
}

/** A row as BrowserMCP's X adapter returns it. */
const row = (id: string) => ({
  id,
  author: "example",
  name: "Example",
  text: `post ${id}`,
  created_at: "Fri Nov 06 20:22:10 +0000 2026",
  links: [],
});

test("the X search asks the bridge for one query and reads the rows it sends", async () => {
  const bridge = await bridgeAnswering(() => ({
    ok: true,
    rows: [{
      id: "2117719653078220972",
      author: "realDonaldTrump",
      name: "Donald J. Trump",
      text: "A post",
      created_at: "Tue Nov 03 20:44:45 +0000 2026",
      links: ["https://example.com/a"],
      media: ["https://pbs.twimg.com/media/one.jpg"],
    }],
  }));
  const previous = process.env.BROWSERMCP_BRIDGE_SOCKET;
  try {
    process.env.BROWSERMCP_BRIDGE_SOCKET = bridge.socketPath;
    resetBrowserXSession();
    const tweets = await searchTweetsInBrowserMcp({ query: "from:realDonaldTrump -filter:replies", limit: 5 });
    assert.deepEqual(bridge.requests, [{ source: "x-search", query: "from:realDonaldTrump -filter:replies", limit: 5 }]);
    assert.equal(tweets.length, 1);
    assert.equal(tweets[0].id_str, "2117719653078220972");
    assert.equal(tweets[0].user.screen_name, "realDonaldTrump");
    assert.equal(tweets[0].entities?.media?.[0]?.type, "photo");
  } finally {
    if (previous === undefined) delete process.env.BROWSERMCP_BRIDGE_SOCKET;
    else process.env.BROWSERMCP_BRIDGE_SOCKET = previous;
    await bridge.close();
  }
});

test("a timeline with nothing in it is an empty answer, not a failed account", async () => {
  const bridge = await bridgeAnswering(() => ({ ok: false, reason: "Timed out waiting for the X search page to load more results" }));
  const previous = process.env.BROWSERMCP_BRIDGE_SOCKET;
  try {
    process.env.BROWSERMCP_BRIDGE_SOCKET = bridge.socketPath;
    resetBrowserXSession();
    const tweets = await searchTweetsInBrowserMcp({ query: "from:quiet -filter:replies", limit: 5 });
    assert.deepEqual(tweets, [], "an account with no new posts answers with nothing");
  } finally {
    if (previous === undefined) delete process.env.BROWSERMCP_BRIDGE_SOCKET;
    else process.env.BROWSERMCP_BRIDGE_SOCKET = previous;
    resetBrowserXSession();
    await bridge.close();
  }
});

test("a refusal by X rests the session instead of failing the account", async () => {
  const bridge = await bridgeAnswering(() => ({ ok: false, reason: "HTTP 429: rate-limited by Twitter (session quota)" }));
  const previous = process.env.BROWSERMCP_BRIDGE_SOCKET;
  try {
    process.env.BROWSERMCP_BRIDGE_SOCKET = bridge.socketPath;
    resetBrowserXSession();
    await assert.rejects(() => searchTweetsInBrowserMcp({ query: "from:example", limit: 5 }), (error: Error) => {
      assert.match(error.message, /rate-limited/);
      return true;
    });
    // The session rests now: the next search waits instead of spending the quota again.
    await assert.rejects(() => searchTweetsInBrowserMcp({ query: "from:example", limit: 5 }), (error: Error) => {
      assert.match(error.message, /rests until/);
      return true;
    });
  } finally {
    if (previous === undefined) delete process.env.BROWSERMCP_BRIDGE_SOCKET;
    else process.env.BROWSERMCP_BRIDGE_SOCKET = previous;
    resetBrowserXSession();
    await bridge.close();
  }
});

test("the session's budget is counted in searches an hour, and a refusal rests it", () => {
  resetBrowserXSession();
  const quota = browserXQuota();
  assert.ok(quota.remaining <= BROWSER_X_SEARCHES_PER_HOUR, "the session has a budget of searches an hour");
  assert.equal(quota.cooldownUntil, 0, "a session that was not refused may search");
});

test("the browser read moves the watermark only when it covered the stretch since it", async () => {
  let ids = ["300", "200", "100"];
  const bridge = await bridgeAnswering(() => ({ ok: true, rows: ids.map(row) }));
  const previousSocket = process.env.BROWSERMCP_BRIDGE_SOCKET;
  const previousKey = process.env.SOCIALDATA_API_KEY;
  try {
    process.env.BROWSERMCP_BRIDGE_SOCKET = bridge.socketPath;
    delete process.env.SOCIALDATA_API_KEY;
    resetBrowserXSession();
    // The newest post is 300, the oldest 100: the stretch since the watermark 200 was read, so the
    // watermark moves to the newest post.
    const covered = await readXSearch("from:example -filter:replies", { lastId: "200", backlog: [], subject: "test", type: "Latest" });
    assert.equal(covered.coverageUnverified, true, "the browser cannot prove its coverage");
    assert.equal(covered.lastId, "300");
    // The oldest post is still newer than the watermark: posts may be missing between, so it stays.
    ids = ["400", "300"];
    const uncovered = await readXSearch("from:example -filter:replies", { lastId: "200", backlog: [], subject: "test", type: "Latest" });
    assert.equal(uncovered.lastId, "200");
    // A first read has no stretch to miss, so the watermark starts at the newest post.
    ids = ["500", "400"];
    const first = await readXSearch("from:example -filter:replies", { lastId: null, backlog: [], subject: "test", type: "Latest" });
    assert.equal(first.lastId, "500");
  } finally {
    if (previousSocket === undefined) delete process.env.BROWSERMCP_BRIDGE_SOCKET;
    else process.env.BROWSERMCP_BRIDGE_SOCKET = previousSocket;
    if (previousKey === undefined) delete process.env.SOCIALDATA_API_KEY;
    else process.env.SOCIALDATA_API_KEY = previousKey;
    resetBrowserXSession();
    await bridge.close();
  }
});

test("BrowserMCP's X adapter rows map to the tweets the collector reads", () => {
  const tweet = adapterRowToTweet({
    id: "1794017562484524803",
    author: "Example",
    name: "Example",
    text: "A post",
    created_at: "Fri Nov 06 20:22:10 +0000 2026",
    links: ["https://example.com/a"],
    media: ["https://pbs.twimg.com/media/one.jpg"],
  });
  assert.equal(tweet.id_str, "1794017562484524803");
  assert.equal(tweet.user.screen_name, "Example");
  assert.equal(tweet.user.name, "Example");
  assert.equal(tweet.full_text, "A post");
  assert.equal(tweet.entities?.media?.[0]?.type, "photo");
  assert.equal(tweet.entities?.urls?.[0]?.expanded_url, "https://example.com/a");
  // A video's own file is kept as the file; the site shows its still and never pretends it plays here.
  const video = adapterRowToTweet({ id: "2", author: "example", text: "clip", created_at: "Fri Nov 06 20:22:10 +0000 2026", media: ["https://video.twimg.com/clip.mp4"] });
  assert.equal(video.entities?.media?.[0]?.type, "video");
  // A retweet is carried as one, so the collector drops it.
  const retweet = adapterRowToTweet({ id: "3", author: "example", text: "RT @someone: a post", created_at: "Fri Nov 06 20:22:10 +0000 2026" });
  assert.ok(retweet.retweeted_status, "a retweet is marked so the collector drops it");
});
