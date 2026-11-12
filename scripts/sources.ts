// The sources from a terminal, for a person or an agent; every command answers with one JSON document.
//   node --env-file=.env scripts/sources.ts list                      every source and how it is doing
//   node --env-file=.env scripts/sources.ts check <网址>              what a watchlist line with this address would become (nothing is saved)
//   node --env-file=.env scripts/sources.ts add <watchlist 的一行>     follow it now, and note the line in industry/watchlist.txt
//   node --env-file=.env scripts/sources.ts sync                      import new watchlist lines, repair discovered sources that broke
//   node --env-file=.env scripts/sources.ts pause|resume <id>
//   node --env-file=.env scripts/sources.ts fetch <id>                read it once now
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { updateSource } from "@aihot/backend/admin/sources";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { collectSource } from "@aihot/backend/sources/collect";
import { discoverSource } from "@aihot/backend/sources/discover";
import { maintainWatchlist, parseWatchlist, syncWatchlist } from "@aihot/backend/sources/watchlist";
import { SERVER_MODULES } from "@aihot/site/modules/server";

const USAGE = "用法：sources.ts list | check <网址> | add <watchlist 的一行> | sync | pause <id> | resume <id> | fetch <id>";
const [command, ...args] = process.argv.slice(2);
const need = (what: string) => {
  if (!args[0]) throw new Error(`缺少${what}。${USAGE}`);
  return args.join(" ");
};

async function run(): Promise<unknown> {
  if (command === "list") {
    return sql`SELECT id, name, kind, enabled, participation_mode, interval_minutes, fail_count, last_error, last_fetch_at,
                      coalesce(config->>'feedUrl', config->>'url', config->>'query') AS reads, config->'_aihot'->>'watch' AS watch
               FROM sources ORDER BY id`;
  }
  if (command === "check") return discoverSource(need("网址"));
  if (command === "add") {
    const line = need(" watchlist 的一行");
    const [entry] = parseWatchlist(line);
    if (!entry) throw new Error("这一行是空的或是注释");
    const result = await syncWatchlist(line);
    // The line is kept with the others when the file can be written (not inside a built image); the source is stored either way.
    const file = path.join(REPO_ROOT, "industry/watchlist.txt");
    let noted = false;
    if (result.added.length && existsSync(file) && !readFileSync(file, "utf8").split(/\r?\n/).includes(line)) {
      try { appendFileSync(file, `${readFileSync(file, "utf8").endsWith("\n") ? "" : "\n"}${line}\n`); noted = true; } catch { /* read-only checkout */ }
    }
    return { id: entry.id, ...result, alreadyFollowed: !result.added.length && !result.failed.length, noted };
  }
  if (command === "sync") return maintainWatchlist();
  if (command === "pause" || command === "resume") {
    const id = need("信源 id");
    const [row] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM sources WHERE id = ${id}`;
    if (!row) throw new Error(`没有这个信源：${id}`);
    await updateSource(id, { patch: { enabled: command === "resume" }, version: row.updated_at.toISOString(), reason: "scripts/sources.ts" }, "cli");
    return { id, enabled: command === "resume" };
  }
  if (command === "fetch") {
    installModules(SERVER_MODULES);
    return collectSource(need("信源 id"), { force: true });
  }
  throw new Error(USAGE);
}

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await stopBoss();
  await closeDb();
}
