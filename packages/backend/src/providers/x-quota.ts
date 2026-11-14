// The X session is shared: X limits how many searches one logged-in session may start, and a refusal
// costs the whole session a long cooldown. Every reader of that session counts here — opencli's
// twitter adapter and Kaze's own X adapter — so one account's search cannot spend the next one's.
/** Searches one session may start in an hour. Sixty accounts read every two hours need thirty. */
export const BROWSER_X_SEARCHES_PER_HOUR = 40;
/** How long the session rests after X refused a search (opencli's own advice: 15-30 minutes). */
export const BROWSER_X_COOLDOWN_MS = 15 * 60_000;
/** The smallest gap between two searches of the session, so a burst never looks like scraping. */
const BROWSER_X_MIN_GAP_MS = 3_000;
const HOUR_MS = 3_600_000;

/**
 * The session cannot search right now: its quota is spent, or it rests after a refusal. No account
 * is at fault, so the collector records a throttle instead of a failed source.
 */
export class BrowserXThrottleError extends Error {
  /** When the session may search again. */
  readonly until: number;
  constructor(message: string, until: number) {
    super(message);
    this.until = until;
  }
}

export interface BrowserXQuota {
  /** Searches the session may still start in this hour. */
  remaining: number;
  /** When the session may search again after a refusal. */
  cooldownUntil: number;
}

let windowStart = Date.now();
let searchesThisWindow = 0;
let lastSearchAt = 0;
let cooldownUntil = 0;
/** Permits are handed out one at a time, so two workers never start a search at the same moment. */
let permits: Promise<unknown> = Promise.resolve();

/** What the session may still do: the searches left in this hour and when it rests. */
export function browserXQuota(now = Date.now()): BrowserXQuota {
  if (now - windowStart >= HOUR_MS) {
    windowStart = now;
    searchesThisWindow = 0;
  }
  return { remaining: Math.max(0, BROWSER_X_SEARCHES_PER_HOUR - searchesThisWindow), cooldownUntil };
}

/**
 * The session's own state is cleared: a new login or a fresh quota window starts the hour over, and the
 * rest after a refusal ends with it.
 */
export function resetBrowserXSession(): void {
  windowStart = Date.now();
  searchesThisWindow = 0;
  lastSearchAt = 0;
  cooldownUntil = 0;
}

/** X refused a search: the quota it spent is the session's, so the whole session rests. */
export function restBrowserXSession(now = Date.now()): void {
  cooldownUntil = now + BROWSER_X_COOLDOWN_MS;
}

const sleep = async (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
};

/** Waits for the session's turn: outside a cooldown, inside this hour's budget, and spaced out. */
export async function permitBrowserXSearch(): Promise<void> {
  const turn = permits.then(async () => {
    const now = Date.now();
    if (now < cooldownUntil) {
      throw new BrowserXThrottleError(`browser X session rests until ${new Date(cooldownUntil).toISOString()}`, cooldownUntil);
    }
    if (browserXQuota(now).remaining <= 0) {
      throw new BrowserXThrottleError("browser X session search budget for this hour is spent", windowStart + HOUR_MS);
    }
    const gap = lastSearchAt + BROWSER_X_MIN_GAP_MS - now;
    if (gap > 0) await sleep(gap);
    lastSearchAt = Date.now();
    searchesThisWindow += 1;
  });
  permits = turn.then(() => undefined, () => undefined);
  await turn;
}
