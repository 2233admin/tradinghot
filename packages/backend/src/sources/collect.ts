// Collection run for one source: fetch listing → filter → store material → enqueue processing.
// A failed fetch never advances the success cursor; the source's health reflects consecutive failures.
import { sql, type Db } from "../db.ts";
import { fillScheduledPublications, FUTURE_TOLERANCE_MS, identityKeyFor, materialIdentityForUrl, reuseExternalMaterialIdentities, STALE_ON_DISCOVERY_MS, upsertMaterial } from "../content/materials.ts";
import { PresentationMismatch } from "../content/presentation.ts";
import { HttpStatusError } from "../lib/http-fetch.ts";
import { identityKeyForUrl } from "../lib/url.ts";
import { sha256 } from "../lib/ids.ts";
import { enqueue, QUEUES, shutdownSignal } from "../jobs/queue.ts";
import { queueProcessing } from "../jobs/content.ts";
import { BudgetExceededError, ProviderRejectedError, completeReceipt } from "../providers/receipts.ts";
import { usesBrowserXSearch } from "../providers/socialdata.ts";
import { browserXQuota, BrowserXThrottleError } from "../providers/x-browser.ts";
import { fetchRss } from "./rss.ts";
import { fetchDetail, fetchWebList, isCallToActionTitle, needsTitle, type DetailNeed } from "./web-list.ts";
import { unsupportedConfig } from "./config-keys.ts";
import { admitListing, filterPublicationWindow } from "./filters.ts";
import { fetchJsonList } from "./json-list.ts";
import { fetchXSearch, planXShards, readXSearch, shardHandle, shardQuery, selfThreadHandle, SHARDABLE_SQL, tweetToCandidate, type XBacklog } from "./x.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";
import { readsWhole, usePace } from "./uses.ts";

export interface CollectResult {
  sourceId: string;
  status: "ok" | "failed" | "skipped";
  found: number;
  created: number;
  revised: number;
  error?: string;
  /** The round succeeded, but it cannot prove it read the whole window; the note says what is unproven. */
  note?: string;
  rateLimited?: boolean;
}

export async function loadSource(id: string): Promise<SourceRow | null> {
  const [s] = await sql<SourceRow[]>`
    SELECT id, name, kind, config, tier, participation_mode, uses, first_party, interval_minutes, enabled, cursor, fail_count
    FROM sources WHERE id = ${id}`;
  return s ?? null;
}

export interface StoredDetail {
  identity_key: string;
  source_id: string;
  title: string;
  published_at: Date | null;
  publication_time?: string | null;
  excerpt: string | null;
  body_status: string;
  rules: string | null;
}

/** What material under these identities already has, whichever source stored it. */
export async function storedDetails(identities: string[]): Promise<Map<string, StoredDetail>> {
  if (identities.length === 0) return new Map();
  // One array parameter: a long listing would exceed the query's parameter limit.
  const rows = await sql<StoredDetail[]>`SELECT identity_key, source_id, title, published_at, publication_time, excerpt, body_status,
    raw->'collectionDetail'->>'rules' AS rules
    FROM articles WHERE identity_key = ANY(${identities}::text[])`;
  return new Map(rows.map((r) => [r.identity_key, r]));
}

const DAY_MS = 86_400_000;

export type CollectionCandidate = Candidate & { detailRules?: string };

/** The detail rules in force; a page read under other rules is read again. */
const detailRulesOf = (source: SourceRow) => (source.config.detail ? sha256(JSON.stringify(source.config.detail)) : null);

/**
 * A listing as every run reads it: the source's URL, category and noise rules, its order, and one entry
 * per stored identity. Deduplication comes before detail reads and limits: URL aliases must neither buy
 * duplicate reads nor crowd other articles out of the window. The identity is exactly the one the
 * material will store; a source whose entries are sections of one page (#september-24-2026 …) keeps
 * their fragments in it. Listing dates marked unreliable give way to the detail page's rule.
 */
export async function listingEntries(source: SourceRow, found: Candidate[]): Promise<CollectionCandidate[]> {
  let candidates = admitListing(found, source);
  if (source.kind === "json_list" && source.config.externalIdPath) candidates = await reuseExternalMaterialIdentities(source.id, candidates);
  if (source.config.sortByPublishedAt) candidates.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const unreliableDates = source.config.detail?.publishedAtAuthoritative === true;
  const unique = new Map<string, CollectionCandidate>();
  for (const c of candidates) {
    const requestedIdentity = c.identityKey
      ?? (source.config.preserveUrlFragment === true ? identityKeyForUrl(c.url, { keepFragment: true }) : null)
      ?? identityKeyFor({ ...c, sourceId: source.id, via: "fetch" });
    const identityKey = requestedIdentity === identityKeyForUrl(c.url)
      ? await materialIdentityForUrl(c.url) ?? requestedIdentity : requestedIdentity;
    if (!unique.has(identityKey)) unique.set(identityKey, { ...c, identityKey, ...(unreliableDates ? { publishedAt: null, publicationTime: null } : {}) });
  }
  return [...unique.values()];
}

/**
 * Which entries a run stores. A first import takes the configured months of archive (and a bounded
 * number, applied by the caller). Later runs take new identities only when published since the source
 * was added, less the stale-on-discovery window, so a long listing's archive comes in through the first
 * import alone; stored identities still accept corrections. An X search is bounded by its watermark
 * instead. A fixed publication boundary applies on every run. `byListing` judges the listing's dates
 * and passes an undated entry; `admits` judges again after detail pages may have dated it.
 */
function admission(source: SourceRow, known: Map<string, StoredDetail>, firstImport: boolean) {
  const months = Number(source.config._aihot?.initialBackfillMonths ?? 12);
  const floor = firstImport ? Date.now() - months * 30 * DAY_MS
    : source.kind === "x_search" ? null : Date.parse(String(source.cursor!.initializedAt)) - STALE_ON_DISCOVERY_MS;
  const byListing = (c: Candidate) => floor === null || !firstImport && known.has(c.identityKey!) || !(c.publishedAt && c.publishedAt.getTime() < floor);
  return { byListing, admits: (c: Candidate) => byListing(c) && filterPublicationWindow([c], source.config.publishedAfter).length > 0 };
}

