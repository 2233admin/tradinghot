// A site that only answers its own browser (雪球, a WAF-protected ministry) is read through opencli:
// open the URL as a tab, wait for the page to have text, then read the expression asked for.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { browserHtml, browserJson } from "@aihot/backend/providers/browser";

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
