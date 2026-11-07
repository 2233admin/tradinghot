// Reads a page through the opencli browser: the site's own session, its cookies and its anti-bot state.
// A JSON endpoint is opened as the tab itself, and the page's text is the response body; an HTML listing
// that needs the same session is read as the document's markup.
import { openCliProfile, runOpenCli } from "./opencli.ts";

export interface BrowserReadOptions {
  /** Browser Bridge profile; omitted uses opencli's default (or OPENCLI_PROFILE). */
  profile?: string | null;
  /** Session name; one session per source keeps two polls from driving the same tab. */
  session: string;
  timeoutMs?: number;
  /** Release the tab after reading: one article's body needs no tab to stay open. */
  closeAfter?: boolean;
  /** How long to wait for a challenge page to fill in (tests run without the pause). */
  readyPauseMs?: number;
  readyAttempts?: number;
}

const clean = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "").trim();
const READY = "document.body.innerText";
/** A JavaScript challenge rewrites the page a few seconds after the first paint. */
const READY_ATTEMPTS = 8;
const READY_PAUSE_MS = 2500;

/**
 * Opens `url` in the source's own tab and returns what `expr` evaluates to once the page has content.
 * The wait is what makes a WAF page work: the challenge's first HTML has no text, and reading it is the
 * error a direct fetch would report.
 */
async function browserExpression(url: string, expr: string, opts: BrowserReadOptions): Promise<string> {
  const timeout = opts.timeoutMs ?? 120_000;
  // Several Browser Bridge profiles can be connected at once, and then opencli refuses to pick one.
  const profile = openCliProfile(opts.profile ?? process.env.OPENCLI_PROFILE ?? null);
  const session = opts.session.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "source";
  const run = (...args: string[]) => runOpenCli([...profile, "browser", session, ...args], timeout);
  try {
    await run("open", url, "--window", "background");
    let ready = "";
    for (let attempt = 0, tries = opts.readyAttempts ?? READY_ATTEMPTS; attempt < tries && !ready; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, opts.readyPauseMs ?? READY_PAUSE_MS));
      ready = clean(await run("eval", READY));
    }
    // A blocked or error page is not a body: the caller turns it into a fetch error with the site's words.
    if (!ready) throw new Error("browser page is empty");
    return expr === READY ? ready : clean(await run("eval", expr));
  } finally {
    // A failed open may still have taken the tab; closing is best-effort and must not mask the error.
    if (opts.closeAfter) await run("close").catch(() => "");
  }
}

/** The response body of `url`, as the browser's page text after opening it. */
export function browserJson(url: string, opts: BrowserReadOptions): Promise<string> {
  return browserExpression(url, READY, opts);
}

/** The markup of `url` after the page has run, for a listing behind a JavaScript challenge. */
export function browserHtml(url: string, opts: BrowserReadOptions): Promise<string> {
  return browserExpression(url, "document.documentElement.outerHTML", opts);
}
