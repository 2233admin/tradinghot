// Cleaning by a free web chat UI (stated in industry/prompts/web-clean.md): the selected material
// becomes a Chinese title, summary and reason. The transport is providers/webai.ts.
import { z } from "zod";
import { promptText } from "./prompts.ts";
import type { AnalyzeInputArticle } from "./input.ts";

const CleanAnswer = z.object({ title: z.string(), summary: z.string(), reason: z.string().optional() });

export interface CleanCopy {
  title: string;
  summary: string;
  reason: string | null;
}

const BODY_CHARS = 2500;

export function buildWebCleanPrompt(a: AnalyzeInputArticle): string {
  const title = a.xPost ? String(a.xPost.text ?? a.title) : a.title;
  const body = (a.bodyText ?? a.excerpt ?? "").replace(/\s+/g, " ").trim().slice(0, BODY_CHARS);
  return [
    promptText("web-clean"),
    `来源：${a.source.name}`,
    `发布：${a.publishedAt ? a.publishedAt.toISOString() : "未知"}`,
    `原文标题：${title}`,
    `正文：\n${body || "（只有标题）"}`,
  ].join("\n");
}

/** The JSON object inside the reply, tolerating code fences or a sentence around it. */
export function parseWebCleanAnswer(reply: string): CleanCopy {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("网页 AI 没有返回 JSON");
  const parsed = CleanAnswer.safeParse(JSON.parse(reply.slice(start, end + 1)));
  if (!parsed.success) throw new Error(`网页 AI 返回的字段不对：${parsed.error.issues[0]?.message ?? ""}`);
  const title = parsed.data.title.trim();
  const summary = parsed.data.summary.trim();
  if (!title || !summary) throw new Error("网页 AI 的标题或摘要为空");
  return { title: title.slice(0, 80), summary: summary.slice(0, 300), reason: parsed.data.reason?.trim() || null };
}
