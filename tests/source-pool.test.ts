// The public source pool names every enabled source the site may show, with its last collection
// outcome, and never an isolated source, an internal id, a feed address or an error.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../apps/api/src/app.ts";
import type { SourcePoolResponse } from "@aihot/contracts/site";

const app = await buildApp();
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

test("the public source pool shows each enabled source's health and hides operators' details", async () => {
  const T = tag();
  await sql`INSERT INTO sources (id, name, kind, health, tier, participation_mode, enabled, last_ok_at, last_error, fail_count, config) VALUES
    (${T + "-ok"}, ${"公开池正常"}, 'rss', 'ok', 'T1', 'editorial', true, now() - interval '2 hours', null, 0, '{}'),
    (${T + "-bad"}, ${"公开池失败（编辑部备注）"}, 'json_list', 'failing', 'T2', 'editorial', true, now() - interval '2 days',
      'HTTP 503: https://feed.example/secret', 6, '{"url":"https://feed.example/secret"}'),
    (${T + "-iso"}, ${"公开池隔离"}, 'rss', 'ok', 'T2', 'isolated', true, now(), null, 0, '{}'),
    (${T + "-off"}, ${"公开池停用"}, 'rss', 'paused', 'T2', 'editorial', false, now(), null, 0, '{}')`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${T + "-a1"}, ${T + "-ok"}, ${"pool-" + T}, 'https://example.com/pool-a1', '池内文章', now(), now())`;

  const res = await app.inject({ method: "GET", url: "/api/site/sources" });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers["cache-control"]), /max-age=60/);
  const body = res.json() as SourcePoolResponse;
  const byName = new Map(body.sources.map((s) => [s.name, s]));

  const ok = byName.get("公开池正常");
  assert.equal(ok?.kind, "rss");
  assert.equal(ok?.firstParty, true);
  assert.equal(ok?.status, "ok");
  assert.equal(ok?.items7d, 1);
  assert.ok(ok?.lastOkAt, "a source that collected has its last success time");
  const failing = byName.get("公开池失败");
  assert.equal(failing?.status, "failing");
  assert.equal(failing?.firstParty, false);
  assert.equal(byName.has("公开池隔离"), false, "an isolated source is never named publicly");
  assert.equal(byName.has("公开池停用"), false, "a paused source is not collected from");
  assert.ok(body.sources.findIndex((s) => s.status === "failing") < body.sources.findIndex((s) => s.status === "ok"), "failing sources come first");

  assert.equal(body.counts.total, body.sources.length);
  assert.equal(body.counts.failing, body.sources.filter((s) => s.status === "failing").length);
  const leaked = JSON.stringify(body);
  for (const secret of ["HTTP 503", "feed.example", T]) assert.equal(leaked.includes(secret), false, `the public pool must not carry ${secret}`);
  assert.deepEqual(Object.keys(body.sources[0]!).sort(), ["firstParty", "items7d", "kind", "lastOkAt", "name", "status"]);
});
