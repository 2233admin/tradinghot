// Free web chat UIs through opencli (Kimi, 千问, 元宝…): one natural prompt in, the assistant's
// reply out. Calls are serialized and spaced so the site does not see a burst; a site that fails is
// rested for a while, and the next configured site takes the request.
import { z } from "zod";
import { openCliProfile, runOpenCli } from "./opencli.ts";

/** One row of `opencli <site> ask -f json`: the prompt as a User row, the answer as an Assistant row. */
const OpenCliRow = z.object({ Role: z.string().optional(), Text: z.string() }).passthrough();
const OpenCliOutput = z.union([z.array(OpenCliRow), OpenCliRow]);

export interface WebAiTransport {
  sites: string[];
  /** The Browser Bridge profile opencli uses (needed when more than one is connected). */
  profile: string | null;
  /** Seconds to wait for one assistant reply. */
  timeoutSeconds: number;
}

export interface WebAiAnswer {
  site: string;
  text: string;
}

/** Sites rest this long after any failure (login lost, adapter changed, risk-control page). */
const SITE_REST_MS = 10 * 60_000;
/** Minimum gap between two requests, whatever the site. */
const MIN_GAP_MS = 15_000;

const resting = new Map<string, number>();
let chain: Promise<unknown> = Promise.resolve();
let lastAskedAt = 0;
/** The site that answered last: it goes first next time, so a broken one is not tried every request. */
let preferred: string | null = null;

/** The assistant's text from opencli's JSON rows (User rows are the prompt itself). */
export function replyFrom(stdout: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  const parsed = OpenCliOutput.safeParse(raw);
  if (!parsed.success) return null;
  const rows = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const text = rows
    .filter((row) => row.Role?.toLowerCase() !== "user" && row.Role?.toLowerCase() !== "human")
    .map((row) => row.Text)
    .join("\n")
    .trim();
  return text || null;
}

async function callOpenCli(args: string[], timeoutMs: number): Promise<string> {
  return runOpenCli(args, timeoutMs);
}

async function askOneSite(site: string, prompt: string, t: WebAiTransport): Promise<string> {
  const common = [...openCliProfile(t.profile), site];
  const timeoutMs = (t.timeoutSeconds + 60) * 1000;
  // The web composer keeps only the first line of what the adapter types, so the prompt goes in flat.
  const flatPrompt = prompt.replace(/\s+/g, " ").trim();
  // A fresh chat keeps one article's context out of the next; qwen takes that as a flag on ask itself.
  if (site !== "qwen") await callOpenCli([...common, "new", "-f", "json"], 60_000).catch(() => "");
  // No web search for a rewrite.
  const siteFlags = site === "qwen" ? ["--new", "true"] : site === "yuanbao" ? ["--search", "false"] : [];
  const stdout = await callOpenCli([...common, "ask", flatPrompt, "-f", "json", "--timeout", String(t.timeoutSeconds), ...siteFlags], timeoutMs);
  const reply = replyFrom(stdout);
  if (!reply) throw new Error(`${site}: no assistant reply in opencli output`);
  return reply;
}

/**
 * Asks the configured sites, one request at a time. The site that answered last goes first; a
 * failure rests that site for a while, and the next configured site takes the request.
 */
export function askWebAi(prompt: string, t: WebAiTransport): Promise<WebAiAnswer> {
  const pending = chain.then(async () => {
    const sites = t.sites.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!sites.length) throw new Error("no web ai site configured");
    const ordered = preferred && sites.includes(preferred) ? [preferred, ...sites.filter((s) => s !== preferred)] : sites;
    const now = Date.now();
    const wait = Math.max(0, lastAskedAt + MIN_GAP_MS - now);
    if (wait) {
      const pause = Promise.withResolvers<void>();
      setTimeout(pause.resolve, wait);
      await pause.promise;
    }
    const errors: string[] = [];
    for (const site of ordered) {
      if ((resting.get(site) ?? 0) > Date.now()) continue;
      try {
        lastAskedAt = Date.now();
        const text = await askOneSite(site, prompt, t);
        preferred = site;
        return { site, text };
      } catch (error) {
        resting.set(site, Date.now() + SITE_REST_MS);
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${site}: ${message.split("\n")[0]}`);
      }
    }
    throw new Error(errors.length ? `web ai sites failed: ${errors.join("; ")}` : "every web ai site is resting");
  });
  chain = pending.catch(() => undefined);
  return pending;
}
