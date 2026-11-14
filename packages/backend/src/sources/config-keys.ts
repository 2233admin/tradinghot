// The config keys each kind of source implements. Anything else is refused: a key a collector does not
// know would otherwise fall back silently to the generic parse (menus and sentence fragments as
// articles, dates never found).
import type { SourceRow } from "./types.ts";

// Rules applied in collect.ts to every kind read through collectSource.
const PUBLISHER = ["publisherRole", "publisherUrlPrefixes", "publisherRequiresDiscovery"];
const COLLECTED = [...PUBLISHER, "_aihot", "allowUrlPrefixes", "denyUrlPrefixes", "ingestNoiseFilter", "itemUrlPrefixRewrite", "sortByPublishedAt", "detail", "fetchPublicContent", "publishedAfter", "acceptLanguage", "via", "bodyVia", "profile", "session", "channel"];

const KEYS: Record<SourceRow["kind"], string[]> = {
  rss: [...COLLECTED, "feedUrl", "headers", "summaryIsBody", "preserveUrlFragment", "allowCategories", "denyCategories", "publishedAtUtcOffset"],
  web_list: [
    ...COLLECTED, "url", "baseUrl", "parseMode", "adapter", "cacheToleranceSeconds", "linksStartLine", "preserveUrlFragment",
    "itemSelector", "linkSelector", "titleSelector", "summarySelector", "authorSelector", "publishedAtSelector", "publishedAtAttribute", "publishedAtRegex", "publishedAtUtcOffset",
  ],
  json_list: [
    ...COLLECTED, "url", "mode", "method", "headers", "bodyJson", "bodyForm", "jsonKey", "windowVar", "itemsPath", "itemsObjectValues",
    "titlePaths", "summaryPaths", "summaryTemplate", "summaryIsBody", "authorPaths", "publishedAtPath", "publishedAtUnit", "publishedAtUtcOffset", "externalIdPath",
    "urlTemplate", "urlTemplateFallback", "rawDropKeys", "requireBoolean", "minNumeric", "pagination", "truthSocial",
  ],
  // X accounts are mostly read in shards, which apply only these.
  x_search: [...PUBLISHER, "_aihot", "ingestNoiseFilter", "itemUrlPrefixRewrite", "query", "searchType", "channel"],
  mp_account: [...PUBLISHER, "wxid", "ghid", "nickname"],
  // An external source is fed by a collector: which one, and which of the collector's sources.
  external: [...PUBLISHER, "collector", "collectorId"],
};

// The generic JSON mapping: how a plain JSON listing is read into posts. Truth Social's own adapter
// reads the platform's posts itself, so a config that also carries these keys would be half ignored.
const GENERIC_JSON_KEYS = [
  "jsonKey", "windowVar", "itemsPath", "itemsObjectValues", "titlePaths", "summaryPaths", "summaryTemplate", "summaryIsBody",
  "authorPaths", "publishedAtPath", "publishedAtUnit", "publishedAtUtcOffset", "urlTemplate", "urlTemplateFallback",
  "requireBoolean", "minNumeric", "bodyJson", "bodyForm", "method", "pagination",
];

// Objects with fixed keys (headers and bodyJson are request data, free-form).
const NESTED: Record<string, string[]> = {
  _aihot: ["initialBackfillLimit", "initialBackfillMonths", "fast", "watch"],
  ingestNoiseFilter: ["dropMarkers", "dropMarkersTitleOnly", "keepIfMatches"],
  itemUrlPrefixRewrite: ["from", "to"],
  requireBoolean: ["path", "equals"],
  minNumeric: ["path", "min"],
  // Truth Social: the account read, and the window one run reads (pages of the platform's listing).
  truthSocial: ["account", "accountId", "pages"],
  detail: [
    "maxFetches", "publishedAtSelector", "publishedAtRegex", "publishedAtUtcOffset", "publishedAtAuthoritative", "upgradeDatePrecision",
    "titleSelector", "titleRegex", "titleAuthoritative", "summarySelector", "preserve", "bodyUrlSuffix",
  ],
};

/** Article widgets to preserve (PreserveRule in content/extract.ts): { selector, as: "pre" | "table" }, a code block's `code` and `caption` parts. */
const preserveRules = (value: unknown) => Array.isArray(value) && value.every((rule) => {
  if (!rule || typeof rule !== "object") return false;
  const selector = (key: string) => typeof rule[key] === "string" && rule[key].trim() !== "";
  const parts = rule.as === "pre" ? ["code", "caption"] : rule.as === "table" ? [] : null;
  return parts !== null && selector("selector") && Object.keys(rule).every((key) => key === "selector" || key === "as" || parts.includes(key) && selector(key));
});