/** Excluded detail dates expire: an undated listing cannot reveal a corrected date on the page. */
type DatedOut = Record<string, [listed: string | null, found: string | null, checkedAt: number | null]>;
// No date, or an explicit access refusal (null checkedAt), keeps the existing read-once rule.
const currentDateRead = (read: DatedOut[string]) => read[1] === null || read[2] === null || read[2] > Date.now() - DAY_MS;
/** Entries whose page keeps failing with a recoverable error, by identity: straight failures and the last one's time. */
type Retries = Record<string, [failures: number, at: string]>;

const HOUR_MS = 3_600_000;
/**
 * How long a page waits after its latest straight failure. Production, 30 days to 2026-10-19: one-off
 * timeouts and TLS drops were gone by the next run, but pages also came back after a day (a Qoder post
 * online 25 hours late) while others failed on every run for days (a challenge page, HN buzzing 47
 * times in two days). Two quick retries, then an hour doubling to a day: never given up.
 */
const retryWait = (failures: number) => failures < 3 ? 0 : Math.min(24 * HOUR_MS, HOUR_MS * 2 ** (failures - 3));

export interface DetailReads {
  attempts: number;
  /** Last attempted identity: the next run starts after it, even when it failed. */
  after?: string;
  /** Entries whose page is still to be read: over the budget, after a spent provider budget, or failed. */
  pending: number;
  failures: Array<{ url: string; error: string }>;
  /** Pages the site refused: its answer, read once and recorded, not a failure of ours. */
  refused: Array<{ url: string; error: string }>;
  /** The listing date of each entry a page dated under the rules in force, this run or remembered. */
  listed: Map<string, DatedOut[string]>;
  /** Listed entries whose page still fails with a recoverable error. */
  retries: Retries;
}

/**
 * This source's stored material lends a listing entry its date where the listing has none (unless an
 * authoritative rule reads it again) and its detail-page title, which the listing's own rendering must
 * not revise back. Returns whether its page was read under the rules in force.
 */
function fromStored(c: CollectionCandidate, stored: StoredDetail, source: SourceRow, rules: string | null): boolean {
  const d = source.config.detail;
  if (d?.titleSelector || d?.titleRegex) c.title = stored.title;
  const current = stored.rules === rules;
  if ((current || d?.publishedAtAuthoritative !== true) && !c.publishedAt) {
    c.publishedAt = stored.published_at;
    c.publicationTime = stored.publication_time ?? null;
  }
  return current;
}

/** What a detail page should add to an entry, or null when it would add nothing. */
function detailNeed(c: CollectionCandidate, stored: StoredDetail | undefined, source: SourceRow, listingTitle: string): DetailNeed | null {
  const d = source.config.detail!;
  const storedHeadline = !!stored && isCallToActionTitle(listingTitle) && !isCallToActionTitle(stored.title);
  const need: DetailNeed = {
    date: d.publishedAtAuthoritative === true || !(stored?.published_at || c.publishedAt) || d.upgradeDatePrecision === true,
    title: !!(d.titleSelector || d.titleRegex) && (d.titleAuthoritative === true || (!storedHeadline && needsTitle(c.title))),
    summary: !!d.summarySelector && !(stored?.excerpt || c.excerpt),
    body: readsWhole(source) && stored?.body_status !== "ok" && !c.bodyText && (!c.bodyStatus || c.bodyStatus === "pending"),
  };
  return need.date || need.title || need.summary ? need : null;
}

/** A detail page's findings. A body comes from the same Readability path as extraction, using bytes already fetched. */
function applyDetail(c: CollectionCandidate, got: Awaited<ReturnType<typeof fetchDetail>>, rules: string): void {
  c.detailRules = rules;
  if (got.title) c.title = got.title;
  if (got.summary) c.excerpt = got.summary;
  // A confirmed body enters through normal material revisions and skips the redundant fetch job.
  if (got.body) {
    c.bodyHtml = got.body.html;
    c.bodyText = got.body.text;
    c.bodyStatus = "ok";
    if (!c.media?.length) c.media = got.body.images;
  }
  // The page's date (its source's rule first, fetchDetail); a date-only listing value gives way to its time on the same day.
  if (got.publishedAt && (!c.publishedAt || Math.abs(got.publishedAt.getTime() - c.publishedAt.getTime()) < DAY_MS)) {
    c.publishedAt = got.publishedAt;
    c.publicationTime = got.publicationTime;
  }
}

/**
 * Detail pages (config.detail) fill what a listing lacks, reading at most `budget` pages; material
 * stored before that budget ran out, or during a failed read, finishes on a later run. A page read
 * under the rules in force is not read again, and another source's material takes nothing from this
 * listing (materials.ts): its page is not worth a read. An entry its page dated out of admission is
 * remembered (`datedOut`): while listed with the same date and still not admitted, it keeps that date
 * for a day, so an archive does not use up every run's budget and corrected dates can recover. A
 * spent provider budget defers the remaining pages; other failures are reported, not thrown, and a page
 * the site refuses is not read again under the same rules; one that keeps failing otherwise waits longer
 * between tries (`retries`, retryWait). Each run continues after the last attempted identity, so a
 * recoverable failure cannot keep taking the budget from all later entries.
 */
