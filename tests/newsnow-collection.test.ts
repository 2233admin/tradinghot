import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { stub } from "./setup.ts";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { newsnowSources } from "../modules/newsnow/registry.ts";

const now = new Date().toISOString();
const upstream = await stub((_hit, request) => {
  const id = new URL(request.url, "http://localhost").searchParams.get("id")!;
  if (id === "weibo") return { id, status: "error", refreshedAt: null, items: [], error: "source unavailable" };
  if (id === "baidu") return { id, status: "success", refreshedAt: now, items: [] };
  return {
    id, status: "success", refreshedAt: now,
    items: [{ id, title: `报道 ${id}`, url: `https://example.com/news/${id}`, publishedAt: id === "zhihu" ? null : now }],
  };
});
const previous = process.env.NEWSNOW_BASE_URL;
process.env.NEWSNOW_BASE_URL = upstream.url;
// The client captures its service address at module load, after the isolated stub has a port.
const { collectNewsnow } = await import("../modules/newsnow/bridge.ts");
after(async () => {
  if (previous === undefined) delete process.env.NEWSNOW_BASE_URL;
  else process.env.NEWSNOW_BASE_URL = previous;
  await upstream.close();
  await stopBoss();
  await closeDb();
});

test("all upstream sources are collected; empty and failed sources have truthful health", async () => {
  const result = await collectNewsnow();
  assert.equal(result.read, newsnowSources().length);
  assert.equal(result.failed, 1);
  assert.equal(result.stored, newsnowSources().length - 2);
  const [empty] = await sql`SELECT health,last_fetch_at,last_ok_at FROM sources WHERE id='newsnow-baidu'`;
  assert.equal(empty!.health, "ok");
  assert.ok(empty!.last_fetch_at && empty!.last_ok_at);
  const [failed] = await sql`SELECT health,last_fetch_at,last_ok_at,last_error FROM sources WHERE id='newsnow-weibo'`;
  assert.equal(failed!.health, "degraded");
  assert.ok(failed!.last_fetch_at);
  assert.equal(failed!.last_ok_at, null);
  assert.equal(failed!.last_error, "source unavailable");
  const [hot] = await sql`SELECT s.participation_mode,a.published_at FROM sources s JOIN articles a ON a.source_id=s.id WHERE s.id='newsnow-zhihu'`;
  assert.equal(hot!.participation_mode, "hot_signal");
  assert.equal(hot!.published_at, null);
});
