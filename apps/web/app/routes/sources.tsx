import { useLoaderData } from "react-router";
import type { PublicSourceEntry, SourcePoolResponse } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { apiGet, cachedPage } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import { relativeTime } from "../lib/format";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { Badge } from "../components/ui/Badge";
import { SourceAvatar } from "../components/ui/SourceAvatar";

export const handle: Screen = { tab: "me", name: "数据源" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  return cachedPage(60, await apiGet<SourcePoolResponse>("/api/site/sources", { signal: request.signal }));
}

export function meta() {
  return pageMeta({
    title: "数据源",
    description: `本站采集的 ${SITE.subject} 信源清单与每个信源的最近采集状态。`,
    path: "/sources",
    noindex: true,
  });
}

const KIND_LABEL: Record<string, string> = {
  rss: "RSS",
  web_list: "网页列表",
  json_list: "JSON 接口",
  x_search: "X",
  mp_account: "公众号",
  external: "外部上报",
};

const STATUS: Record<PublicSourceEntry["status"], { label: string; tone: "ok" | "amber" | "hot" | "neutral" }> = {
  ok: { label: "正常", tone: "ok" },
  degraded: { label: "不稳定", tone: "amber" },
  failing: { label: "失败", tone: "hot" },
  unknown: { label: "未检查", tone: "neutral" },
};

function SourceRow({ source }: { source: PublicSourceEntry }) {
  const status = STATUS[source.status];
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <SourceAvatar name={source.name} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-ink">{source.name}</span>
          {source.firstParty && <Badge tone="accent">一手</Badge>}
        </div>
        <div className="mt-0.5 text-[12px] leading-[1.6] text-ink-4">
          {KIND_LABEL[source.kind] ?? source.kind} · 近 7 天 <span className="num">{source.items7d}</span> 条
        </div>
      </div>
      <div className="shrink-0 text-right">
        <Badge tone={status.tone} dot>{status.label}</Badge>
        <div className="mt-1 whitespace-nowrap text-[11.5px] leading-[1.6] text-ink-4" suppressHydrationWarning>
          {source.lastOkAt ? `上次成功 ${relativeTime(source.lastOkAt)}` : "还没有成功记录"}
        </div>
      </div>
    </li>
  );
}

export default function SourcesPage() {
  const { counts, sources } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-14">
      <PhoneBar title="数据源" large />
      <h1 className="hidden pb-4 pt-1 text-[22px] font-bold text-ink lg:block">数据源</h1>
      <p className="pb-4 text-[13.5px] leading-[1.7] text-ink-3">
        本站持续采集下面的信源，状态来自每个信源的最近一次采集。失败的信源会自动重试，恢复后继续收录。
      </p>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] text-ink-3">
        <span>共 <b className="num font-semibold text-ink">{counts.total}</b> 个</span>
        <span>正常 <b className="num font-semibold text-ink">{counts.ok}</b></span>
        {counts.degraded > 0 && <span className="text-amber-ink">不稳定 <b className="num font-semibold">{counts.degraded}</b></span>}
        {counts.failing > 0 && <span className="text-hot">失败 <b className="num font-semibold">{counts.failing}</b></span>}
        {counts.unknown > 0 && <span>未检查 <b className="num font-semibold text-ink">{counts.unknown}</b></span>}
      </div>
      {sources.length > 0 ? (
        <ul className="card divide-y divide-line-soft overflow-hidden">
          {sources.map((source, i) => <SourceRow key={`${source.name}-${i}`} source={source} />)}
        </ul>
      ) : (
        <p className="card px-4 py-10 text-center text-[13.5px] text-ink-3">还没有公开的数据源。</p>
      )}
    </div>
  );
}