export async function enrichDetails(candidates: CollectionCandidate[], source: SourceRow, known: Map<string, StoredDetail>,
  opts: { budget: number; after?: string; datedOut: DatedOut; retries: Retries; admits: (c: Candidate) => boolean }): Promise<DetailReads> {
  const rules = detailRulesOf(source);
  const reads: DetailReads = { attempts: 0, pending: 0, failures: [], refused: [], listed: new Map(), retries: {} };
  let providerBudgetSpent = false;
  const start = candidates.findIndex(c => c.identityKey === opts.after) + 1;
  const ordered = [...candidates.slice(start), ...candidates.slice(0, start)];
  for (const c of ordered) {
    const stored = known.get(c.identityKey!);
    if (stored && stored.source_id !== source.id) continue;
    const listingTitle = c.title;
    if (stored && fromStored(c, stored, source, rules)) continue;
    const need = rules === null ? null : detailNeed(c, stored, source, listingTitle);
    if (!need) continue;
    const listed = c.publishedAt?.toISOString() ?? null;
    const seen = opts.datedOut[c.identityKey!];
    const remembered = seen?.[1] ? new Date(seen[1]) : null;
    const retry = opts.retries[c.identityKey!];
    if (seen && seen[0] === listed && !opts.admits({ ...c, publishedAt: remembered })) {
      c.publishedAt = remembered;
      reads.listed.set(c.identityKey!, seen);
      if (currentDateRead(seen)) continue;
    }
    if (providerBudgetSpent || reads.attempts >= opts.budget || retry && Date.now() < Date.parse(retry[1]) + retryWait(retry[0])) {
      reads.pending += 1;
      if (retry) reads.retries[c.identityKey!] = retry;
    } else {
      reads.attempts += 1;
      reads.after = c.identityKey;
      try {
        const got = await fetchDetail(c.url, source, need);
        if (got.publishedAt) c.publishedAt = listed ? new Date(listed) : null;
        applyDetail(c, got, rules!);
        reads.listed.set(c.identityKey!, [listed, c.publishedAt?.toISOString() ?? null, Date.now()]);
      } catch (error) {
        if (shutdownSignal.signal.aborted) throw error;
        // A spent provider budget is not the source's failure.
        const failed = !(error instanceof BudgetExceededError);
        // A page the site refuses (paywall, captcha, blocked address) is read under these rules once, like
        // a page without the fields: read again on every run it took the budget from the entries behind
        // it. A missing page, a timeout, rate limiting and server errors have recovered, so they are retried.
        const refused = error instanceof HttpStatusError && error.status < 500 && ![404, 408, 425, 429].includes(error.status);
        if (!failed) providerBudgetSpent = true;
        else (refused ? reads.refused : reads.failures).push({ url: c.url, error: String(error instanceof Error ? error.message : error).slice(0, 300) });
        if (refused) {
          c.detailRules = rules!;
          reads.listed.set(c.identityKey!, [listed, c.publishedAt?.toISOString() ?? null, null]);
        } else {
          reads.pending += 1;
          if (failed) reads.retries[c.identityKey!] = [(retry?.[0] ?? 0) + 1, new Date().toISOString()];
          else if (retry) reads.retries[c.identityKey!] = retry;
        }
      }
    }
  }
  return reads;
}

async function store(sourceId: string, candidates: CollectionCandidate[], backfill: string | null) {
  let created = 0;
  let revised = 0;
  for (const c of candidates) {
    const material = { ...c, sourceId, via: "fetch" as const, backfill };
    let res;
    try { res = await upsertMaterial(material); }
    catch (error) {
      if (!(error instanceof PresentationMismatch)) throw error;
      // Same wording, a layout the translation cannot follow: the article's transaction retained the
      // consistent original and translation, which is the outcome; later articles are still stored.
      continue;
    }
    // A successful page with no matching field is complete too. Otherwise an undated article at
    // the front of a listing would consume the detail budget forever and strand the remaining ones.
    if (c.detailRules) await sql`UPDATE articles SET raw = jsonb_set(
      CASE WHEN jsonb_typeof(raw) = 'object' THEN raw ELSE '{}'::jsonb END,
      '{collectionDetail}', ${sql.json({ rules: c.detailRules })}) WHERE id = ${res.articleId} AND source_id = ${sourceId}`;
    if (res.created) created += 1;
    if (res.revised) revised += 1;
    // Extraction first when the source wants full text and none came with the listing, else analysis.
    if (res.created || res.revised || res.processingNeeded) await queueProcessing(res.articleId);
  }
  return { created, revised };
}

/** Stage a listing page before another network request can delay or lose its newest entries. */
async function cacheFast(source: SourceRow, candidates: CollectionCandidate[], firstImport: boolean, cacheRules: string): Promise<void> {
  if (!candidates.length) return;
  await sql.begin(async (tx) => {
    await lockSourceCursor(tx, source);
    for (const candidate of candidates) {
      await tx`INSERT INTO fast_source_items (source_id, identity_key, payload, first_import, rules_key)
        VALUES (${source.id}, ${candidate.identityKey!}, ${tx.json(candidate as never)}, ${firstImport}, ${cacheRules})
        ON CONFLICT (source_id, identity_key) DO UPDATE SET payload = EXCLUDED.payload, pending = true, considered_at = NULL, rules_key = EXCLUDED.rules_key
        WHERE fast_source_items.payload IS DISTINCT FROM EXCLUDED.payload OR fast_source_items.rules_key IS DISTINCT FROM EXCLUDED.rules_key`;
    }
  });
}

/**
 * The end of a fetch run, on the run and on its source. Success marks the source healthy and due again
 * one interval later. A failure counts toward "failing" (5 in a row) and waits longer after each one,
 * up to six hours; a full budget is not the source's failure and does not increase its failure count.
 */
