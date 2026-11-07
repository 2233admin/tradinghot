// Reads a page through the opencli browser: the site's own session, its cookies and its anti-bot state.
// A JSON endpoint is opened as the tab itself, and the page's text is the response body.
import { openCliProfile, runOpenCli } from "./opencli.ts";

export interface BrowserReadOptions {
  /** Browser Bridge profile; omitted uses opencli's default (or OPENCLI_PROFILE). */
  profile?: string | null;
  /** Session name; one session per source keeps two polls from driving the same tab. */
  session: string;
  timeoutMs?: number;
}

const clean = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "").trim();

/** The response body of `url`, as the browser's page text after opening it. */
export async function browserJson(url: string, opts: BrowserReadOptions): Promise<string> {
  const timeout = opts.timeoutMs ?? 120_000;
  // Several Browser Bridge profiles can be connected at once, and then opencli refuses to pick one.
  const profile = openCliProfile(opts.profile ?? process.env.OPENCLI_PROFILE ?? null);
  const session = opts.session.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40) || "source";
  await runOpenCli([...profile, "browser", session, "open", url, "--window", "background"], timeout);
  const text = clean(await runOpenCli([...profile, "browser", session, "eval", "document.body.innerText"], timeout));
  // A blocked or error page is not a body: the caller turns it into a fetch error with the site's words.
  if (!text) throw new Error("browser page is empty");
  return text;
}
