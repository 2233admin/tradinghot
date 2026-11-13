// The quote poller's read: the market's biggest movers, from the public quote list.
//
// The source is Sina's public quote service (no key, no account): the same list a browser shows when
// it asks for 沪深A股 by change. Two lists are read — the gainers and the losers — and a symbol in
// either is a candidate. The poller compares each poll with the one before it, so what it reports is
// a change in the market, not a permanent ranking.
import { z } from "zod";

/** Where the list comes from. */
export const LIST_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";

/** How many names each list gives. */
const LIST_SIZE = 20;

/** The fields the list answers with; only these are read, the rest is ignored. */
export const quoteRowSchema = z.object({
  symbol: z.string(),
  code: z.string(),
  name: z.string(),
  /** The day's change in percent. */
  changepercent: z.coerce.number(),
  /** The last price. */
  trade: z.coerce.number().optional(),
  /** The previous close. */
  settlement: z.coerce.number().optional(),
  /** The turnover rate in percent. */
  turnoverratio: z.coerce.number().optional(),
  /** The traded amount in yuan. */
  amount: z.coerce.number().optional(),
  /** When the quote was written, Beijing time. */
  ticktime: z.string().optional(),
});

export type QuoteRow = z.infer<typeof quoteRowSchema>;

/** One side of the market's movers list. */
export interface QuoteList {
  direction: "up" | "down";
  rows: QuoteRow[];
}

/** The list of the names that moved most, gainers first then losers. */
export async function fetchMovers(): Promise<QuoteList[]> {
  const sides: Array<{ direction: "up" | "down"; asc: 0 | 1 }> = [
    { direction: "up", asc: 0 },
    { direction: "down", asc: 1 },
  ];
  const lists = await Promise.all(
    sides.map(async ({ direction, asc }): Promise<QuoteList> => {
      const url = new URL(LIST_URL);
      url.searchParams.set("page", "1");
      url.searchParams.set("num", String(LIST_SIZE));
      url.searchParams.set("sort", "changepercent");
      url.searchParams.set("asc", String(asc));
      url.searchParams.set("node", "hs_a");
      url.searchParams.set("symbol", "");
      url.searchParams.set("_s_r_a", "page");
      const response = await fetch(url, {
        headers: { accept: "application/json", referer: "https://vip.stock.finance.sina.com.cn/" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`quote list answered ${response.status}`);
      const body = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error("quote list answered something that is not json");
      }
      if (!Array.isArray(parsed)) throw new Error("quote list answered no rows");
      const rows: QuoteRow[] = [];
      for (const raw of parsed) {
        const row = quoteRowSchema.safeParse(raw);
        if (row.success) rows.push(row.data);
      }
      return { direction, rows };
    }),
  );
  return lists;
}
