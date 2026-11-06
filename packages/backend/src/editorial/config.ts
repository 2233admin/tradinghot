// The site's editorial strategy, stored in settings (editorial.strategy) so switching needs no
// release: which registered strategy selects material, which one writes its copy, and the rules a
// rule-based selection reads. The registry of strategies lives in analyze.ts.
import { sql } from "../db.ts";

/** The rule filter's terms: every group that is set must match (OpenAlice's news filter form). */
export interface SelectionRules {
  /** Any one of these must appear in the title, body or feed excerpt. */
  keywords: string[];
  /** None of these may appear. */
  excludeKeywords: string[];
  /** Source ids allowed (empty accepts every source). */
  sources: string[];
  /** Source ids never selected. */
  excludeSources: string[];
  /** Any one of these must appear, beside the keywords when both are set. */
  symbols: string[];
  /** Only material published (else discovered) this recently may match; null has no age limit. */
  lookbackHours: number | null;
  /** The category a rule-selected item is published under; null keeps it off category pages. */
  category: string | null;
  tags: string[];
}

export interface EditorialSettings {
  /** A registered selection strategy id ("model", "rules", or one a module registered). */
  selection: string;
  /** A registered writing strategy id. */
  writing: string;
  rules: SelectionRules;
}

export const DEFAULT_EDITORIAL_SETTINGS: EditorialSettings = {
  selection: "auto",
  writing: "auto",
  rules: { keywords: [], excludeKeywords: [], sources: [], excludeSources: [], symbols: [], lookbackHours: null, category: null, tags: [] },
};

const CACHE_MS = 5_000;
let cache: { at: number; value: EditorialSettings } | null = null;

/** A settings change applies to the next analysis without waiting for the cache to expire. */
export function clearEditorialSettings(): void {
  cache = null;
}

const terms = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean) : [];

export async function editorialSettings(): Promise<EditorialSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const [row] = await sql<{ value: Partial<EditorialSettings> }[]>`SELECT value FROM settings WHERE key = 'editorial.strategy'`;
  const raw = row?.value ?? {};
  const rules = raw.rules ?? DEFAULT_EDITORIAL_SETTINGS.rules;
  const value: EditorialSettings = {
    selection: raw.selection || DEFAULT_EDITORIAL_SETTINGS.selection,
    writing: raw.writing || DEFAULT_EDITORIAL_SETTINGS.writing,
    rules: {
      keywords: terms(rules.keywords),
      excludeKeywords: terms(rules.excludeKeywords),
      sources: terms(rules.sources),
      excludeSources: terms(rules.excludeSources),
      symbols: terms(rules.symbols),
      lookbackHours: typeof rules.lookbackHours === "number" && rules.lookbackHours > 0 ? rules.lookbackHours : null,
      category: typeof rules.category === "string" && rules.category ? rules.category : null,
      tags: terms(rules.tags),
    },
  };
  cache = { at: Date.now(), value };
  return value;
}