async function recordFetch(db: Db, sourceId: string, runId: number, run: { found: number; created: number; detail: object | null } & ({ cursor: Record<string, unknown>; coverageError?: string } | { error: string; budget: boolean; rateLimited: boolean })): Promise<void> {
  const detail = run.detail ? db.json(run.detail as never) : null;
  if ("cursor" in run) {
    if (run.coverageError) {
      const error = run.coverageError;
      // The source answered; what it cannot prove is that it answered for the whole window. That is not a
      // failed fetch, so the source stops counting as one and reads as degraded instead of failing, and the
      // round keeps the note instead of an error: the run succeeded, its coverage is what is unproven.
      await db`UPDATE sources SET last_fetch_at = now(), last_ok_at = now(), fail_count = 0, last_error = ${error}, cursor = ${db.json(run.cursor as never)},
        health = 'degraded',
        next_fetch_at = now() + make_interval(mins => CASE WHEN config->'_aihot'->>'fast' = 'true' THEN 1 ELSE interval_minutes END),
        updated_at = now() WHERE id = ${sourceId}`;
      await db`UPDATE fetch_runs SET status = 'ok', finished_at = now(), found_count = ${run.found}, new_count = ${run.created},
        detail = nullif(coalesce(detail,'{}'::jsonb) || coalesce(${detail}::jsonb,'{}'::jsonb) || jsonb_build_object('coverageNote', ${error}::text),'{}'::jsonb) WHERE id = ${runId}`;
      return;
    }
    await db`
      UPDATE sources SET last_fetch_at = now(), last_ok_at = now(), fail_count = 0, last_error = NULL,
        health = 'ok', cursor = ${db.json(run.cursor as never)}, updated_at = now(),
        next_fetch_at = now() + make_interval(mins => CASE WHEN config->'_aihot'->>'fast' = 'true' AND coalesce(config->>'url', '') NOT LIKE 'https://r.jina.ai/%' THEN 1 ELSE interval_minutes END)
      WHERE id = ${sourceId}`;
    await db`UPDATE fetch_runs SET status = 'ok', finished_at = now(), found_count = ${run.found}, new_count = ${run.created},
      detail = nullif(coalesce(detail,'{}'::jsonb) || coalesce(${detail}::jsonb,'{}'::jsonb),'{}'::jsonb) WHERE id = ${runId}`;
    return;
  }
  await db`
    UPDATE sources SET last_fetch_at = now(),
      fail_count = CASE WHEN ${run.budget} THEN fail_count ELSE fail_count + 1 END,
      last_error = ${run.error},
      health = CASE WHEN ${run.budget} THEN health WHEN fail_count + 1 >= 5 THEN 'failing' ELSE 'degraded' END,
      next_fetch_at = now() + make_interval(mins => CASE
        WHEN ${run.budget} OR ${run.rateLimited} AND config->'_aihot'->>'fast' = 'true' THEN CASE WHEN config->'_aihot'->>'fast' = 'true' THEN 10 ELSE 15 END
        WHEN config->'_aihot'->>'fast' = 'true' THEN LEAST(fail_count + 2, 10)
        ELSE LEAST(interval_minutes * (fail_count + 2), 360) END),
      updated_at = now()
    WHERE id = ${sourceId}`;
  await db`UPDATE fetch_runs SET status = 'failed', finished_at = now(), found_count = ${run.found}, new_count = ${run.created},
              error = ${run.error}, detail = nullif(coalesce(detail,'{}'::jsonb) || coalesce(${detail}::jsonb,'{}'::jsonb),'{}'::jsonb) WHERE id = ${runId}`;
}

/**
 * The browser session rests (its quota is spent, or X refused a search): the account was not read and
 * nothing about it failed. The round is skipped and the account stays due; its health and its failure
 * count do not move, so one account's turn does not become another's failure.
 */
async function recordThrottled(db: Db, sourceId: string, runId: number, message: string, detail: object | null): Promise<void> {
  const note = db.json(detail as never);
  await db`UPDATE sources SET last_fetch_at = now(), next_fetch_at = now() + interval '10 minutes', updated_at = now()
    WHERE id = ${sourceId} AND health IN ('ok', 'degraded', 'unknown')`;
  await db`UPDATE fetch_runs SET status = 'skipped', finished_at = now(), error = ${message},
    detail = nullif(coalesce(${note}::jsonb,'{}'::jsonb) || jsonb_build_object('throttled', true),'{}'::jsonb) WHERE id = ${runId}`;
}

class StaleSourceError extends Error {
  constructor() { super("source changed during collection"); }
}

/** Reject a cursor computed from a source snapshot superseded by another collection. */
async function lockSourceCursor(db: Db, source: SourceRow): Promise<void> {
  const expected = source.cursor === null ? null : db.json(source.cursor as never);
  const rows = await db`SELECT id FROM sources WHERE id = ${source.id}
    AND cursor IS NOT DISTINCT FROM ${expected}::jsonb
    AND config = ${db.json(source.config as never)}::jsonb AND enabled = ${source.enabled} FOR UPDATE`;
  if (!rows.length) throw new StaleSourceError();
}