const VALUES: Record<string, string[]> = {
  publisherRole: ["organization", "person"],
  adapter: ["mimo_home", "barrons_market"],
  parseMode: ["html", "markdown", "docusaurus_changelog", "markdown_changelog", "intercom_changelog"],
  via: ["opencli"],
  bodyVia: ["browsermcp"],
};

// An Accept-Language value: language ranges with optional weights, e.g. "en-US,en;q=0.9".
const LANGUAGE_RANGE = String.raw`(?:[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*|\*)(?:;q=(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?`;
const ACCEPT_LANGUAGE = new RegExp(`^${LANGUAGE_RANGE}(?: *, *${LANGUAGE_RANGE})*$`);

function utcInstant(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === (value.includes(".") ? value : value.replace(/Z$/, ".000Z"));
}

/** The config entries a source of this kind would ignore or cannot run, e.g. ["adapter=site_cards", "detail.titleFoo"]. */
export function unsupportedConfig(kind: SourceRow["kind"], config: Record<string, unknown>): string[] {
  const allowed = new Set(KEYS[kind] ?? []);
  const out: string[] = [];
  for (const [key, value] of Object.entries(config ?? {})) {
    if (!allowed.has(key)) out.push(key);
    else if (key === "publisherRequiresDiscovery" && (typeof value !== "boolean"
      || value && (!Array.isArray(config.publisherUrlPrefixes) || config.publisherUrlPrefixes.length === 0))) out.push(key);
    else if (key === "publishedAfter" && !utcInstant(value)) out.push(key);
    else if (key === "acceptLanguage" && (typeof value !== "string" || !ACCEPT_LANGUAGE.test(value))) out.push(key);
    else if (key === "pagination" && (
      !value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((part) => !["pageParam", "startPage", "maxPages"].includes(part))
      || typeof (value as any).pageParam !== "string" || !/^[A-Za-z][A-Za-z0-9_]*$/.test((value as any).pageParam)
      || !Number.isSafeInteger((value as any).startPage) || (value as any).startPage < 0
      || !Number.isSafeInteger((value as any).maxPages) || (value as any).maxPages < 1 || (value as any).maxPages > 10
      || !!config.via || !!config.bodyForm || !!config.bodyJson || !!config.requireBoolean || !!config.minNumeric
      || !!config.mode && config.mode !== "json_api" || !!config.method && config.method !== "GET"
      || typeof config.url !== "string" || config.url.startsWith("https://r.jina.ai/")
    )) out.push(key);
    else if (key === "publisherUrlPrefixes" && (!Array.isArray(value) || !value.every((v) => {
      if (typeof v !== "string") return false;
      try { const u = new URL(v); return /^https?:$/.test(u.protocol) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
    }))) out.push(key);
    else if (key === "mode" && value === "truth_social") {
      // The Truth Social adapter reads the platform's posts itself; the generic mapping would be ignored.
      for (const name of GENERIC_JSON_KEYS) if (name in config) out.push(name);
    }
    else if (VALUES[key] && !VALUES[key]!.includes(String(value))) out.push(`${key}=${String(value)}`);
    else if (NESTED[key] && value && typeof value === "object") {
      if (key === "_aihot" && "fast" in value && typeof value.fast !== "boolean") out.push("_aihot.fast");
      for (const sub of Object.keys(value)) if (!NESTED[key]!.includes(sub)) out.push(`${key}.${sub}`);
      if (key === "detail" && "preserve" in value && !preserveRules((value as { preserve: unknown }).preserve)) out.push("detail.preserve");
      if (key === "truthSocial") {
        if ("account" in value && (typeof value.account !== "string" || !value.account.trim())) out.push("truthSocial.account");
        if ("accountId" in value && (typeof value.accountId !== "string" || !/^\d+$/.test(value.accountId))) out.push("truthSocial.accountId");
        if ("pages" in value && (typeof value.pages !== "number" || !Number.isSafeInteger(value.pages) || value.pages < 1 || value.pages > 3)) out.push("truthSocial.pages");
      }
    }
  }
  return out;
}

export class UnsupportedConfig extends Error {
  readonly statusCode = 400;
}

/** Refuses a config with entries its kind does not implement (admin create, edit and preview). */
export function assertSupportedConfig(kind: SourceRow["kind"], config: Record<string, unknown>): void {
  const bad = unsupportedConfig(kind, config);
  if (bad.length) throw new UnsupportedConfig(`不支持的配置项：${bad.join("、")}`);
}
