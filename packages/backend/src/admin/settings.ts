// Operator settings: about-page QR codes (replaced without a release), notification targets
// (switching a group on records enabled_at so older content is never back-filled) and per-service
// request budgets (the circuit breaker paid calls check before sending).
import type { AdminBudget, AdminEditorialSettings, AdminNotifyTarget, AdminSettings, BeforeJson } from "@aihot/contracts/admin";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { isCategoryKey } from "@aihot/contracts/taxonomy";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { loadContact, type ContactSettings } from "../site/contact.ts";
import { audit } from "../audit.ts";
import { clearEditorialSettings, editorialSettings } from "../editorial/config.ts";
import { registeredSelectionStrategies, registeredWritingStrategies } from "../editorial/analyze.ts";

const MAX_QR_BYTES = 2 * 1024 * 1024;

export async function replaceContactQr(input: { slot: keyof ContactSettings; data: Buffer }, actor: string) {
  if (input.slot !== "wechatQr" && input.slot !== "feishuQr") throw new Error("unknown slot");
  if (input.data.length > MAX_QR_BYTES) throw new Error("二维码图片最大 2MB");
  const meta = await sharp(input.data).metadata().catch(() => null);
  if (!meta || !["png", "jpeg", "webp"].includes(meta.format ?? "")) throw new Error("需要 PNG、JPG 或 WebP 图片");
  if ((meta.width ?? 0) < 120 || (meta.height ?? 0) < 120) throw new Error("图片太小，二维码可能扫不出来");
  const ext = meta.format === "jpeg" ? "jpg" : meta.format!;
  const name = `qr-${input.slot === "wechatQr" ? "wechat" : "feishu"}-${sha256(input.data).slice(0, 8)}.${ext}`;
  const dir = path.join(config.dataDir, "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), input.data);
  const before = await loadContact();
  const next = { ...before, [input.slot]: `/contact/${name}` };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('contact_qr', ${sql.json(next)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await audit(actor, "settings.contact_qr", "settings:contact_qr", null, { [input.slot]: before[input.slot] }, { [input.slot]: next[input.slot] });
  return next;
}

/** The settings page: contact QR codes, content push targets, paid-service budgets and the editorial strategies. */
export async function settingsOverview(): Promise<BeforeJson<AdminSettings>> {
  const [contact, targets, budgets, editorial] = await Promise.all([loadContact(), listTargets(), listBudgets(), editorialSettings()]);
  return {
    contact, targets, budgets, editorial,
    strategies: {
      selection: registeredSelectionStrategies().map(({ id, label }) => ({ id, label })),
      writing: registeredWritingStrategies().map(({ id, label }) => ({ id, label })),
    },
  };
}

export async function listTargets(): Promise<BeforeJson<AdminNotifyTarget>[]> {
  return sql<BeforeJson<AdminNotifyTarget>[]>`
    SELECT t.key, t.purpose, t.kind, t.enabled, t.enabled_at, t.config_ref, t.note, t.updated_at,
           (SELECT count(*)::int FROM deliveries d WHERE d.target_key = t.key AND d.created_at > now() - interval '7 days') AS deliveries_7d,
           (SELECT max(d.sent_at) FROM deliveries d WHERE d.target_key = t.key) AS last_sent_at
    FROM notify_targets t ORDER BY t.purpose, t.key`;
}

export async function setTargetEnabled(key: string, enabled: boolean, reason: string, actor: string) {
  if (!reason?.trim()) throw new Error("reason is required");
  const [before] = await sql`SELECT enabled, enabled_at FROM notify_targets WHERE key = ${key}`;
  if (!before) return null;
  const [after] = await sql`
    UPDATE notify_targets SET enabled = ${enabled}, enabled_at = CASE WHEN ${enabled} AND NOT enabled THEN now() ELSE enabled_at END, updated_at = now()
    WHERE key = ${key} RETURNING key, enabled, enabled_at`;
  await audit(actor, enabled ? "notify.enable" : "notify.disable", `notify-target:${key}`, reason, before, after);
  return { ...after, pushEnabledHere: config.feishuContentPushEnabled };
}

export async function listBudgets(): Promise<BeforeJson<AdminBudget>[]> {
  return sql<BeforeJson<AdminBudget>[]>`
    SELECT b.service, b.per_minute, b.per_hour, b.per_day, b.note, b.updated_at,
           (SELECT count(*)::int FROM receipt_attempts a WHERE a.service = b.service AND a.origin = 'live' AND a.started_at > now() - interval '1 day') AS used_day,
           (SELECT count(*)::int FROM receipt_attempts a WHERE a.service = b.service AND a.origin = 'live' AND a.started_at > now() - interval '1 hour') AS used_hour
    FROM budgets b ORDER BY b.service`;
}

export async function updateBudget(service: string, input: { perMinute: number; perHour: number; perDay: number; reason: string }, actor: string) {
  if (!input.reason?.trim()) throw new Error("reason is required");
  for (const v of [input.perMinute, input.perHour, input.perDay]) if (!Number.isInteger(v) || v < 0) throw new Error("budgets are non-negative integers (0 stops the service)");
  const [before] = await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = ${service}`;
  const [after] = await sql`
    INSERT INTO budgets (service, per_minute, per_hour, per_day, note) VALUES (${service}, ${input.perMinute}, ${input.perHour}, ${input.perDay}, ${input.reason})
    ON CONFLICT (service) DO UPDATE SET per_minute = EXCLUDED.per_minute, per_hour = EXCLUDED.per_hour, per_day = EXCLUDED.per_day, note = EXCLUDED.note, updated_at = now()
    RETURNING service, per_minute, per_hour, per_day`;
  await audit(actor, "budget.update", `budget:${service}`, input.reason, before ?? null, after);
  return after;
}

const term = (max: number) => z.string().trim().min(1).max(max);
const sourceId = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,79}$/, "信源 ID 只能用小写字母、数字、连字符和下划线");
const EditorialSettingsSchema = z
  .object({
    selection: term(60),
    writing: term(60),
    rules: z
      .object({
        keywords: z.array(term(80)).max(200),
        excludeKeywords: z.array(term(80)).max(200),
        sources: z.array(sourceId).max(200),
        excludeSources: z.array(sourceId).max(200),
        symbols: z.array(term(40)).max(200),
        lookbackHours: z.number().int().min(1).max(720).nullable(),
        category: z.string().max(40).nullable().refine((v) => v === null || isCategoryKey(v), "不是行业分类"),
        tags: z.array(term(40)).max(30),
      })
      .strict(),
    webai: z
      .object({
        enabled: z.boolean(),
        sites: z.array(term(40)).max(10),
        profile: z.string().trim().max(40).nullable(),
        timeoutSeconds: z.number().int().min(30).max(600),
      })
      .strict(),
  })
  .strict();

/** Which registered strategies select and write, and the rule filter's terms; the change applies to the next analysis. */
export async function updateEditorialSettings(input: unknown, actor: string): Promise<AdminEditorialSettings> {
  const next = EditorialSettingsSchema.parse(input);
  const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
  if (!registeredSelectionStrategies().some((s) => s.id === next.selection)) throw bad(`没有筛选方式 ${next.selection}`);
  if (!registeredWritingStrategies().some((s) => s.id === next.writing)) throw bad(`没有写作方式 ${next.writing}`);
  const before = await editorialSettings();
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('editorial.strategy', ${sql.json(next as never)}, ${actor})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  clearEditorialSettings();
  await audit(actor, "settings.editorial", "settings:editorial.strategy", null, before, next);
  return next;
}
