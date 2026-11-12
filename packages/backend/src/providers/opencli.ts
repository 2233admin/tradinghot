// opencli runs the browser the user is already logged into. One entry point, no shell.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { credential } from "../config.ts";

const run = promisify(execFile);

/**
 * Where npm installs global packages when it is not under the runtime: Windows keeps them in
 * %APPDATA%\npm, other platforms beside the runtime's own library folder.
 */
function globalModuleRoot(): string {
  const besideRuntime = path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
  if (process.platform !== "win32") return besideRuntime;
  const appData = path.join(os.homedir(), "AppData", "Roaming");
  return existsSync(path.join(appData, "npm", "node_modules")) ? path.join(appData, "npm", "node_modules") : besideRuntime;
}

/** opencli's own entry point, so arguments are not parsed by a shell. */
export function openCli(): { command: string; base: string[] } {
  const configured = credential("collectors", "OPENCLI_BIN");
  if (configured) return /\.(c|m)?js$/.test(configured) ? { command: process.execPath, base: [configured] } : { command: configured, base: [] };
  const entry = path.join(globalModuleRoot(), "@jackwener", "opencli", "dist", "src", "main.js");
  return existsSync(entry) ? { command: process.execPath, base: [entry] } : { command: "opencli", base: [] };
}

// A normal browser command remains exclusive. Two X searches may run together because opencli
// gives each search an ephemeral session; commands queued behind them still run before later searches.
let queue: Promise<unknown> = Promise.resolve();
const searches: Promise<unknown>[] = [Promise.resolve(), Promise.resolve()];
let nextSearch = 0;

export async function runOpenCli(args: string[], timeoutMs: number, opts: { parallelXSearch?: boolean } = {}): Promise<string> {
  const { command, base } = openCli();
  // Raise opencli's own command timeout for searches that must wait on the browser bridge.
  const runOne = async () => {
    try {
      const { stdout } = await run(command, [...base, ...args], {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, OPENCLI_BROWSER_COMMAND_TIMEOUT: process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT ?? "180" },
      });
      return stdout;
    } catch (error) {
      const e = error as { stderr?: string; stdout?: string; message?: string };
      const detail = [e.stderr, e.stdout].map((s) => (s ?? "").trim()).filter(Boolean).join("\n");
      throw new Error(`opencli failed: ${(detail || e.message || "unknown error").replace(/\s+/g, " ").slice(0, 600)}`);
    }
  };
  if (opts.parallelXSearch) {
    const slot = nextSearch;
    nextSearch = (nextSearch + 1) % searches.length;
    const next = Promise.all([queue, searches[slot]]).then(runOne);
    searches[slot] = next.then(() => undefined, () => undefined);
    return next;
  }
  const next = Promise.all([queue, ...searches]).then(runOne);
  queue = next.then(() => undefined, () => undefined);
  return next;
}

/** `--profile` for a named Browser Bridge context; the adapter's default profile otherwise. */
export function openCliProfile(profile: string | null | undefined): string[] {
  return profile ? ["--profile", profile] : [];
}
