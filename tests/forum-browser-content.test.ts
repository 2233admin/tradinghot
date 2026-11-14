import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { extractArticleBody } from "@aihot/backend/content/extract";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { processExtraction, sweepUnprocessed } from "@aihot/backend/jobs/content";
import { QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadPool } from "@aihot/backend/publication/pool";

const dir = mkdtempSync(path.join(os.tmpdir(), "forum-reader-"));
const socketPath = path.join(dir, "bridge.sock");
const previousSocket = process.env.BROWSERMCP_BRIDGE_SOCKET;
process.env.BROWSERMCP_BRIDGE_SOCKET = socketPath;
let available = true;
const reader = net.createServer(socket => {
  socket.setEncoding("utf8");
  let input = "";
  socket.on("data", chunk => {
    input += chunk;
    if (!input.includes("\n")) return;
    const request = JSON.parse(input);
    const body = request.url.includes("1001") ? "真实较新观点" : "真实较早观点";
    socket.end(JSON.stringify(available
      ? { ok: true, url: request.url, html: `<div><p>${body}</p><script>广告脚本</script></div>`, date: "2026-11-14 06:08:05" }
      : { ok: false, code: "unavailable" }) + "\n");
  });
});
const listening = once(reader, "listening");
reader.listen(socketPath);
await listening;
after(async () => {
  const closed = once(reader, "close");
  reader.close();
  await closed;
  if (previousSocket === undefined) delete process.env.BROWSERMCP_BRIDGE_SOCKET;
  else process.env.BROWSERMCP_BRIDGE_SOCKET = previousSocket;
  await stopBoss();
  await closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const source = `forum-fixture-${tag()}`;
const now = Date.now();
const make = async (id: string, title: string, publishedAt: Date, discoveredAt: Date) => upsertMaterial({
  sourceId: source, url: `https://guba.eastmoney.com/news,600392,${id}.html`, title,
  publishedAt, discoveredAt, bodyStatus: "pending", via: "fetch",
});

await sql`INSERT INTO sources (id, name, kind, participation_mode, config)
  VALUES (${source}, 'Forum fixture', 'web_list', 'editorial', ${sql.json({ channel: "forum", bodyVia: "browsermcp" })})`;

test("a disconnected browser defers a post without losing it and later recovers", async () => {
  const { articleId } = await make("1001", "真实较新观点", new Date(now - 60_000), new Date(now));
  available = false;
  assert.deepEqual(await processExtraction({ articleId }), { state: "waiting" });
  const [waiting] = await sql`SELECT body_status,processing_state,processing_attempts,processing_retry_at FROM articles WHERE id=${articleId}`;
  assert.equal(waiting!.body_status, "pending");
  assert.equal(waiting!.processing_state, "new");
  assert.equal(waiting!.processing_attempts, 0);
  assert.ok(waiting!.processing_retry_at);
  await sql`UPDATE articles SET processing_retry_at=now()-interval '1 minute',created_at=now()-interval '10 minutes' WHERE id=${articleId}`;
  assert.equal((await sweepUnprocessed()).enqueued, 1);
  const [job] = await sql`SELECT name FROM pgboss.job WHERE data->>'articleId'=${articleId} AND state<'completed'`;
  assert.equal(job!.name, QUEUES.extractBrowserBody);
  available = true;
  assert.deepEqual(await processExtraction({ articleId }), { state: "ok" });
  const [row] = await sql`SELECT body_text,body_html,body_status FROM articles WHERE id=${articleId}`;
  assert.equal(row!.body_text, "真实较新观点");
  assert.equal(row!.body_status, "ok");
  assert.doesNotMatch(row!.body_html, /广告脚本|<script/i);
});

test("verified short posts appear by publication time without inventing a summary", async () => {
  const [newer] = await sql<{ id: string; revision: number }[]>`SELECT id,revision FROM articles WHERE source_id=${source} AND title='真实较新观点'`;
  const older = await make("1002", "真实较早观点", new Date(now - 120_000), new Date(now + 10_000));
  assert.equal(await extractArticleBody(older.articleId), "ok");
  for (const id of [newer!.id, older.articleId]) {
    const [article] = await sql<{ revision: number; title: string }[]>`SELECT revision,title FROM articles WHERE id=${id}`;
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,title_zh,summary_zh) VALUES
      (${id},${article!.revision},'rule','pass',${article!.title},'')`;
    await publishArticle(id);
  }
  const result = await loadPool({ channel: "forum", category: null, tag: null, now: new Date(now + 20_000) });
  assert.deepEqual(result.items.filter(item => [newer!.id, older.articleId].includes(item.id)).map(item => item.id), [newer!.id, older.articleId]);
  assert.ok(!result.items.find(item => item.id === newer!.id)?.summary);
  await sql`UPDATE articles SET body_text='被替换的正文' WHERE id=${newer!.id}`;
  await publishArticle(newer!.id);
  const [publication] = await sql`SELECT eligible FROM publications WHERE article_id=${newer!.id}`;
  assert.equal(publication!.eligible, false, "verification must not follow a changed body");
});
