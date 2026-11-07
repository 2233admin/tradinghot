// The site's own relevance score: every material is read as words and phrases (Chinese by
// Intl.Segmenter, Latin by word boundaries), matched against industry/relevance.ts, and scored
// 0–100. High scores are 精选; everything stays in 全部动态. Politics and diplomacy are events,
// not noise: a geopolitical brief scores on its place, event and action like any other story.
import { RELEVANCE, type TermGroup } from "@aihot/industry/relevance";
import type { AnalyzeInputArticle } from "./input.ts";

export interface MaterialScore {
  score: number;
  /** The terms that earned points, one per concept, for the admin and the rule reason. */
  labels: string[];
  /** A spam term found in the text; such material is never 精选. */
  noise: string | null;
  selected: boolean;
}

const CJK = /[\u3400-\u9fff]/;
const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Whole-word match for Latin terms so "rate" does not fire inside "corporate". */
const latinPatterns = new Map<string, RegExp>();
function latinPattern(term: string): RegExp {
  let pattern = latinPatterns.get(term);
  if (!pattern) {
    pattern = new RegExp(`(?<![a-z0-9])${term.replace(ESCAPE, "\\$&")}(?![a-z0-9])`);
    latinPatterns.set(term, pattern);
  }
  return pattern;
}

function contains(text: string, term: string): boolean {
  return CJK.test(term) ? text.includes(term) : latinPattern(term).test(text);
}

/** The first spelling of each concept that occurs; one concept scores once however often it repeats. */
function hits(text: string, groups: readonly TermGroup[], cap: number): string[] {
  const found: string[] = [];
  for (const group of groups) {
    const term = group.terms.find((t) => contains(text, t));
    if (term) found.push(term);
    if (found.length >= cap) break;
  }
  return found;
}

function hasNumber(text: string): boolean {
  return /\d/.test(text) && /(\d\s*%|\d+(?:\.\d+)?\s*(?:亿|万|万亿|bp|基点|点|美元|元|bln|billion|million)|\d{2,})/.test(text);
}

/**
 * Scores one article. The text read is what a reader sees: title, body, excerpt and the stored
 * translation, each contributing its matches to the same concept set.
 */
export function scoreMaterial(a: { title: string; bodyText?: string | null; excerpt?: string | null; translationZh?: string | null; source: { tier: string } }): MaterialScore {
  const text = normalize([a.title, a.bodyText, a.excerpt, a.translationZh].filter(Boolean).join(" "));
  // Spam words are a headline/teaser problem; a legitimate article's body may quote or mention them.
  const noiseText = normalize([a.title, a.excerpt].filter(Boolean).join(" "));

  const noise = RELEVANCE.noise.find((term) => contains(noiseText, term)) ?? null;
  if (noise) return { score: 0, labels: [], noise, selected: false };

  const entities = hits(text, RELEVANCE.entities, 3);
  const places = hits(text, RELEVANCE.places, 3);
  const events = hits(text, RELEVANCE.events, 3);
  const actions = hits(text, RELEVANCE.actions, 2);
  const base = RELEVANCE.baseByTier[a.source.tier] ?? RELEVANCE.baseByTier.T2!;
  const categories = [entities, places, events, actions].filter((list) => list.length > 0).length;
  const raw = base
    + entities.length * 12
    + places.length * 10
    + events.length * 20
    + actions.length * 8
    + (hasNumber(text) ? 4 : 0)
    + (categories >= 2 ? 10 : 0);
  const score = Math.min(100, raw);
  return {
    score,
    labels: [...entities, ...places, ...events, ...actions],
    noise: null,
    selected: score >= RELEVANCE.threshold,
  };
}

/** The reason shown in the analysis chain for a segment judgement. */
export function segmentReason(result: MaterialScore): string {
  if (result.noise) return `分词排除：噪声词「${result.noise}」`;
  const terms = result.labels.length ? `命中 ${result.labels.join("、")}` : "没有命中主体或事件";
  return `分词评分 ${result.score}：${terms}`;
}
