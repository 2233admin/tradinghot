// The rule filter, ported from OpenAlice's news query (source / keyword / symbol / time window):
// every group that is set must match, any one term inside a group is enough, and matching is a
// case-insensitive substring over the title, body, feed excerpt and stored translation.
// No model is involved; a material with no rule configured is never selected.
import type { SelectionRules } from "./config.ts";
import type { AnalyzeInputArticle } from "./input.ts";

export interface RuleMatch {
  selected: boolean;
  /** Shown in the admin content chain: which term matched, or what kept the material out. */
  reason: string;
}

type RuleInput = Pick<AnalyzeInputArticle, "title" | "bodyText" | "excerpt" | "translationZh" | "publishedAt" | "discoveredAt"> & {
  source: Pick<AnalyzeInputArticle["source"], "id" | "name">;
};

export function matchSelectionRules(a: RuleInput, rules: SelectionRules, now = Date.now()): RuleMatch {
  const source = a.source.id ?? a.source.name;
  if (rules.sources.length && !rules.sources.includes(source)) return { selected: false, reason: `来源 ${source} 不在允许列表` };
  if (rules.excludeSources.includes(source)) return { selected: false, reason: `来源 ${source} 在排除列表` };
  const text = [a.title, a.bodyText, a.excerpt, a.translationZh].filter(Boolean).join("\n").toLowerCase();
  const hit = (term: string) => text.includes(term.toLowerCase());
  const excluded = rules.excludeKeywords.find(hit);
  if (excluded) return { selected: false, reason: `命中排除词「${excluded}」` };
  const keyword = rules.keywords.find(hit);
  if (rules.keywords.length && !keyword) return { selected: false, reason: "没有命中关键词" };
  const symbol = rules.symbols.find(hit);
  if (rules.symbols.length && !symbol) return { selected: false, reason: "没有命中标的" };
  if (rules.lookbackHours !== null) {
    const at = a.publishedAt ?? a.discoveredAt;
    if (!at || now - at.getTime() > rules.lookbackHours * 3600_000) return { selected: false, reason: `早于 ${rules.lookbackHours} 小时` };
  }
  if (!rules.keywords.length && !rules.symbols.length && !rules.sources.length) return { selected: false, reason: "规则为空" };
  return { selected: true, reason: `规则命中：${keyword ? `关键词「${keyword}」` : symbol ? `标的「${symbol}」` : `来源 ${source}`}` };
}
