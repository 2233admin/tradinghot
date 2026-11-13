// The daily crowding page: the most crowded 50 stocks the public Bagholder 50 index names after each
// close, what the index itself did, and what the reading is for.
import { beijingStamp } from "@aihot/contracts/time";
import { AnimatedCounter } from "@aihot/web/components/ui/animated-counter";
import { useLoaderData } from "react-router";
import { crowdingSnapshotSchema } from "../types.ts";

export async function loader({ request }: { request: Request }) {
  const base = process.env.API_BASE_URL || "http://127.0.0.1:3001";
  const response = await fetch(`${base}/api/site/crowding`, {
    headers: { accept: "application/json" },
    signal: request.signal,
  });
  if (!response.ok) throw new Response("crowding unavailable", { status: 503 });
  const parsed = crowdingSnapshotSchema.safeParse(await response.json());
  if (!parsed.success) throw new Response("crowding unreadable", { status: 503 });
  return parsed.data;
}

export function meta() {
  return [
    { title: "今日拥挤度 · 高拥挤名单" },
    {
      name: "description",
      content:
        "公开的冷西西韭菜50指数每天收盘后算出的全市场最拥挤的 50 只股票：追涨热度、换手放大、龙虎榜注意力和特大单流量。这是避雷读数，不是买入名单。",
    },
  ];
}

const percent = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

/** The site's times are Beijing's; the api answers in UTC. */
const beijing = (iso: string) => beijingStamp(iso);

export default function CrowdingPage() {
  const snapshot = useLoaderData<typeof loader>();
  const items = snapshot.items;
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-14">
      <h1 className="pb-2 pt-1 text-[22px] font-bold text-ink">今日拥挤度</h1>
      <p className="pb-4 text-[13.5px] leading-[1.8] text-ink-3">
        这份名单来自公开的「冷西西韭菜50指数」：每天收盘后，按追涨热度、换手放大、龙虎榜注意力和特大单流量四类拥挤信号，从当天合格股票里挑出最拥挤的 50 只，次一交易日开盘生效。
        <b className="font-semibold text-ink">它是"哪里人最多"的读数，不是买入名单，也不是做空名单</b>：过去十年只按它做多，账面几乎归零。
      </p>

      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-ink-3">
        {snapshot.signalDate && (
          <span>
            信号日 <b className="num font-semibold text-ink">{snapshot.signalDate}</b>
          </span>
        )}
        {snapshot.tradeDate && (
          <span>
            生效日 <b className="num font-semibold text-ink">{snapshot.tradeDate}</b>
          </span>
        )}
        {snapshot.updatedAt && (
          <span>
            更新于 <b className="num font-semibold text-ink">{beijing(snapshot.updatedAt)}</b>
          </span>
        )}
        {snapshot.source && (
          <a href={snapshot.source.url} className="underline decoration-line-strong underline-offset-2">
            发布方页面
          </a>
        )}
      </div>

      {snapshot.index && (
        <div className="card mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3 text-[13px] text-ink-3">
          <span>
            指数点位 <b className="num font-semibold text-ink"><AnimatedCounter value={snapshot.index.point} decimals={4} /></b>
          </span>
          <span>
            年化 <b className={snapshot.index.annualizedReturn >= 0 ? "num font-semibold text-ok-ink" : "num font-semibold text-hot"}>
              {percent(snapshot.index.annualizedReturn)}
            </b>
          </span>
          <span>
            近 1 日 <b className="num font-semibold text-ink">{percent(snapshot.index.returns.d1)}</b>
          </span>
          <span>
            近 5 日 <b className="num font-semibold text-ink">{percent(snapshot.index.returns.d5)}</b>
          </span>
          <span>
            近 20 日 <b className="num font-semibold text-ink">{percent(snapshot.index.returns.d20)}</b>
          </span>
        </div>
      )}

      {snapshot.status !== "ready" && (
        <div className="card px-4 py-3 text-[13px] leading-[1.7] text-ink-3">
          {snapshot.message ?? "暂时没有名单。"}
        </div>
      )}

      {items.length > 0 && (
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {items.map((item) => (
            <li key={item.tsCode} className="flex items-center gap-3 px-4 py-2.5">
              <span className="num w-6 shrink-0 text-[12.5px] text-ink-4">{String(item.rank).padStart(2, "0")}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold text-ink">{item.name}</div>
                <div className="num mt-0.5 text-[12px] text-ink-4">{item.tsCode}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className={item.todayReturn >= 0 ? "num text-[13.5px] font-semibold text-hot" : "num text-[13.5px] font-semibold text-ok-ink"}>
                  {percent(item.todayReturn)}
                </div>
                <div className="num mt-0.5 text-[11.5px] text-ink-4">拥挤分 <AnimatedCounter value={item.score} decimals={3} /></div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[12.5px] leading-[1.8] text-ink-4">
        方法：四类拥挤信号在当日合格股票池内做横截面排名后等权平均，取分数最高的 50 只；收盘计算，次一交易日开盘生效。
        名单由发布方每天公开，本站只做转载与提示。
      </p>
    </div>
  );
}
