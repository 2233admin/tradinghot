// BrowserMCP's X adapter: the collector reads one search through the host's bridge, in the
// browser session the user is signed into.
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { searchTweetsInBrowserMcp } from "../packages/backend/src/providers/x-adapter.ts";
import { resetBrowserXSession } from "../packages/backend/src/providers/x-quota.ts";

/** A bridge that answers one search with the rows it was told to answer. */
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
