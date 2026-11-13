import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { HotResponse, TimelineResponse } from "@aihot/contracts/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd } from "../lib/seo";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { ActiveFilters, CategoryTabs, ChannelTabs, FeedBar, SearchField } from "../features/feed/Filters";
import { FeedAside } from "../features/feed/FeedAside";
import { FeedLayout } from "../components/ui/Page";

export const handle: Screen = { tab: "featured", name: "精选" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = readFilters(url.searchParams);
  const upstream = new Headers();
  const data = await loadOr404<TimelineResponse>(listPath("/api/site/timeline", filterParams(filters)), { responseHeaders: upstream, signal: request.signal });
  // The aside carries what is hot right now; the ranking page has the same list.
  const hot = await loadOr404<HotResponse>("/api/site/hot", { signal: request.signal }).catch(() => null);
  // A minute at most, here and on /all: new selections must not wait longer at the edge or in a browser.
  return cachedPage(60, { data, filters, hot }, upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => c.item.title) ?? [];
  return pageMeta({ path, noindex: hasFeedFilters(loaderData?.filters), jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
}

export default function Home() {
  const { data, filters, hot } = useLoaderData<typeof loader>();
  const title = filters.tag ? `#${filters.tag}` : "精选";
  return (
    <FeedLayout aside={<FeedAside trends={hot?.entries.map((e) => ({ rank: e.rank, title: e.story.title, heat: e.heat, trend: e.trend, href: `/story/${e.story.publicId}` }))} category={filters.category} channel={filters.channel} />}>
      <div className="pb-6">
        {/* Phones: the bar (精选 | 全部, filter, search), the filter in use, today's hot topics, the feed. */}
        <FeedBar base="/" category={filters.category} channel={filters.channel} />
        <ActiveFilters base="/" category={filters.category} channel={filters.channel} tag={filters.tag} />
        {/* The header of the feed: its name and its lanes, kept in sight while the feed scrolls. */}
        <div className="sticky top-0 z-30 hidden border-b border-line bg-bg lg:block lg:-mx-2 lg:px-2">
          <h1 className="py-3 text-[20px] font-bold leading-[1.3] text-ink">{title}</h1>
          <div className="flex flex-col gap-2.5 pb-2.5">
            <div className="flex items-center justify-between gap-4">
              <ChannelTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-chan-desk" className="min-w-0" />
              <span className="hidden lg:block xl:hidden">
                <SearchField keep={{ category: filters.category }} />
              </span>
            </div>
            <CategoryTabs base="/" category={filters.category} channel={filters.channel} layoutId="home-cat-desk" className="min-w-0" />
          </div>
        </div>

        {/* The trends sit in the aside on wide screens; the card stays for the narrower ones. */}
        {data.hot && inNav("/hot") && <div className="xl:hidden"><HotTopics entries={data.hot} /></div>}

        <Timeline initial={data} filters={data.filters} />
      </div>
    </FeedLayout>
  );
}
