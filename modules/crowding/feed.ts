// Reading the publisher's feed. The feed is small and public; anything that does not look exactly as
// promised is refused rather than half-read, because a half-read list would be a list of the wrong stocks.
// The feed carries two views of the same index: the list in effect ("holdings_today") and the one that
// applies to the next session ("avoid_tomorrow"). We show the next session's list when it is out, and the
// one in effect when it is not.
import { z } from "zod";
import type { CrowdingIndexSummary, CrowdingItem } from "./types.ts";

export interface ParsedFeed {
  /** Which view the list came from. */
  view: "avoid_tomorrow" | "holdings_today";
  status: "ready" | "not_ready";
  message: string | null;
  signalDate: string | null;
  tradeDate: string | null;
  publishedAt: string | null;
  index: CrowdingIndexSummary | null;
  items: CrowdingItem[];
}

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedError";
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const itemSchema = z.object({
  ts_code: z.string().regex(/^\d{6}\.(SH|SZ|BJ)$/),
  name: z.string().min(1),
  bagholder_rank: z.number().int().min(1),
  bagholder_score: z.number(),
  today_return: z.number(),
});

const viewSchema = z.object({
  status: z.string(),
  signal_date: isoDate.nullish(),
  trade_date: isoDate.nullish(),
  items: z.array(itemSchema).optional(),
});

const feedSchema = z.object({
  schema_version: z.number(),
  generated_at_utc: z.string(),
  index: z
    .object({
      data_end_date: isoDate.optional(),
      summary: z
        .object({
          latest_date: isoDate,
          latest_point: z.number(),
          annualized_return: z.number().optional(),
          recent_returns: z.record(z.string(), z.object({ return: z.number() })).optional(),
        })
        .optional(),
    })
    .optional(),
  views: z.object({
    holdings_today: viewSchema.optional(),
    avoid_tomorrow: viewSchema.optional(),
  }),
});

/** The list the publisher released, or why there is none yet. Throws when the answer is not as promised. */
export function parseFeed(payload: unknown): ParsedFeed {
  const parsed = feedSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new FeedError(`feed does not match what it promises: ${issue?.message ?? "unknown"} at ${issue?.path.join(".") ?? "?"}`);
  }
  const body = parsed.data;
  const publishedAt = body.generated_at_utc;
  const summary = body.index?.summary;
  const index: CrowdingIndexSummary | null = summary
    ? {
        date: summary.latest_date,
        point: summary.latest_point,
        annualizedReturn: summary.annualized_return ?? 0,
        returns: {
          d1: summary.recent_returns?.["1d"]?.return ?? 0,
          d5: summary.recent_returns?.["5d"]?.return ?? 0,
          d20: summary.recent_returns?.["20d"]?.return ?? 0,
        },
      }
    : null;

  const candidates = [
    { view: "avoid_tomorrow" as const, data: body.views.avoid_tomorrow },
    { view: "holdings_today" as const, data: body.views.holdings_today },
  ];
  const chosen = candidates.find((candidate) => candidate.data?.status === "ready");
  const view = chosen?.data ?? candidates.find((candidate) => candidate.data)?.data;
  if (!view) throw new FeedError("feed has no views");
  if (!chosen) {
    return {
      view: candidates.find((candidate) => candidate.data)?.view ?? "avoid_tomorrow",
      status: "not_ready",
      message: "发布方还没有放出今天的名单。",
      signalDate: view.signal_date ?? null,
      tradeDate: view.trade_date ?? null,
      publishedAt,
      index,
      items: [],
    };
  }

  const items: CrowdingItem[] = (view.items ?? [])
    .map((item) => ({
      tsCode: item.ts_code,
      name: item.name,
      rank: item.bagholder_rank,
      score: item.bagholder_score,
      todayReturn: item.today_return,
    }))
    .sort((a, b) => a.rank - b.rank);
  if (items.length === 0) throw new FeedError("feed view is ready but has no items");
  if (new Set(items.map((item) => item.rank)).size !== items.length) throw new FeedError("feed items share a rank");

  return {
    view: chosen.view,
    status: "ready",
    message: null,
    signalDate: view.signal_date ?? null,
    tradeDate: view.trade_date ?? null,
    publishedAt,
    index,
    items,
  };
}