/** `xSince` reads an X account again from that post, without moving its watermark back. */
export async function collectSource(sourceId: string, opts: { force?: boolean; xSince?: string } = {}): Promise<CollectResult> {
  const source = await loadSource(sourceId);
  if (!source) return { sourceId, status: "skipped", found: 0, created: 0, revised: 0, error: "missing" };
  if (!source.enabled && !opts.force) return { sourceId, status: "skipped", found: 0, created: 0, revised: 0, error: "paused" };
  if (source.kind === "mp_account" || source.kind === "external") {
    // WeChat accounts are reconciled by the mp job; external sources only receive reports.
    return { sourceId, status: "skipped", found: 0, created: 0, revised: 0 };
  }

  const [run] = await sql<{ id: number }[]>`INSERT INTO fetch_runs (source_id) VALUES (${sourceId}) RETURNING id`;
  const firstImport = !source.cursor?.initializedAt;
  let created = 0;
  let revised = 0;
  let found = 0;
  try {
    // A config entry this kind does not implement fails the run, visibly, instead of being ignored.
    const unsupported = unsupportedConfig(source.kind, source.config);
    if (unsupported.length) throw new FetchError(`unsupported config: ${unsupported.join(", ")}`);
    let candidates: CollectionCandidate[];
    let paidReceiptIds: number[] = [];
    let coverageUnverified = false;
    let paginationLimited = false;
    let pageFailed = false;
    let pageError: unknown;
    let nextCursor: Record<string, unknown> = { ...(source.cursor ?? {}) };
    let detail: Record<string, unknown> | null = null;
    const d = source.config.detail;
    const rules = detailRulesOf(source);
    const cacheRules = source.config._aihot?.fast === true ? sha256(JSON.stringify({ detail: d ?? null, publishedAfter: source.config.publishedAfter ?? null })) : null;
    let earlyImports = 0;
    const earlyIdentities = new Set<string>();
    if (source.kind === "rss") {
      // Changed detail rules require the listing again even when its bytes did not change.
      const expiredDates = Object.values(source.cursor?.detailDatedOut ?? {}).some(read => !currentDateRead(read as DatedOut[string]));
      const rss = await fetchRss(source, { force: opts.force || expiredDates || !!rules && source.cursor?.detailRules !== rules });
      candidates = rss.candidates;
      // The first import keeps only part of the listing: the next run reads all of it once before
      // accepting 304s, for the recent entries the import left out. Persist validators only after store succeeds.
      if (!firstImport) nextCursor.rss = rss.validator;
      else delete nextCursor.rss;
      if (rss.notModified) detail = { notModified: true, httpStatus: 304 };
    }
    else if (source.kind === "web_list") candidates = await fetchWebList(source);
    else if (source.kind === "json_list") {
      candidates = await fetchJsonList(source, {
        onLimit: () => { paginationLimited = true; },
        onPageError: cacheRules === null ? undefined : (error) => {
          if (shutdownSignal.signal.aborted) throw error;
          pageFailed = true;
          pageError = error;
        },
        onPage: cacheRules === null ? undefined : async (page) => {
          let entries = await listingEntries(source, page);
          entries = entries.filter((entry) => {
            if (earlyIdentities.has(entry.identityKey!)) return false;
            earlyIdentities.add(entry.identityKey!);
            return true;
          });
          const previous = d || !firstImport ? await storedDetails(entries.map((c) => c.identityKey!)) : new Map<string, StoredDetail>();
          const policy = admission(source, previous, firstImport);
          entries = entries.filter(policy.byListing);
          if (firstImport) {
            const remaining = Math.max(0, Number(source.config._aihot?.initialBackfillLimit ?? 30) - earlyImports);
            entries = entries.slice(0, remaining);
            earlyImports += entries.length;
          }
          await cacheFast(source, entries.filter((c) => policy.admits(c) || !c.publishedAt && !!source.config.publishedAfter && Number(d?.maxFetches ?? 0) > 0), firstImport, cacheRules);
        },
      });
      if (source.config.pagination) detail = { paginationLimited };
    }
    else {
      const x = await fetchXSearch(source, opts.xSince);
      candidates = x.candidates;
      paidReceiptIds = x.receiptIds;
      coverageUnverified = x.coverageUnverified;
      // The watermark moves when the read covered the stretch since it; the browser's read moves it only
      // then. The coverage note stays, so the site keeps saying that completeness is unproven.
      if (x.lastId && !(nextCursor.lastTweetId && BigInt(String(nextCursor.lastTweetId)) > BigInt(x.lastId))) nextCursor.lastTweetId = x.lastId;
      // A search longer than one run keeps its position for the next runs (shown in the admin).
      if (x.backlog.length) nextCursor.xBacklog = x.backlog;
      else delete nextCursor.xBacklog;
      detail = { pages: x.pages, truncated: x.truncated, coverageUnverified, backlog: x.backlog.length, backlogPages: x.backlogPages, dropped: x.dropped };
    }
    found = candidates.length;
    candidates = await listingEntries(source, candidates);
    // Admission of old archive entries and detail recovery both need the same stored identities.
    // A later date correction must still reach material that was already admitted without a date.
    let known = d || (!firstImport && source.kind !== "x_search")
      ? await storedDetails(candidates.map((c) => c.identityKey!)) : new Map<string, StoredDetail>();
    const initialAdmission = admission(source, known, firstImport);
    const byListing = initialAdmission.byListing;
    let admits = initialAdmission.admits;
    candidates = candidates.filter(byListing);
    // Browser X cannot resume the observed page, so retain it all as first-import history.
    if (firstImport && !coverageUnverified) candidates = candidates.slice(0, Number(source.config._aihot?.initialBackfillLimit ?? 30));
    const cachedImports = new Map<string, boolean>();
    const coverageError = coverageUnverified ? "opencli X search coverage is unverified"
      : paginationLimited ? "JSON listing reached its page limit; coverage is unverified" : undefined;
    if (source.config._aihot?.fast === true) {
      if (!source.config.pagination) await cacheFast(source, candidates.filter((c) => admits(c) || !c.publishedAt && !!source.config.publishedAfter && Number(d?.maxFetches ?? 0) > 0), firstImport, cacheRules!);
      const pending = await sql<{ identity_key: string; payload: CollectionCandidate; first_import: boolean; discovered_at: Date }[]>`
        SELECT identity_key, payload, first_import, discovered_at FROM fast_source_items
        WHERE source_id = ${sourceId} AND pending ORDER BY considered_at NULLS FIRST, discovered_at, identity_key LIMIT 100`;
      candidates = pending.map((row) => {
        cachedImports.set(row.identity_key, row.first_import);
        const c = row.payload;
        return { ...c, identityKey: row.identity_key, publishedAt: c.publishedAt ? new Date(c.publishedAt) : null,
          sourceUpdatedAt: c.sourceUpdatedAt ? new Date(c.sourceUpdatedAt) : null,
          discoveredAt: c.discoveredAt ? new Date(c.discoveredAt) : row.discovered_at };
      });
      if (pending.length) await sql`UPDATE fast_source_items SET considered_at = now()
        WHERE source_id = ${sourceId} AND identity_key = ANY(${pending.map((r) => r.identity_key)}::text[])`;
      known = await storedDetails(candidates.map((c) => c.identityKey!));
      const imported = admission(source, known, true);
      const normal = admission(source, known, firstImport);
      admits = (c) => (cachedImports.get(c.identityKey!) ? imported : normal).admits(c);
    }
    const reads = await enrichDetails(candidates, source, known, {
      budget: source.config._aihot?.fast === true ? Math.min(Number(d?.maxFetches ?? 0), 1) : Number(d?.maxFetches ?? 0), admits,
      after: source.cursor?.detailRules === rules ? source.cursor?.detailAfter : undefined,
      datedOut: source.cursor?.detailRules === rules ? source.cursor?.detailDatedOut ?? {} : {},
      retries: source.cursor?.detailRules === rules ? source.cursor?.detailRetries ?? {} : {},
    });
    if (d) {
      detail = { ...detail, detailAttempts: reads.attempts, detailFailures: reads.failures.length, detailPending: reads.pending, detailErrors: [...reads.failures, ...reads.refused] };
      nextCursor.detailRules = rules;
      if (reads.after) nextCursor.detailAfter = reads.after;
      // A validator covers the whole listing: accept 304 only after its detail work is complete.
      if (source.kind === "rss" && reads.pending > 0) delete nextCursor.rss;
    } else { delete nextCursor.detailRules; delete nextCursor.detailAfter; }

    const complete = source.config._aihot?.fast === true ? candidates.filter((c) => {
      const stored = known.get(c.identityKey!);
      return !d || Number(d.maxFetches ?? 0) === 0 || c.detailRules === rules
        || !!stored && (stored.source_id !== sourceId || stored.rules === rules) || !detailNeed(c, stored, source, c.title);
    }).map((c) => c.identityKey!) : [];

    // Detail pages can establish a date the listing did not have, including an old archive date: such an
    // entry is not stored, and the cursor remembers what its page said (enrichDetails).
    const datedOut: DatedOut = {};
    candidates = candidates.filter((c) => {
      if (admits(c)) return true;
      // A future entry can become admissible without changing the feed's bytes or validator.
      if (source.kind === "rss" && c.publishedAt && c.publishedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) delete nextCursor.rss;
      const listed = reads.listed.get(c.identityKey!);
      if (listed !== undefined) datedOut[c.identityKey!] = listed;
      return false;
    });
    if (source.config._aihot?.fast === true && cachedImports.size) {
      const previousRetries: Retries = source.cursor?.detailRules === rules ? { ...source.cursor?.detailRetries } : {};
      const previousDated: DatedOut = source.cursor?.detailRules === rules ? { ...source.cursor?.detailDatedOut } : {};
      for (const key of cachedImports.keys()) { delete previousRetries[key]; delete previousDated[key]; }
      nextCursor.detailRetries = { ...previousRetries, ...reads.retries };
      nextCursor.detailDatedOut = { ...previousDated, ...datedOut };
    } else if (found) {
      nextCursor.detailDatedOut = datedOut;
      nextCursor.detailRetries = reads.retries;
    }
    if (!d || !Object.keys(nextCursor.detailDatedOut ?? {}).length) delete nextCursor.detailDatedOut;
    if (!d || !Object.keys(nextCursor.detailRetries ?? {}).length) delete nextCursor.detailRetries;
    if (source.config._aihot?.fast === true) {
      for (const candidate of candidates) {
        const result = await store(sourceId, [candidate], cachedImports.get(candidate.identityKey!) ? "first-import" : null);
        created += result.created;
        revised += result.revised;
      }
      if (complete.length) await sql`UPDATE fast_source_items SET pending = false, rules_key = ${cacheRules} WHERE source_id = ${sourceId} AND identity_key = ANY(${complete}::text[])`;
    } else {
      const stored = await store(sourceId, candidates, firstImport ? "first-import" : null);
      created += stored.created;
      revised += stored.revised;
    }
    for (const id of await fillScheduledPublications(sourceId)) await queueProcessing(id);
    if (pageFailed) {
      const message = String(pageError instanceof Error ? pageError.message : pageError).slice(0, 1000);
      await sql.begin(async (tx) => {
        await lockSourceCursor(tx, source);
        await recordFetch(tx, sourceId, run!.id, { found, created, detail, error: message,
          budget: pageError instanceof BudgetExceededError,
          rateLimited: (pageError instanceof HttpStatusError || pageError instanceof ProviderRejectedError) && pageError.status === 429 });
      });
      return { sourceId, status: "failed", found, created, revised, error: message };
    }

    if (firstImport) nextCursor.initializedAt = new Date().toISOString();
    // The time of a complete read: a partial one must not claim the window was covered.
    if (!coverageError) nextCursor.lastOkAt = new Date().toISOString();
    await sql.begin(async (tx) => {
      if (source.kind === "x_search" || source.config.pagination) await lockSourceCursor(tx, source);
      await recordFetch(tx, sourceId, run!.id, { found, created, detail, cursor: nextCursor, coverageError });
      for (const receiptId of paidReceiptIds) await completeReceipt(tx, receiptId);
    });
    return coverageError
      ? { sourceId, status: "ok", found, created, revised, note: coverageError }
      : { sourceId, status: "ok", found, created, revised };
  } catch (error) {
    if (shutdownSignal.signal.aborted) throw error;
    const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
    const rateLimited = (error instanceof HttpStatusError || error instanceof ProviderRejectedError) && error.status === 429;
    if (error instanceof BrowserXThrottleError) {
      // The shared session rests; this account is not at fault and did not fail.
      await recordThrottled(sql, sourceId, run!.id, message, null);
      return { sourceId, status: "skipped", found, created, revised, error: message };
    }
    if (error instanceof StaleSourceError) {
      await sql`UPDATE fetch_runs SET status = 'failed', finished_at = now(), found_count = ${found}, new_count = ${created}, error = ${message} WHERE id = ${run!.id}`;
    } else {
      await recordFetch(sql, sourceId, run!.id, { found, created, detail: null, error: message, budget: error instanceof BudgetExceededError, rateLimited });
    }
    return { sourceId, status: "failed", found, created, revised, error: message, ...(rateLimited ? { rateLimited: true } : {}) };
  }
}

