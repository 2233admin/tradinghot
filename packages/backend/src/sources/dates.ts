// Published dates as list pages, articles and JSON lists print them, read the same on every host.
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import type { SourceRow } from "./types.ts";

/** The offset a source's article pages print their dates in: its detail rules' own, else its listing's. */
export function articleUtcOffset(config: SourceRow["config"]): string | undefined {
  return config.detail?.publishedAtUtcOffset ?? config.publishedAtUtcOffset;
}

/**
 * A time followed by its zone: "10:00Z", "10:00:00+08:00", "10:00:00 +0000", "10:00 PM GMT", "10:00 EST".
 * CST is no zone here: Date.parse reads US Central, Chinese pages mean China, so it is read in the source's offset.
 */
const EXPLICIT_ZONE = /\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AP]M\s*)?(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC?|[EMP][SD]T|CDT)\b/i;

function calendarDay(y: string | number, mo: string | number, d: string | number): boolean {
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
}

function atOffset(y: string | number, mo: string | number, d: string | number, h: string | number, mi: string | number, s: string | number, utcOffset: string): Date | null {
  if (!calendarDay(y, mo, d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  const p = (n: string | number) => String(n).padStart(2, "0");
  if (isZoneName(utcOffset)) {
    // A named zone (America/New_York) keeps its own daylight-saving rule, so the wall-clock time
    // is turned into an instant with the zone's offset at that moment.
    try {
      const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
      const first = wall - zoneOffsetMinutes(utcOffset, new Date(wall)) * 60000;
      const second = wall - zoneOffsetMinutes(utcOffset, new Date(first)) * 60000;
      const at = new Date(second);
      return Number.isFinite(at.getTime()) ? at : null;
    } catch {
      return null;
    }
  }
  const t = Date.parse(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}${utcOffset}`);
  return Number.isFinite(t) ? new Date(t) : null;
}

const DAY_MS = 86400000;

/** True when the offset names a time zone (America/New_York) instead of a fixed offset (-05:00). */
function isZoneName(utcOffset: string): boolean {
  return !/^[+-]\d{2}:?\d{2}$/.test(utcOffset) && utcOffset !== "Z" && utcOffset !== "UTC";
}

/** A named zone's offset from UTC at that moment, in minutes (east of Greenwich is positive). */
function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((wall - at.getTime()) / 60000);
}

/** The calendar day before the one named, as the same year, month and day. */
function dayBefore(y: number, mo: number, d: number): { y: number; mo: number; d: number } {
  const previous = new Date(Date.UTC(y, mo - 1, d) - DAY_MS);
  return { y: previous.getUTCFullYear(), mo: previous.getUTCMonth() + 1, d: previous.getUTCDate() };
}

/** The current moment in a source's own offset: its year, month, day, hour and minute. */
function nowInOffset(utcOffset: string, now = new Date(Date.now())): { y: number; mo: number; d: number; h: number; mi: number } {
  if (isZoneName(utcOffset)) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: utcOffset, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
  }
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(utcOffset);
  const minutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : -now.getTimezoneOffset();
  const t = new Date(now.getTime() + minutes * 60000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

/**
 * A published date as a source prints it. Date.parse is kept only where it reads the same
 * on every host: a time with its zone. A calendar day always belongs to the source, including ISO date-only text. Anything else it would read
 * in the server's local zone (UTC in Docker), so "2026-09-26 10:00" is read in the source's offset instead.
 */
export function parseLooseDate(value: string | null | undefined, utcOffset = "+08:00"): Date | null {
  if (!value) return null;
  // "Sep 26, 2026 at 10:30": "at" joins a date and its time like a space.
  const v = value.trim().replace(/(\d),?\s+at\s+(?=\d{1,2}:\d{2})/gi, "$1 ");
  if (!v) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (compact) return atOffset(compact[1]!, compact[2]!, compact[3]!, compact[4]!, compact[5]!, compact[6]!, utcOffset);
  // A month and day without a year means the most recent such moment, including Chinese list dates.
  const monthDay = /^(?:(\d{1,2})-(\d{1,2})|(\d{1,2})月(\d{1,2})日)[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (monthDay) {
    const mo = Number(monthDay[1] ?? monthDay[3]), day = Number(monthDay[2] ?? monthDay[4]), hour = Number(monthDay[5]), minute = Number(monthDay[6]), second = Number(monthDay[7] ?? 0);
    const now = nowInOffset(utcOffset);
    const thisYear = atOffset(now.y, mo, day, hour, minute, second, utcOffset);
    if (!thisYear) return null;
    const reference = atOffset(now.y, now.mo, now.d, now.h, now.mi, 0, utcOffset) ?? new Date();
    if (thisYear.getTime() - reference.getTime() > DAY_MS) return atOffset(now.y - 1, mo, day, hour, minute, second, utcOffset);
    return thisYear;
  }
  // A listing that prints only the time of day ("07:08PM") means the most recent such moment:
  // today at that time, or yesterday when today's moment has not come yet.
  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i.exec(v);
  if (clock) {
    const meridiem = clock[4]?.toUpperCase();
    let hour = Number(clock[1]);
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = hour % 12 + (meridiem === "PM" ? 12 : 0);
    } else if (hour > 23) return null;
    const minute = Number(clock[2]), second = Number(clock[3] ?? 0);
    const now = nowInOffset(utcOffset);
    const today = atOffset(now.y, now.mo, now.d, hour, minute, second, utcOffset);
    if (!today) return null;
    if (today.getTime() - Date.now() > 60_000) {
      const before = dayBefore(now.y, now.mo, now.d);
      return atOffset(before.y, before.mo, before.d, hour, minute, second, utcOffset);
    }
    return today;
  }
  // A month and a day without a year ("Nov-12", "Nov 12") means the most recent such day.
  const namedDay = /^([a-z]{3,9})\.?[-/\s](\d{1,2})$/i.exec(v);
  if (namedDay) {
    const month = Date.parse(`${namedDay[1]!.slice(0, 3)} 1, 2000 00:00:00 GMT`);
    if (!Number.isFinite(month)) return null;
    const mo = new Date(month).getUTCMonth() + 1, day = Number(namedDay[2]);
    const now = nowInOffset(utcOffset);
    const thisYear = atOffset(now.y, mo, day, 0, 0, 0, utcOffset);
    if (!thisYear) return null;
    const reference = atOffset(now.y, now.mo, now.d, 0, 0, 0, utcOffset) ?? new Date();
    if (thisYear.getTime() - reference.getTime() > DAY_MS) return atOffset(now.y - 1, mo, day, 0, 0, 0, utcOffset);
    return thisYear;
  }
  const yearFirst = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:(?:T|\s*)(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  const monthFirst = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})(?:(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  const numeric = yearFirst ?? monthFirst?.map((part, i, match) => i === 1 ? match[3]! : i === 2 ? match[1]! : i === 3 ? match[2]! : part);
  if (numeric && !calendarDay(numeric[1]!, numeric[2]!, numeric[3]!)) return null;
  const english = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b/i.exec(v)
    ?? /\b(\d{1,2})\s+([a-z]{3,9})\.?[,]?\s+(\d{2}|\d{4})\b/i.exec(v)?.map((part, i, match) => i === 1 ? match[2]! : i === 2 ? match[1]! : part);
  if (english) {
    if (english[3]!.length === 2) english[3] = String(Number(english[3]) + (Number(english[3]) < 50 ? 2000 : 1900));
    const month = Date.parse(`${english[1]} 1, ${english[3]} 00:00:00 GMT`);
    if (!Number.isFinite(month) || !calendarDay(english[3]!, new Date(month).getUTCMonth() + 1, english[2]!)) return null;
  }
  if (!numeric && !english) return null;
  const text = v.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  if (EXPLICIT_ZONE.test(v)) {
    const direct = Date.parse(text);
    if (Number.isFinite(direct)) return new Date(direct);
    if (!numeric) return null;
  }
  // 2026-09-26 / 2026/09/26 / 2026-09-26T10:00 / 2026年9月26日 (+ optional time), interpreted in the given offset.
  const m = numeric;
  if (m) {
    const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
    const meridiem = /\d:\d{2}(?::\d{2})?\s*([AP]M)\b/i.exec(v)?.[1]?.toUpperCase();
    if (meridiem && (Number(h) < 1 || Number(h) > 12)) return null;
    const hour = meridiem ? Number(h) % 12 + (meridiem === "PM" ? 12 : 0) : h;
    return atOffset(y!, mo!, d!, hour, mi, s, utcOffset);
  }
  // Parse English wall-clock fields in UTC so the host's daylight-saving rules cannot shift them.
  const en = Date.parse(`${text} GMT`);
  const englishDay = english && !/\d:\d/.test(text) ? Date.parse(`${english[1]} ${english[2]}, ${english[3]} GMT`) : NaN;
  if (!Number.isFinite(en) && !Number.isFinite(englishDay)) return null;
  const utc = new Date(Number.isFinite(en) ? en : englishDay);
  return atOffset(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(), utcOffset);
}

/** A source's claim keeps its precision, apart from the instant used for ordering and windows. */
export interface PublicationDate {
  publishedAt: Date | null;
  /** YYYY-MM-DD for a calendar day; ISO timestamp for a real time; null for unknown. */
  publicationTime: string | null;
}

export function readPublicationDate(value: string | null | undefined, utcOffset = "+08:00"): PublicationDate {
  const publishedAt = parseLooseDate(value, utcOffset);
  if (!publishedAt) return { publishedAt: null, publicationTime: null };
  const timed = /\d{1,2}:\d{2}/.test(value!) || /^\d{14}$/.test(value!.trim());
  if (timed) return { publishedAt, publicationTime: publishedAt.toISOString() };
  return { publishedAt, publicationTime: dayAt(publishedAt, utcOffset) };
}

/** Legacy timestamps have lost their source precision; midnight never tells us which it was. */
export function describePublicationTime(at: Date | null, source: string | null | undefined): string {
  if (!at) return "未知";
  if (!source) return `${beijingDate(at)} ${beijingTime(at)}（历史记录，原始精度未知）`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return `${source}（原文仅有日期，时刻未知）`;
  return `${beijingDate(at)} ${beijingTime(at)}（北京时间）`;
}

const RELATIVE_UNITS: Record<string, number> = { 秒: 1e3, 分钟: 60e3, 分: 60e3, 小时: 3600e3, 天: 86400e3, second: 1e3, minute: 60e3, min: 60e3, m: 60e3, hour: 3600e3, hr: 3600e3, h: 3600e3, day: 86400e3, d: 86400e3 };
const DAYS_BACK: Record<string, number> = { 今天: 0, 昨天: 1, 前天: 2, yesterday: 1 };

/** The calendar day `at` falls on in the given offset, as YYYY-MM-DD. */
function dayAt(at: Date, utcOffset: string): string {
  if (isZoneName(utcOffset)) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: utcOffset, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    } catch {
      return at.toISOString().slice(0, 10);
    }
  }
  const offsetMs = Date.UTC(2000, 0, 1) - atOffset(2000, 1, 1, 0, 0, 0, utcOffset)!.getTime();
  return new Date(at.getTime() + offsetMs).toISOString().slice(0, 10);
}

/**
 * A page's own element printing an age instead of a date ("20小时前", "2天前", "昨天", "今天 15:46", "3 hours ago",
 * "16h ago"), counted back from `now`, the moment it was read. Only the whole text of a date rule's element is read
 * this way, after a byline that leads it ("版面之外·今天 15:46"): a sentence that mentions "两天前" is no date. Some
 * listing pages print the age for an article's first days and the date only after, so every new article came in
 * undated and missed that day's news. Hours and minutes keep a time, however many; days keep the calendar day in the
 * source's offset, and "今天/昨天/前天 HH:MM" is that time on that day there.
 */
export function readRelativeDate(value: string | null | undefined, now: Date, utcOffset = "+08:00"): PublicationDate {
  const v = collapse(value).replace(/^[^·]+·\s*/, "");
  const none = { publishedAt: null, publicationTime: null };
  if (!v) return none;
  const dayTime = /^(今天|昨天|前天)\s*(\d{1,2}):(\d{2})$/.exec(v);
  if (dayTime) {
    const day = dayAt(new Date(now.getTime() - DAYS_BACK[dayTime[1]!]! * 86400e3), utcOffset);
    const at = atOffset(day.slice(0, 4), day.slice(5, 7), day.slice(8, 10), dayTime[2]!, dayTime[3]!, 0, utcOffset);
    return at ? { publishedAt: at, publicationTime: at.toISOString() } : none;
  }
  let ms: number | null = null;
  let unitMs = 0;
  if (/^(刚刚|just now)$/i.test(v)) ms = 0;
  else if (/^(昨天|前天|yesterday)$/i.test(v)) [ms, unitMs] = [DAYS_BACK[v.toLowerCase()]! * 86400e3, 86400e3];
  else {
    const m = /^(\d{1,3})\s*(秒|分钟|分|小时|天)前$/.exec(v) ?? /^(\d{1,3})\s*(?:(second|minute|min|hour|hr|day)s?|(m|h|d))\s+ago$/i.exec(v);
    const name = (m?.[2] ?? m?.[3])?.toLowerCase();
    if (m && name) [ms, unitMs] = [Number(m[1]) * RELATIVE_UNITS[name]!, RELATIVE_UNITS[name]!];
  }
  if (ms === null) return none;
  const at = new Date(now.getTime() - ms);
  // The text's own unit sets the precision: "47小时前" keeps its time, though it is more than a day back.
  if (unitMs < 86400e3) return { publishedAt: at, publicationTime: at.toISOString() };
  const day = dayAt(at, utcOffset);
  return { publishedAt: atOffset(day.slice(0, 4), day.slice(5, 7), day.slice(8, 10), 0, 0, 0, utcOffset), publicationTime: day };
}

const collapse = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
