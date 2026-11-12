// industry/watchlist.txt against the database: a line is imported once, an address is stored as the source
// discovery worked out, and a discovered source whose reads keep failing follows its site to the new feed.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { repairWatched, syncWatchlist } from "@aihot/backend/sources/watchlist";

config.allowPrivateNetworkFetch = true;
const T = tag();
let feed = "old.xml";
const server = http.createServer((req, res) => {
  const page = req.url === `/${T}/`;
  const found = page || req.url === `/${T}/${feed}`;
  res.writeHead(found ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(!found ? "" : page
    ? `<html><head><link rel="alternate" type="application/rss+xml" href="/${T}/${feed}"></head><body></body></html>`
    : `<rss version="2.0"><channel><item><title>Markets close higher</title><link>${site}/${T}/1</link><pubDate>Wed, 23 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

after(async () => {
  await sql`DELETE FROM sources WHERE config->'_aihot'->>'watch' = ${`${site}/${T}/`} OR id = ${`x-wl${T}`.slice(0, 17)}`;
  server.close();
  await closeDb();
});

test("watchlist lines are imported once, and a discovered source that keeps failing is discovered again", async () => {
  const handle = `wl${T}`.slice(0, 15);
  const text = `${site}/${T}/ Example ${T} !fast\n@${handle}\n${site}/${T}/missing/\n`;
  const first = await syncWatchlist(text);
  assert.equal(first.added.length, 2);
  assert.deepEqual(first.failed.map((f) => f.line), [`${site}/${T}/missing/`], "a line that cannot be worked out is reported, the others are imported");
  assert.deepEqual((await syncWatchlist(text)).added, []);

  const stored = async () => (await sql<{ id: string; kind: string; name: string; config: Record<string, any>; fail_count: number }[]>`
    SELECT id, kind, name, config, fail_count FROM sources WHERE config->'_aihot'->>'watch' = ${`${site}/${T}/`}`)[0]!;
  const before = await stored();
  assert.deepEqual([before.kind, before.name, before.config], ["rss", `Example ${T}`, { feedUrl: `${site}/${T}/old.xml`, _aihot: { watch: `${site}/${T}/`, fast: true } }]);
  const [x] = await sql<{ config: { query: string } }[]>`SELECT config FROM sources WHERE id = ${`x-${handle}`}`;
  assert.equal(x!.config.query, `from:${handle} -filter:replies`);

  // A few failed reads are left alone; so is a failing source whose site still says the same.
  await sql`UPDATE sources SET fail_count = 5 WHERE id = ${before.id}`;
  assert.equal((await repairWatched()).repaired.includes(before.id), false);
  feed = "new.xml";
  await sql`UPDATE sources SET fail_count = 4 WHERE id = ${before.id}`;
  assert.equal((await repairWatched()).repaired.includes(before.id), false);
  await sql`UPDATE sources SET fail_count = 5, config = config || '{"denyCategories":["ads"]}' WHERE id = ${before.id}`;
  assert.equal((await repairWatched()).repaired.includes(before.id), true);
  const repaired = await stored();
  assert.deepEqual(repaired.config, { feedUrl: `${site}/${T}/new.xml`, denyCategories: ["ads"], _aihot: { watch: `${site}/${T}/`, fast: true } }, "settings added since are kept");
  const [log] = await sql<{ actor: string }[]>`SELECT actor FROM audit_log WHERE subject = ${`source:${before.id}`}`;
  assert.equal(log!.actor, "system");
});