/** X ids begin with their millisecond timestamp (since 2010-11-04): the smallest id of a post made at `ms`. */
const xIdAt = (ms: number) => (BigInt(Math.max(0, ms - 1288834974657)) << 22n);

/**
 * Where an account's posts are known to be read up to. A quiet account's newest post can be months
 * old, but its last successful check read everything up to then; bounding a shard's search by the
 * post alone would re-read months of the other accounts' posts. Ten minutes before the check allows
 * for posts that reach the search late.
 */
function coveredTo(m: SourceRow): bigint {
  const own = BigInt(m.cursor!.lastTweetId);
  const checked = Date.parse(String(m.cursor?.lastOkAt ?? ""));
  if (!Number.isFinite(checked)) return own;
  const byTime = xIdAt(checked - 10 * 60_000);
  return byTime > own ? byTime : own;
}

/**
 * One search for a shard of X accounts (planXShards). Each post goes to the source whose handle wrote
 * it, and every account keeps its own fetch run, health and cursor. The oldest watermark bounds the
 * search, so no account misses a post (the others only see posts they already have again); afterwards
 * each account's watermark moves to its own newest post the search saw (another account's would hide
 * its late posts and, read on its own, the posts below it), and the stretches still unread are kept on
 * one account of the shard, so they survive a change of shards without every later shard buying them.
 */
