import { useLoaderData } from "react-router";
import type { NewsnowSourcesResponse } from "../../../../modules/newsnow/types";
import type { SourcePoolResponse } from "@aihot/contracts/site";
import { apiGet, cachedPage } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { navUp } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import { NewsnowBoard } from "../features/newsnow/NewsnowBoard";

export const handle: Screen = { home: navUp("/topics").tab, name: "主题" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const [newsnow, pool] = await Promise.all([
    apiGet<NewsnowSourcesResponse>("/api/site/newsnow/sources", { signal: request.signal }),
    apiGet<SourcePoolResponse>("/api/site/sources", { signal: request.signal }),
  ]);
  const collected = pool.sources.filter((source) => !source.id.startsWith("newsnow-")).map((source) => ({
    id: `site:${source.id}`,
    name: source.name,
    type: "collected" as const,
    intervalMs: 120_000,
    siteSourceId: source.id,
    lastOkAt: source.lastOkAt,
    health: source.status,
  }));
  return cachedPage(60, { sources: [...newsnow.sources, ...collected] });
}

export function meta() {
  return pageMeta({
    title: "来源看板",
    description: "浏览财经、新闻与社区来源的最新动态和热门榜单，自选并关注感兴趣的来源。",
    path: "/topics",
    image: "/og/pages/topics.png",
  });
}

export default function TopicsPage() {
  const { sources } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/more", label: "我的" }} title="主题" />
      <header className="pb-4 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">来源看板</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">把关注的来源放在一起，查看最新动态与热门榜单。</p>
      </header>
      <NewsnowBoard sources={sources} />
    </div>
  );
}
