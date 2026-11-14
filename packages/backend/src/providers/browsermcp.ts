import net from "node:net";
import { credential } from "../config.ts";

/** The browser is disconnected or busy; the article must wait rather than become unconfirmed. */
export class BrowserMcpUnavailable extends Error {
  constructor() { super("BrowserMCP reader unavailable"); }
}

/** Reads only a source's approved post body through the host's restricted socket. */
export async function browserMcpBody(source: string, url: string): Promise<{ html: string; date: string | null } | null> {
  const socketPath = credential("collectors", "BROWSERMCP_BRIDGE_SOCKET");
  if (!socketPath) throw new BrowserMcpUnavailable();
  const { promise, resolve, reject } = Promise.withResolvers<{ html: string; date: string | null } | null>();
  const socket = net.createConnection(socketPath);
  let buffer = "";
  let done = false;
  const finish = (value: { html: string; date: string | null } | null | BrowserMcpUnavailable) => {
    if (done) return;
    done = true;
    socket.destroy();
    if (value instanceof BrowserMcpUnavailable) reject(value);
    else resolve(value);
  };
  const unavailable = () => finish(new BrowserMcpUnavailable());
  socket.setEncoding("utf8");
  socket.setTimeout(35_000, unavailable);
  socket.on("error", unavailable);
  socket.on("close", () => { if (!done) unavailable(); });
  socket.on("connect", () => socket.write(JSON.stringify({ source, url }) + "\n"));
  socket.on("data", chunk => {
    buffer += chunk;
    if (buffer.length > 120_000) return unavailable();
    const end = buffer.indexOf("\n");
    if (end < 0) return;
    try {
      const value = JSON.parse(buffer.slice(0, end));
      if (value.ok === false && ["invalid", "no_content", "too_large"].includes(value.code)) return finish(null);
      if (value.ok !== true || value.url !== url || typeof value.html !== "string" || value.html.length > 48_000
        || !(value.date === null || typeof value.date === "string")) return unavailable();
      finish({ html: value.html, date: value.date });
    } catch { unavailable(); }
  });
  return promise;
}

/** A public Linux DO listing, read only through the host's two fixed listing rules. */
export async function browserLinuxDo(mode: "latest" | "hot"): Promise<Array<{ id: string; title: string; url: string; publishedAt: string | null }> | null> {
  const socketPath = credential("collectors", "BROWSERMCP_BRIDGE_SOCKET");
  if (!socketPath) return null;
  const url = mode === "latest" ? "https://linux.do/latest?order=created" : "https://linux.do/top?period=daily";
  const source = `newsnow-linuxdo-${mode}`;
  const { promise, resolve, reject } = Promise.withResolvers<Array<{ id: string; title: string; url: string; publishedAt: string | null }>>();
  const socket = net.createConnection(socketPath);
  let buffer = "";
  let done = false;
  const fail = () => { if (!done) { done = true; socket.destroy(); reject(new BrowserMcpUnavailable()); } };
  socket.setEncoding("utf8");
  socket.setTimeout(35_000, fail);
  socket.on("error", fail);
  socket.on("close", fail);
  socket.on("connect", () => socket.write(JSON.stringify({ source, url }) + "\n"));
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 120_000) return fail();
    const end = buffer.indexOf("\n");
    if (end < 0) return;
    try {
      const value = JSON.parse(buffer.slice(0, end));
      if (value.ok !== true || value.url !== url || !Array.isArray(value.items) || value.items.length > 50) return fail();
      const items = value.items.map((item: Record<string, unknown>) => {
        if (typeof item.id !== "string" || !/^\d+$/.test(item.id) || item.url !== `https://linux.do/t/topic/${item.id}`
          || typeof item.title !== "string" || !item.title.trim() || item.title.length > 2000
          || !(item.publishedAt === null || typeof item.publishedAt === "string" && Number.isFinite(Date.parse(item.publishedAt)))) throw new Error("invalid topic");
        return { id: item.id, title: item.title, url: item.url as string, publishedAt: mode === "hot" ? null : item.publishedAt as string | null };
      });
      done = true;
      socket.destroy();
      resolve(items);
    } catch { fail(); }
  });
  return promise;
}

/** The approved Truth Social account's official API, read in the local browser session. */
export async function browserTruthSocial(url: string): Promise<unknown[] | null> {
  const socketPath = credential("collectors", "BROWSERMCP_BRIDGE_SOCKET");
  if (!socketPath) return null;
  const { promise, resolve, reject } = Promise.withResolvers<unknown[]>();
  const socket = net.createConnection(socketPath);
  let buffer = "";
  let done = false;
  const fail = () => { if (!done) { done = true; socket.destroy(); reject(new BrowserMcpUnavailable()); } };
  socket.setEncoding("utf8");
  socket.setTimeout(35_000, fail);
  socket.on("error", fail);
  socket.on("close", fail);
  socket.on("connect", () => socket.write(JSON.stringify({ source: "truthsocial-donald-trump", url }) + "\n"));
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.length > 120_000) return fail();
    const end = buffer.indexOf("\n");
    if (end < 0) return;
    try {
      const value = JSON.parse(buffer.slice(0, end));
      if (value.ok !== true || value.url !== url || !Array.isArray(value.items) || value.items.length > 40) return fail();
      done = true;
      socket.destroy();
      resolve(value.items);
    } catch { fail(); }
  });
  return promise;
}