export async function collectXShard(key: string, sourceIds: string[]): Promise<{ key: string; status: "ok" | "failed" | "skipped"; accounts: number; found: number; created: number; error?: string }> {
  const members = (
    await sql<SourceRow[]>`
      SELECT id, name, kind, config, tier, participation_mode, uses, first_party, interval_minutes, enabled, cursor, fail_count
      FROM sources WHERE id IN ${sql(sourceIds)} ORDER BY id`
  ).filter((m) => m.enabled && shardHandle(m));
  if (members.length === 0) return { key, status: "skipped", accounts: 0, found: 0, created: 0 };
  if (usesBrowserXSearch()) {
    let found = 0;
    let created = 0;
    let failed = false;
    let index = 0;
    let rateLimited = false;
    await Promise.all(Array.from({ length: Math.min(2, members.length) }, async () => {
      while (index < members.length && !rateLimited) {
        const member = members[index++]!;
        const result = await collectSource(member.id);
        found += result.found;
        created += result.created;
        failed ||= result.status === "failed";
        rateLimited ||= result.rateLimited === true;
      }
    }));
    return { key, status: failed ? "failed" : "ok", accounts: index, found, created,
      ...(failed ? { error: rateLimited ? "X rate limit stopped remaining account searches" : "one or more X account collections failed" } : {}) };
  }
  const runs = new Map((await sql<{ id: number; source_id: string }[]>`
    INSERT INTO fetch_runs ${sql(members.map(m => ({ source_id: m.id })), "source_id")} RETURNING id, source_id`
  ).map(r => [r.source_id, r.id]));
  let found = 0;
  let created = 0;
  try {
    const since = members.map(coveredTo).reduce((a, b) => (b < a ? b : a));
    // readXSearch keeps one copy per query and gives up stretches left over for days.
    const backlog: XBacklog[] = members.flatMap((m) => (Array.isArray(m.cursor?.xBacklog) ? m.cursor.xBacklog as XBacklog[] : []));
    const read = await readXSearch(shardQuery(members.map((m) => shardHandle(m)!), members.map(selfThreadHandle).filter((h): h is string => h !== null)), { lastId: String(since), backlog, subject: `x-shard:${key}`, fast: members[0]!.config._aihot?.fast === true });
    const detail = { shard: key, accounts: members.length, pages: read.pages, truncated: read.truncated, backlog: read.backlog.length, backlogPages: read.backlogPages, dropped: read.dropped };
    const counts = new Map<string, { found: number; created: number; newest: string }>();
    for (const m of members) {
      const handle = shardHandle(m)!.toLowerCase();
      const mine = read.tweets.filter((t) => t.user.screen_name.toLowerCase() === handle);
      const stored = await store(m.id, admitListing(mine.map(tweetToCandidate), m), null);
      found += mine.length;
      created += stored.created;
      const newest = mine.reduce((a, t) => (BigInt(t.id_str) > BigInt(a) ? t.id_str : a), String(m.cursor!.lastTweetId));
      counts.set(m.id, { found: mine.length, created: stored.created, newest });
    }
    // A stretch left over before a regrouping still names accounts now in other shards, which hold no copy
    // of it and whose coverage has moved on: their posts go to them from here.
    const here = new Set(members.map((m) => shardHandle(m)!.toLowerCase()));
    const strays = read.tweets.filter((t) => !here.has(t.user.screen_name.toLowerCase()));
    if (strays.length) {
      const owners = await sql<SourceRow[]>`
        SELECT id, name, kind, config, tier, participation_mode, uses, first_party, interval_minutes, enabled, cursor, fail_count
        FROM sources WHERE enabled AND ${sharded()}`;
      for (const owner of owners) {
        const handle = shardHandle(owner)?.toLowerCase();
        const mine = strays.filter((t) => t.user.screen_name.toLowerCase() === handle);
        if (mine.length) created += (await store(owner.id, admitListing(mine.map(tweetToCandidate), owner), null)).created;
      }
    }
    // Only a fully stored search advances coverage. A failed write can replay every paid page;
    // material already committed is idempotent, and no member is left half-finished. The unread stretch
    // is written once, on the shard's first account: on every member it travelled with them when shards
    // were regrouped, and each shard then bought its own copy of the same pages.
    const keeper = members[0]!.id;
    await sql.begin(async tx => {
      for (const m of members) await lockSourceCursor(tx, m);
      for (const m of members) {
        const { newest, ...count } = counts.get(m.id)!;
        const cursor: Record<string, unknown> = { ...m.cursor, lastTweetId: newest, lastOkAt: new Date().toISOString() };
        if (read.backlog.length && m.id === keeper) cursor.xBacklog = read.backlog;
        else delete cursor.xBacklog;
        await recordFetch(tx, m.id, runs.get(m.id)!, { ...count, detail, cursor });
      }
      for (const receiptId of read.receiptIds) await completeReceipt(tx, receiptId);
    });
    return { key, status: "ok", accounts: members.length, found, created };
  } catch (error) {
    if (shutdownSignal.signal.aborted) throw error;
    const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
    if (error instanceof StaleSourceError) {
      for (const m of members) await sql`UPDATE fetch_runs SET status = 'failed', finished_at = now(), error = ${message} WHERE id = ${runs.get(m.id)!}`;
      return { key, status: "failed", accounts: members.length, found, created, error: message };
    }
    const budget = error instanceof BudgetExceededError;
    for (const m of members) {
      await recordFetch(sql, m.id, runs.get(m.id)!, { found: 0, created: 0, detail: { shard: key, accounts: members.length }, error: message, budget, rateLimited: (error instanceof HttpStatusError || error instanceof ProviderRejectedError) && error.status === 429 });
    }
    return { key, status: "failed", accounts: members.length, found, created, error: message };
  }
}

/** X accounts read by shard: a plain query and a watermark (the first fetch of an account is its own). */
const sharded = () => sql`kind = 'x_search' AND config->>'query' ~* ${SHARDABLE_SQL} AND coalesce(config->>'searchType', 'Latest') = 'Latest' AND cursor->>'lastTweetId' IS NOT NULL`;

