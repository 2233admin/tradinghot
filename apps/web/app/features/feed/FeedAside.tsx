import { Link } from "react-router";
import { IconArrowRight, IconTrendDown, IconTrendUp } from "../../components/icons";
import { SearchField } from "./Filters";

/** One trend in the aside: the topic, the heat it carries and where it leads. */
export interface TrendEntry {
  rank: number;
  title: string;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  href: string;
}

/**
 * The aside of the feed pages: the search, what is hot right now, and the foot of the site. It sits on
 * the right of the feed on wide screens and follows the feed on narrow ones, the way the reference
 * layout keeps it.
 */
export function FeedAside({
  trends,
  category,
  channel,
}: {
  trends?: TrendEntry[] | null;
  category?: string | null | undefined;
  channel?: string | null | undefined;
}) {
  return (
    <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
      <SearchField keep={{ category: category ?? null, channel: channel ?? null }} />
      {trends && trends.length > 0 && <Trends entries={trends} />}
      <SiteFooter />
    </div>
  );
}

/**
 * What is hot right now, as the reference layout draws its trends: the topic, the heat it carries and
 * the way it is moving. The whole row is a link to the piece.
 */
function Trends({ entries }: { entries: TrendEntry[] }) {
  return (
    <section aria-labelledby="aside-trends" className="card overflow-hidden">
      <h2 id="aside-trends" className="flex items-center justify-between px-4 pb-2 pt-3.5 text-[15px] font-semibold text-ink">
        正在发生
        <Link to="/hot" className="group inline-flex items-center gap-1 text-[12.5px] font-normal text-ink-3 transition-colors hover:text-accent">
          完整榜单 <IconArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </h2>
      <ol>
        {entries.slice(0, 6).map((e) => (
          <li key={e.rank}>
            <Link
              viewTransition
              to={e.href}
              className="group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-bg-sunk/70 dark:hover:bg-bg-muted/40"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 block text-[14px] font-semibold leading-[1.45] text-ink transition-colors group-hover:text-accent">
                  {e.title}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-ink-4">
                  <span className="num font-medium">{Math.round(e.heat)} 热度</span>
                  {e.trend === "up" && <IconTrendUp size={13} strokeWidth={2.2} className="text-hot" aria-label="热度上升" />}
                  {e.trend === "down" && <IconTrendDown size={13} strokeWidth={2.2} aria-label="热度回落" />}
                </span>
              </span>
              <span className="num shrink-0 pt-0.5 text-[13px] font-bold text-ink-4">{e.rank}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The foot of the site, the way the reference layout keeps it: quiet links, then the small print. */
function SiteFooter() {
  return (
    <footer className="space-y-2.5 px-1 pb-2 text-[12.5px] text-ink-4">
      <nav aria-label="站点信息" className="flex flex-wrap gap-x-3 gap-y-1">
        <Link to="/about" className="hover:underline hover:text-ink-3">关于</Link>
        <Link to="/sources" className="hover:underline hover:text-ink-3">数据源</Link>
        <Link to="/changelog" className="hover:underline hover:text-ink-3">更新日志</Link>
        <Link to="/feedback" className="hover:underline hover:text-ink-3">反馈</Link>
        <Link to="/terms" className="hover:underline hover:text-ink-3">服务条款</Link>
        <Link to="/privacy" className="hover:underline hover:text-ink-3">隐私政策</Link>
      </nav>
      <p className="leading-[1.6]">股市热点 · 把每天的行情要点收在一处</p>
    </footer>
  );
}
