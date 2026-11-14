// X reads through Kaze: its own browser, with the user signed in, and its own X adapter
// (sites.twitter.search), which reads the same search the signed-in web UI makes. Kaze's BrowserMCP
// server answers over a unix socket; the bridge it writes next to it speaks MCP over stdio, so an
// outside agent (this collector) reaches it the same way Claude Code or Codex would.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { credential } from "../config.ts";
import type { SdTweet } from "./socialdata.ts";
import { adapterRowToTweet, type XAdapterRow } from "./x-adapter.ts";
import { permitBrowserXSearch, restBrowserXSession } from "./x-quota.ts";

/** Where Kaze writes the MCP launcher for outside agents (Kaze writes it on every start). */
const DEFAULT_MCP = "~/.config/Kite/bin/kaze-mcp";

function mcpLauncher(): string {
  const configured = credential("collectors", "KAZE_MCP");
  return (configured ?? DEFAULT_MCP).replace(/^~/, process.env.HOME ?? "~");
}

/**
 * How the collector reaches Kaze's MCP server: over the host's relay socket when one is
 * configured (the worker container cannot reach the desktop), over Kaze's own launcher when
 * the collector runs where Kaze does.
 */
function mcpTransport(): StdioClientTransport {
  const socket = credential("collectors", "KAZE_MCP_SOCKET");
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  if (!socket) return new StdioClientTransport({ command: mcpLauncher(), args: [], env });
  const shim = path.resolve(fileURLToPath(import.meta.url), "../../../../scripts/kaze-mcp-stdio.mjs");
  return new StdioClientTransport({ command: process.execPath, args: [shim], env: { ...env, KAZE_MCP_SOCKET: socket.replace(/^~/, process.env.HOME ?? "~") } });
}

/** Kaze's own X adapter: one tweet as the adapter reads it out of the search timeline. */
export interface KazeSearchOptions {
  /** X search query (`from:handle -filter:replies`). */
  query: string;
  limit: number;
  timeoutMs?: number;
}

/**
 * One search through Kaze's own X adapter. The session's hour of searches is counted here as well:
 * Kaze's browser is the same logged-in X session, and X's quota belongs to that session.
 */
export async function searchTweetsInKaze(opts: KazeSearchOptions): Promise<SdTweet[]> {
  await permitBrowserXSearch();
  // Kaze's own launcher for outside agents: it speaks MCP over stdio and opens Kaze when a request
  // needs it. It also carries Kaze's own guard (Settings > External Agents).
  const transport = mcpTransport();
  const client = new Client({ name: "aihot-x", version: "1.0.0" });
  try {
    await client.connect(transport);
    const code = `await sites.twitter.search(${JSON.stringify({ query: opts.query, limit: opts.limit, sort: "latest" })})`;
    const result = await client.callTool({ name: "js", arguments: { code, timeoutMs: opts.timeoutMs ?? 90_000, maxChars: 400_000 } });
    const text = result.content?.find((c) => c.type === "text")?.text ?? "";
    let payload: { ok?: boolean; value?: { rows?: XAdapterRow[] }; error?: { code?: string; message?: string } };
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Kaze's X adapter answered with something that is not JSON");
    }
    if (!payload.ok) {
      const message = payload.error?.message ?? "Kaze's X adapter refused the search";
      // A refusal by X is the session's quota, so the whole session rests.
      if (/rate|quota|429/i.test(message)) restBrowserXSession();
      throw new Error(message);
    }
    return (payload.value?.rows ?? []).map(adapterRowToTweet);
  } finally {
    await client.close().catch(() => {});
  }
}
