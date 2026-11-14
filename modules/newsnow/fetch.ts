// Upstream adapter requests use the same guarded HTTP boundary as the rest of the collectors.
import { guardedFetch, HttpStatusError } from "@aihot/backend/lib/http-fetch";

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  query?: Record<string, string | number | boolean>;
  responseType?: "text" | "arrayBuffer" | "json";
  timeoutMs?: number;
  maxBytes?: number;
  ignoreResponseError?: boolean;
}

export interface FetchResponse {
  status: number;
  headers: Headers;
  data: unknown;
}

export async function fetchUrl(url: string, opts: FetchOptions = {}): Promise<FetchResponse> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(opts.query ?? {})) target.searchParams.set(key, String(value));
  const headers = { ...opts.headers };
  let body: string | undefined;
  if (typeof opts.body === "string") body = opts.body;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  }
  const response = await guardedFetch(target.href, {
    method: opts.method,
    headers,
    body,
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxBytes: opts.maxBytes ?? 4 * 1024 * 1024,
    maxRedirects: 5,
  });
  if (response.status !== 200 && !opts.ignoreResponseError) throw new HttpStatusError(response.status, `HTTP ${response.status} for ${target.host}`);
  return { status: response.status, headers: response.headers, data: decode(response.body, response.headers, opts.responseType) };
}

function decode(body: Buffer, headers: Headers, responseType: FetchOptions["responseType"]): unknown {
  if (responseType === "arrayBuffer") return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  const type = responseType ?? (headers.get("content-type") ?? "").toLowerCase();
  const text = body.toString("utf8");
  if (responseType === "text") return text;
  if (responseType === "json" || type.includes("json")) {
    if (!text.trim()) return null;
    try { return JSON.parse(text); } catch { return text; }
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}