/** Every minute: a shard is read when any of its accounts is due, all of them at once. */
async function scheduleXShards(): Promise<number> {
  const rows = await sql<Array<Pick<SourceRow, "id" | "kind" | "config" | "cursor" | "participation_mode"> & { due: boolean }>>`
    SELECT id, kind, config, cursor, participation_mode, (next_fetch_at IS NULL OR next_fetch_at <= now()) AS due
    FROM sources WHERE enabled AND ${sharded()}`;
  const due = new Set(rows.filter((r) => r.due).map((r) => r.id));
  let enqueued = 0;
  for (const shard of planXShards(rows)) {
    if (!shard.sourceIds.some((id) => due.has(id))) continue;
    const sent = await sql.begin(async (tx) => {
      const id = await enqueue(QUEUES.fetchXShard, { key: shard.key, sourceIds: shard.sourceIds }, { singletonKey: shard.key }, tx);
      if (id) await tx`UPDATE sources SET next_fetch_at = now() + make_interval(mins => CASE WHEN config->'_aihot'->>'fast' = 'true' THEN 1 ELSE interval_minutes END)
        WHERE id IN ${sql(shard.sourceIds)}`;
      return id;
    });
    if (sent) enqueued += 1;
  }
  return enqueued;
}

/** Every minute: enqueue due sources (enabled, not WeChat/external), oldest due first; X accounts by shard. */
export async function scheduleDueSources(): Promise<{ enqueued: number; shards: number }> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM sources
    WHERE enabled AND kind IN ('rss', 'web_list', 'json_list', 'x_search') AND (next_fetch_at IS NULL OR next_fetch_at <= now()) AND NOT (${sharded()})
    ORDER BY (config->'_aihot'->>'fast' = 'true') DESC NULLS LAST, next_fetch_at NULLS FIRST LIMIT 40`;
  let enqueued = 0;
  for (const r of rows) {
    const sent = await sql.begin(async (tx) => {
      const id = await enqueue(QUEUES.fetchSource, { sourceId: r.id }, { singletonKey: r.id }, tx);
      if (id) await tx`UPDATE sources SET next_fetch_at = now() + interval '10 minutes' WHERE id = ${r.id}`;
      return id;
    });
    if (sent) enqueued += 1;
  }
  return { enqueued, shards: await scheduleXShards() };
}

/** Minutes between reads of a shard: editorial accounts every half hour, hot-signal accounts hourly. */
const X_SHARD_MINUTES: Record<string, number> = { editorial: 30, hot_signal: 60 };
/** An account outside the news is read as often as its uses ask, hourly when none says. */
const shardMinutes = (mode: string, uses: readonly string[]) => X_SHARD_MINUTES[mode] ?? (Number.isFinite(usePace(uses)) ? usePace(uses) : 60);

/** Listings read through Jina, paid per read. */
const paidListing = sql`coalesce(config->>'url', '') LIKE 'https://r.jina.ai/%'`;
/** They are not looked at more than hourly: busy ones would outrun Jina's daily budget. */
const PAID_LISTING_FLOOR = 60;

/**
 * Daily: adapt each source's interval to its recent output (active 15 min … quiet 120 min).
 * hot_signal sources are allowed to be slower; the source's other uses may ask for it sooner.
 */
export async function adaptIntervals(): Promise<{ updated: number }> {
  const rows = await sql<Array<Pick<SourceRow, "id" | "participation_mode" | "uses" | "kind" | "config" | "cursor"> & { paid_listing: boolean; per_day: number }>>`
    SELECT s.id, s.participation_mode, s.uses, s.kind, s.config, s.cursor, ${paidListing} AS paid_listing,
      (SELECT count(*) FROM articles a WHERE a.source_id = s.id AND a.discovered_at > now() - interval '7 days' AND NOT a.backfill) / 7.0 AS per_day
    FROM sources s WHERE s.enabled AND s.kind IN ('rss', 'web_list', 'json_list', 'x_search')`;
  let updated = 0;
  for (const r of rows) {
    if (r.config._aihot?.fast === true && !r.paid_listing) continue;
    const perDay = Number(r.per_day);
    // Editorial sites and feeds are looked at hourly at least (they cost nothing);
    // editorial X and listings read through Jina stop at two hours (paid per call, within their budgets);
    // hot signals may wait longer.
    const max = r.participation_mode === "hot_signal" ? 180 : r.kind === "x_search" || r.paid_listing ? 120 : 60;
    const min = r.paid_listing ? PAID_LISTING_FLOOR : 15;
    // X accounts read by shard follow the shard's pace, whatever their own volume.
    const own = shardHandle(r) ? shardMinutes(r.participation_mode, r.uses) : perDay <= 0.15 ? max : Math.round(Math.min(max, Math.max(min, (24 * 60) / (perDay * 3))));
    // Another use may want the source sooner, never later, and a paid listing still waits its hour.
    const target = Math.max(min, Math.min(own, usePace(r.uses)));
    const res = await sql`UPDATE sources SET interval_minutes = ${target} WHERE id = ${r.id} AND interval_minutes <> ${target}`;
    updated += res.count;
  }
  return { updated };
}

/**
 * A source's uses just changed: from now it waits no longer than they allow, and no longer than that for its next
 * read. A faster pace it already has stays, and a paid listing still waits its hour; the next daily adaptation
 * weighs its output as usual. Kinds read on another trigger (WeChat accounts, outside reports) keep theirs.
 */
export async function applyUsePace(id: string): Promise<void> {
  const [s] = await sql<{ uses: string[]; interval_minutes: number; paid_listing: boolean }[]>`
    SELECT uses, interval_minutes, ${paidListing} AS paid_listing FROM sources WHERE id = ${id} AND kind IN ('rss', 'web_list', 'json_list', 'x_search')`;
  if (!s) return;
  const capped = Math.min(s.interval_minutes, usePace(s.uses));
  const target = s.paid_listing ? Math.max(PAID_LISTING_FLOOR, capped) : capped;
  await sql`UPDATE sources SET interval_minutes = ${target}, next_fetch_at = LEAST(coalesce(next_fetch_at, now()), now() + make_interval(mins => ${target}))
    WHERE id = ${id}`;
}
