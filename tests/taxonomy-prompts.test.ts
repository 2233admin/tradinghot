// The prompts and the taxonomy must agree: analyze.ts parses itemType with a strict enum (no .catch), and
// the prompts carry hand-copied lists of types and tags. A vocabulary change that misses one copy fails a
// whole step per article at run time, so the copies are compared here instead.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { PUBLIC_API_CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import { CATEGORIES, ENTITY_TAGS, ITEM_TYPES, TOPIC_TAGS } from "@aihot/industry/taxonomy";

const dir = path.join(import.meta.dirname, "..", "industry", "prompts");
const prompt = (name: string) => readFile(path.join(dir, name), "utf8");

/** One heading's text, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `the prompt has a "${heading}" section`);
  const next = markdown.indexOf("\n## ", start + 3);
  return markdown.slice(start, next === -1 ? undefined : next);
}

/** The backticked ids the prompt lists one per line, e.g. "- `market_move`：…". */
function itemTypes(markdown: string, heading: string): string[] {
  return [...section(markdown, heading).matchAll(/^- `([a-z_]+)`：/gm)].map((m) => m[1]!).sort();
}

/** "A股、港股、…" after a leading label, split into its terms. */
function listed(markdown: string, label: string): string[] {
  const line = markdown.split("\n").find((l) => l.startsWith(`- ${label}：`));
  assert.ok(line, `the prompt lists ${label}`);
  return line.slice(`- ${label}：`.length).split("、").map((t) => t.trim()).sort();
}

test("the writing prompt lists exactly the taxonomy's item types", async () => {
  assert.deepEqual(itemTypes(await prompt("content-understanding.md"), "内容类型"), [...ITEM_TYPES].sort());
});

test("the scoring prompt lists exactly the taxonomy's item types", async () => {
  assert.deepEqual(itemTypes(await prompt("selection-score.md"), "一、识别事件与内容类型"), [...ITEM_TYPES].sort());
});

test("the tag whitelists in the writing prompt are the taxonomy's tags", async () => {
  const markdown = await prompt("content-understanding.md");
  assert.deepEqual(listed(markdown, "主题"), [...TOPIC_TAGS].sort());
  assert.deepEqual(listed(markdown, "实体"), [...ENTITY_TAGS].sort());
});

test("the scoring weights cover every item type with ten points each", async () => {
  const rows = [...(await prompt("selection-score.md")).matchAll(/^\| ([a-z_]+) \| (\d) \| (\d) \| (\d) \| (\d) \| (\d) \|$/gm)];
  assert.deepEqual(rows.map((r) => r[1]!).sort(), [...ITEM_TYPES].sort());
  for (const row of rows) {
    const sum = row.slice(2, 7).reduce((n, cell) => n + Number(cell), 0);
    assert.equal(sum, 10, `${row[1]} weights add up to ten`);
  }
});

test("public category keys are an ordered subset of the taxonomy's", () => {
  const keys = CATEGORIES.map((c) => c.key);
  const publicKeys = [...PUBLIC_API_CATEGORY_KEYS];
  assert.equal(new Set(publicKeys).size, publicKeys.length, "no duplicates");
  let at = 0;
  for (const key of publicKeys) {
    at = keys.indexOf(key, at);
    assert.ok(at >= 0, `${key} is a category key, in the same order`);
    at += 1;
  }
  assert.equal(new Set(keys).size, keys.length, "category keys are unique");
});

test("every category has a guide and a section", () => {
  for (const category of CATEGORIES) {
    assert.ok(category.guide.length > 20, `${category.key} explains what it collects`);
    assert.ok(category.section.length > 0, `${category.key} names its section`);
  }
});
