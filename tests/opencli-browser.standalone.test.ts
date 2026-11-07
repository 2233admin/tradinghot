// A site that only answers its own logged-in browser (雪球) is read through opencli: open the URL as a
// tab, then read the page text. The browser bridge needs a profile when several are connected.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { browserJson } from "@aihot/backend/providers/browser";

const dir = mkdtempSync(path.join(tmpdir(), "aihot-opencli-"));
const log = path.join(dir, "calls.log");
const fixture = path.join(dir, "opencli.mjs");
writeFileSync(fixture, `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + "\\n");
if (args.includes("eval")) process.stdout.write('{"items":[{"id":1}]}');
`);
const previous = { bin: process.env.OPENCLI_BIN, profile: process.env.OPENCLI_PROFILE, log: process.env.FIXTURE_LOG };
process.env.OPENCLI_BIN = fixture;
process.env.OPENCLI_PROFILE = "bridge-a";
process.env.FIXTURE_LOG = log;
after(() => {
  for (const [key, value] of [["OPENCLI_BIN", previous.bin], ["OPENCLI_PROFILE", previous.profile], ["FIXTURE_LOG", previous.log]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("a JSON endpoint is opened as a tab and its page text is the response body", async () => {
  writeFileSync(log, "");
  const body = await browserJson("https://xueqiu.com/statuses/hot/listV2.json?size=20", { session: "cn-xueqiu-hot" });
  assert.equal(body, '{"items":[{"id":1}]}');
  const calls = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.deepEqual(calls[0], ["--profile", "bridge-a", "browser", "cn-xueqiu-hot", "open", "https://xueqiu.com/statuses/hot/listV2.json?size=20", "--window", "background"]);
  assert.deepEqual(calls[1], ["--profile", "bridge-a", "browser", "cn-xueqiu-hot", "eval", "document.body.innerText"]);
});

// A source id names the session, so two polls never drive the same tab; unknown characters are replaced.
test("a source id becomes a safe session name", async () => {
  writeFileSync(log, "");
  await browserJson("https://example.org/api.json", { session: "my source/id" });
  const [first] = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
  assert.equal(first![3], "my-source-id");
});

test("an empty page is a fetch failure, not an empty listing", async () => {
  const quiet = path.join(dir, "quiet.mjs");
  writeFileSync(quiet, "");
  process.env.OPENCLI_BIN = quiet;
  await assert.rejects(browserJson("https://example.org/api.json", { session: "quiet" }), /browser page is empty/);
  process.env.OPENCLI_BIN = fixture;
});
