// A site that only answers its own browser (雪球, a WAF-protected ministry) is read through opencli:
// open the URL as a tab, wait for the page to have text, then read the expression asked for.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { browserHtml, browserJson } from "@aihot/backend/providers/browser";
import { runOpenCli } from "@aihot/backend/providers/opencli";
import { searchTweetsInBrowser } from "@aihot/backend/providers/x-browser";

const dir = mkdtempSync(path.join(tmpdir(), "aihot-opencli-"));
const log = path.join(dir, "calls.log");
const fixture = path.join(dir, "opencli.mjs");
// Answers the readiness probe with a page, and any other expression with that expression's name.
writeFileSync(fixture, `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + "\\n");
const expr = args[args.indexOf("eval") + 1];
if (expr === "document.body.innerText") process.stdout.write(process.env.FIXTURE_TEXT ?? "正文");
else process.stdout.write("<html>" + expr + "</html>");
`);
const previous = { bin: process.env.OPENCLI_BIN, profile: process.env.OPENCLI_PROFILE, log: process.env.FIXTURE_LOG, text: process.env.FIXTURE_TEXT };
process.env.OPENCLI_BIN = fixture;
process.env.OPENCLI_PROFILE = "bridge-a";
process.env.FIXTURE_LOG = log;
after(() => {
  for (const [key, value] of [["OPENCLI_BIN", previous.bin], ["OPENCLI_PROFILE", previous.profile], ["FIXTURE_LOG", previous.log], ["FIXTURE_TEXT", previous.text]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);

test("a JSON endpoint is opened as a tab and its page text is the response body", async () => {
  writeFileSync(log, "");
  process.env.FIXTURE_TEXT = '{"items":[{"id":1}]}';
  const body = await browserJson("https://xueqiu.com/statuses/hot/listV2.json?size=20", { session: "cn-xueqiu-hot" });
  assert.equal(body, '{"items":[{"id":1}]}');
  assert.deepEqual(calls(), [
    ["--profile", "bridge-a", "browser", "cn-xueqiu-hot", "open", "https://xueqiu.com/statuses/hot/listV2.json?size=20", "--window", "background"],
    ["--profile", "bridge-a", "browser", "cn-xueqiu-hot", "eval", "document.body.innerText"],
  ]);
});

test("an HTML listing is read as markup once the page has text", async () => {
  writeFileSync(log, "");
  process.env.FIXTURE_TEXT = "海关总署";
  const html = await browserHtml("http://www.customs.gov.cn/", { session: "cn-gacc-news" });
  assert.equal(html, "<html>document.documentElement.outerHTML</html>");
  assert.deepEqual(calls().map((c) => c[4]), ["open", "eval", "eval"]);
  // A challenge's first paint has no text: the tab is asked again before the markup is taken.
  process.env.FIXTURE_TEXT = "";
  writeFileSync(log, "");
  const quiet = path.join(dir, "quiet-html.mjs");
  writeFileSync(quiet, readFileSync(fixture));
  process.env.OPENCLI_BIN = quiet;
  await assert.rejects(browserHtml("http://example.org/list", { session: "s1", readyAttempts: 2, readyPauseMs: 0 }), /browser page is empty/);
  assert.equal(calls().filter((c) => c[4] === "eval").length, 2);
  process.env.OPENCLI_BIN = fixture;
  process.env.FIXTURE_TEXT = "正文";
});

test("a body read closes its own tab", async () => {
  writeFileSync(log, "");
  process.env.FIXTURE_TEXT = "页面";
  await browserHtml("http://example.org/article", { session: "article-abc", closeAfter: true });
  assert.deepEqual(calls().map((c) => c[4]), ["open", "eval", "eval", "close"]);
});

// A source id names the session, so two polls never drive the same tab; unknown characters are replaced.
test("a source id becomes a safe session name", async () => {
  writeFileSync(log, "");
  process.env.FIXTURE_TEXT = "正文";
  await browserJson("https://example.org/api.json", { session: "my source/id" });
  assert.equal(calls()[0]![3], "my-source-id");
});

test("two X searches overlap, while a third and a queued exclusive command retain their order after failures", async () => {
  const gateDir = mkdtempSync(path.join(tmpdir(), "aihot-opencli-queue-"));
  const eventLog = path.join(gateDir, "events.log");
  const controlledCli = path.join(gateDir, "controlled-opencli.mjs");
  writeFileSync(eventLog, "");
  writeFileSync(controlledCli, `
import { appendFileSync, existsSync, readFileSync, watch } from "node:fs";
const args = process.argv.slice(2);
const search = args.indexOf("search");
const id = search < 0 ? "exclusive" : args[search + 1];
const gate = new URL(id + ".gate", import.meta.url);
const log = (kind) => appendFileSync(new URL("events.log", import.meta.url), JSON.stringify({ kind, id }) + "\\n");
log("start");
const ready = Promise.withResolvers();
const watcher = watch(new URL(".", import.meta.url), () => { if (existsSync(gate)) ready.resolve(); });
try {
  if (!existsSync(gate)) await ready.promise;
} finally {
  watcher.close();
}
const outcome = readFileSync(gate, "utf8");
log("end");
if (outcome === "fail") {
  process.stderr.write("fixture failure: " + id);
  process.exitCode = 1;
} else {
  process.stdout.write("[]");
}
`);
  const previousBin = process.env.OPENCLI_BIN;
  const events = () => readFileSync(eventLog, "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: "start" | "end"; id: string });
  const waitForStart = async (id: string) => {
    const started = Promise.withResolvers<void>();
    const hasStarted = () => events().some((event) => event.kind === "start" && event.id === id);
    const watcher = watch(eventLog, () => { if (hasStarted()) started.resolve(); });
    // Deadlock guard only; command ordering is controlled by file-watch signals.
    const deadline = setTimeout(() => started.reject(new Error(`timed out waiting for ${id} to start`)), 15_000);
    try {
      if (!hasStarted()) await started.promise;
    } finally {
      clearTimeout(deadline);
      watcher.close();
    }
  };
  const release = (id: string, outcome = "ok") => {
    const gate = path.join(gateDir, `${id}.gate`);
    if (existsSync(gate)) return;
    const pending = path.join(gateDir, `${id}.pending`);
    writeFileSync(pending, outcome);
    renameSync(pending, gate);
  };
  // Handle rejection immediately: failures can occur before the test reaches their assertions.
  const settled = (job: Promise<unknown>) => job.then(() => undefined, (error: unknown) => error);
  const jobs: Promise<unknown>[] = [];
  try {
    process.env.OPENCLI_BIN = controlledCli;
    const search = (id: string) => settled(searchTweetsInBrowser({ query: id, limit: 1, profile: "fixture", timeoutMs: 30_000 }));
    const x1 = search("x1"); jobs.push(x1);
    const x2 = search("x2"); jobs.push(x2);
    const x3 = search("x3"); jobs.push(x3);
    const exclusive = settled(runOpenCli(["fixture", "exclusive"], 30_000)); jobs.push(exclusive);
    const x4 = search("x4"); jobs.push(x4);

    await Promise.all([waitForStart("x1"), waitForStart("x2")]);
    release("x1", "fail");
    assert.match((await x1 as Error).message, /fixture failure: x1/);
    await waitForStart("x3"); // x2 remains gated, so x3 must overlap it.
    release("x2");
    release("x3");
    assert.equal(await x2, undefined);
    assert.equal(await x3, undefined);
    await waitForStart("exclusive");
    release("exclusive", "fail");
    assert.match((await exclusive as Error).message, /fixture failure: exclusive/);
    await waitForStart("x4");
    release("x4");
    assert.equal(await x4, undefined);

    const trace = events();
    const position = (kind: "start" | "end", id: string) => trace.findIndex((event) => event.kind === kind && event.id === id);
    assert.equal(trace.length, 10, "each command starts and ends once");
    for (const id of ["x1", "x2", "x3", "exclusive", "x4"]) {
      assert.equal(trace.filter((event) => event.kind === "start" && event.id === id).length, 1);
      assert.equal(trace.filter((event) => event.kind === "end" && event.id === id).length, 1);
    }
    assert.ok(Math.max(position("start", "x1"), position("start", "x2")) < position("end", "x1"),
      "both initial searches start before the first can finish");
    assert.ok(position("end", "x1") < position("start", "x3") && position("start", "x3") < position("end", "x2"),
      "the third starts only after one slot is released, while the second remains active");
    assert.ok(Math.max(position("end", "x2"), position("end", "x3")) < position("start", "exclusive"),
      "the queued non-X command waits for both searches");
    assert.ok(position("end", "exclusive") < position("start", "x4"),
      "the later X search cannot overtake the exclusive command, even when it fails");
  } finally {
    for (const id of ["x1", "x2", "x3", "exclusive", "x4"]) release(id);
    await Promise.all(jobs);
    if (previousBin === undefined) delete process.env.OPENCLI_BIN;
    else process.env.OPENCLI_BIN = previousBin;
    rmSync(gateDir, { recursive: true, force: true });
  }
});
