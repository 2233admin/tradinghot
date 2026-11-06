// The rule filter ported from OpenAlice's news query: source, keyword, symbol and lookback matching
// with no model call, and the site switching between it and the model scoring from settings.
import { pointModels, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { clearEditorialSettings } from "@aihot/backend/editorial/config";
import { matchSelectionRules } from "@aihot/backend/editorial/rules";
import { processArticle } from "@aihot/backend/jobs/content";

type MatchInput = Parameters<typeof matchSelectionRules>[0];
const T = tag();
const sourceId = `rules-${T}`;
const model = await stub(() => ({ choices: [{ message: { content: "{\"attentionScore\":95}" } }] }));
pointModels(model.url);

after(async () => {
  await stopBoss();
  await model.close();
  await closeDb();
});

const rules = {
  keywords: ["降息"], excludeKeywords: ["广告"], sources: [], excludeSources: [], symbols: [], lookbackHours: 24,
  category: null, tags: [],
};

const material = (changes: Partial<MatchInput> = {}): MatchInput => ({
  title: "美联储宣布降息", bodyText: "", excerpt: null, translationZh: null,
  publishedAt: new Date(), discoveredAt: new Date(), source: { id: "example", name: "Example" },
  ...changes,
});

test("the rule filter matches keywords, symbols, sources and the lookback window", () => {
  assert.deepEqual(matchSelectionRules(material(), rules), { selected: true, reason: "规则命中：关键词「降息」" });
  assert.equal(matchSelectionRules(material({ title: "无消息", bodyText: "" }), rules).selected, false);
  assert.equal(matchSelectionRules(material({ bodyText: "这是一条广告" }), rules).reason, "命中排除词「广告」");
  assert.equal(matchSelectionRules(material({ title: "BTC 突破 10 万美元" }), { ...rules, keywords: [], symbols: ["BTC"] }).selected, true);
  assert.equal(matchSelectionRules(material(), { ...rules, sources: ["other"] }).selected, false);
  assert.equal(matchSelectionRules(material({ source: { id: "other", name: "Other" } }), { ...rules, sources: ["other"] }).selected, true);
  assert.equal(matchSelectionRules(material({ publishedAt: new Date(Date.now() - 25 * 3600_000) }), rules).reason, "早于 24 小时");
  assert.equal(matchSelectionRules(material(), { ...rules, keywords: [] }).reason, "规则为空");
});

test("rules select and source writing publish with no model call", async () => {
  await sql`INSERT INTO settings (key, value) VALUES ('editorial.strategy', ${sql.json({
    selection: "rules", writing: "source",
    rules: { ...rules, category: "macro_data", tags: ["规则"] },
  } as never)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  clearEditorialSettings();
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${sourceId}, '规则信源', 'rss', 'T2', 'editorial')`;
  const hit = `${sourceId}-hit`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, published_at, discovered_at, timeline_at, body_text, body_status)
    VALUES (${hit}, ${sourceId}, ${`identity-${hit}`}, 'https://example.com/rules-hit', '美联储宣布降息', now() - interval '1 hour', now(), now(),
      '美联储宣布降息 25 个基点，市场反应积极。', 'ok')`;
  const miss = `${sourceId}-miss`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, body_text, body_status)
    VALUES (${miss}, ${sourceId}, ${`identity-${miss}`}, 'https://example.com/rules-miss', '公司发布新品', now(), now(), '与利率无关的内容。', 'ok')`;

  assert.equal((await processArticle(hit)).state, "pass");
  const [hitPub] = await sql<{ selected: boolean; eligible: boolean; title: string; summary: string; category: string; tags: string[]; score: number | null }[]>`
    SELECT selected, eligible, title, summary, category, tags, score FROM publications WHERE article_id = ${hit}`;
  assert.deepEqual(
    { selected: hitPub!.selected, eligible: hitPub!.eligible, title: hitPub!.title, category: hitPub!.category, score: hitPub!.score },
    { selected: true, eligible: true, title: "美联储宣布降息", category: "macro_data", score: null },
  );
  assert.match(hitPub!.summary, /25 个基点/);
  assert.ok(hitPub!.tags.includes("规则"));
  const [analysis] = await sql<{ origin: string; prompt_version: string | null; selected: boolean; output: { rule?: { reason?: string } } }[]>`
    SELECT origin, prompt_version, selected, output FROM analyses WHERE article_id = ${hit}`;
  assert.deepEqual({ origin: analysis!.origin, prompt: analysis!.prompt_version, selected: analysis!.selected }, { origin: "rule", prompt: null, selected: true });
  assert.match(analysis!.output.rule?.reason ?? "", /降息/);
  const [grouped] = await sql<{ grouping_status: string; selection_adds_value: boolean }[]>`
    SELECT grouping_status, selection_adds_value FROM articles WHERE id = ${hit}`;
  assert.deepEqual({ ...grouped }, { grouping_status: "complete", selection_adds_value: true });

  await processArticle(miss);
  const [missPub] = await sql<{ selected: boolean; eligible: boolean }[]>`SELECT selected, eligible FROM publications WHERE article_id = ${miss}`;
  assert.deepEqual({ ...missPub }, { selected: false, eligible: true });
  assert.equal(model.hits(), 0, "rules and source writing call no model");
});
