// Cleans the selected reports that have not been written by a web AI yet: one article per request,
// in the site's current editorial strategy (admin → 信源 → 筛选与写作 → 网页 AI 清洗).
// Usage: node --env-file=.env scripts/webai-clean.ts [--limit 20]
import { closeDb, sql } from "@aihot/backend/db";
import { processArticle } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";

const limit = Math.min(200, Math.max(1, Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 20));
const rows = await sql<{ article_id: string; title: string }[]>`
  SELECT p.article_id, p.title
  FROM publications p
  JOIN LATERAL (
    SELECT a.output FROM analyses a WHERE a.article_id = p.article_id ORDER BY a.id DESC LIMIT 1
  ) last ON true
  WHERE p.selected AND p.visibility = 'public'
    AND coalesce(last.output->>'writerModel', '') NOT LIKE 'webai:%'
  ORDER BY p.timeline_at DESC, p.article_id
  LIMIT ${limit}`;
console.log(JSON.stringify({ queued: rows.length, limit }));
let cleaned = 0;
let failed = 0;
for (const row of rows) {
  const started = Date.now();
  const result = await processArticle(row.article_id);
  if (result.state === "pass") cleaned += 1;
  else failed += 1;
  console.log(JSON.stringify({ article: row.article_id, state: result.state, seconds: Math.round((Date.now() - started) / 1000), title: row.title.slice(0, 40) }));
}
console.log(JSON.stringify({ cleaned, failed }));
await stopBoss();
await closeDb();
