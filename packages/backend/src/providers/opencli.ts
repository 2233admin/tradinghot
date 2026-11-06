// opencli runs the browser the user is already logged into. One entry point, no shell.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** opencli's own entry point, so arguments are not parsed by a shell. */
export function openCli(): { command: string; base: string[] } {
  const configured = process.env.OPENCLI_BIN;
  if (configured) return /\.(c|m)?js$/.test(configured) ? { command: process.execPath, base: [configured] } : { command: configured, base: [] };
  const npmRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules")
    : path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
  const entry = path.join(npmRoot, "@jackwener", "opencli", "dist", "src", "main.js");
  return existsSync(entry) ? { command: process.execPath, base: [entry] } : { command: "opencli", base: [] };
}

export async function runOpenCli(args: string[], timeoutMs: number): Promise<string> {
  const { command, base } = openCli();
  const { stdout } = await run(command, [...base, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  return stdout;
}

/** `--profile` for a named Browser Bridge context; the adapter's default profile otherwise. */
export function openCliProfile(profile: string | null | undefined): string[] {
  return profile ? ["--profile", profile] : [];
}
