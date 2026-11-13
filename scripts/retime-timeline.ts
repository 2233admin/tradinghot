// Moves the timeline of the material already collected onto the source's own publication time.
//   node --env-file=.env scripts/retime-timeline.ts          report what would change
//   node --env-file-if-exists=.env scripts/retime-timeline.ts --apply   make the change
//
// The timeline reads by a source's own time (packages/backend/src/content/materials.ts decideTimeline).
// Material collected before that rule still carries the time it was found at, and the published rows
// that carry it keep their old place; this script puts both back onto the source's time. Grouped material
// (a member of an event) keeps the place its event has, so only standalone rows are moved.
import { closeDb, sql } from "@aihot/backend/db";

const apply = process.argv.includes("--apply");

async function run(): Promise<unknown> {
  const articles = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM articles
    WHERE published_at IS NOT NULL AND timeline_at IS DISTINCT FROM published_at`;
  const publications = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM publications
    WHERE published_at IS NOT NULL AND timeline_at IS DISTINCT FROM published_at`;
  const sorted = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM publications
    WHERE fact_id IS NULL AND timeline_at IS NOT NULL AND sort_at IS DISTINCT FROM timeline_at`;
  const plan = {
    mode: apply ? "apply" : "report",
    articles: articles[0]!.n,
    publications: publications[0]!.n,
    order: sorted[0]!.n,
  };
  if (!apply) return plan;
  const moved = await sql.begin(async (tx) => {
    const a = await tx`UPDATE articles SET timeline_at = published_at
                      WHERE published_at IS NOT NULL AND timeline_at IS DISTINCT FROM published_at`;
    const p = await tx`UPDATE publications SET timeline_at = published_at
                      WHERE published_at IS NOT NULL AND timeline_at IS DISTINCT FROM published_at`;
    const s = await tx`UPDATE publications SET sort_at = timeline_at
                      WHERE fact_id IS NULL AND timeline_at IS NOT NULL AND sort_at IS DISTINCT FROM timeline_at`;
    return { articles: a.count, publications: p.count, order: s.count };
  });
  return { ...plan, moved };
}

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeDb();
}
