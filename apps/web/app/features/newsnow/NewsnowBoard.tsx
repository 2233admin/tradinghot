import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NewsnowFeedResponse, NewsnowSource } from "../../../../../modules/newsnow/types";
import { IconBookmark, IconChevronDown, IconExternal, IconHistory } from "../../components/icons";
import { relativeTime } from "../../lib/format";

const PRIORITY = ["cls-telegraph", "jin10", "wallstreetcn-quick", "gelonghui", "fastbull-express", "mktnews-flash", "weibo", "zhihu", "bilibili-hot-search"];
const HIDDEN_KEY = "aihot.newsnow.hidden";
const FOLLOW_KEY = "aihot.newsnow.followed";
type Filter = "all" | "realtime" | "hottest" | "collected" | "followed";

export interface BoardSource extends Omit<NewsnowSource, "type"> {
  type: NewsnowSource["type"] | "collected";
  siteSourceId?: string;
  lastOkAt?: string | null;
  health?: "ok" | "degraded" | "failing" | "unknown";
}

interface SiteItemsResponse {
  items: { id: string; title: string; publishedAt: string | null }[];
}

function savedIds(key: string, fallback: string[], valid: Set<string>): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && valid.has(id)))] : fallback;
  } catch {
    return fallback;
  }
}

function saveIds(key: string, ids: string[]) {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* Browsing without storage still works for this visit. */ }
}

function SourceCard({ source, followed, onFollow }: { source: BoardSource; followed: boolean; onFollow: () => void }) {
  const [feed, setFeed] = useState<NewsnowFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!card.current || !("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "800px" });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const endpoint = source.siteSourceId
          ? `/api/v1/items?mode=all&window=7d&by=published&limit=30&source=${encodeURIComponent(source.siteSourceId)}`
          : `/api/site/newsnow/feed?id=${encodeURIComponent(source.id)}`;
        const res = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error("unavailable");
        const body: NewsnowFeedResponse = source.siteSourceId
          ? { id: source.id, status: "success", refreshedAt: source.lastOkAt ?? null, items: ((await res.json()) as SiteItemsResponse).items.map((item) => ({ ...item, url: `/items/${encodeURIComponent(item.id)}` })) }
          : await res.json() as NewsnowFeedResponse;
        if (!controller.signal.aborted) setFeed(body);
      } catch {
        if (!controller.signal.aborted) setFeed({ id: source.id, status: "error", refreshedAt: null, items: [] });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), Math.max(source.intervalMs, 120_000));
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [source.id, source.intervalMs, source.siteSourceId, source.lastOkAt, revision, nearViewport]);

  const items = useMemo(() => {
    const list = feed?.items ?? [];
    return source.type !== "hottest" ? [...list].sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0)) : list;
  }, [feed, source.type]);
  const visible = expanded ? items : items.slice(0, 10);
  const label = `${source.name}${source.title ? ` · ${source.title}` : ""}`;

  return (
    <article ref={card} className="min-h-[220px] min-w-0 border border-line bg-surface" aria-label={label}>
      <header className="flex min-h-[68px] items-start gap-2 border-b border-line-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-ink" title={label}>{source.name}<span className="ml-1.5 text-[12px] font-normal text-ink-4">{source.title}</span></h2>
          <p className="mt-1 text-[11.5px] text-ink-4">
            {source.type === "hottest" ? "热榜 · 按来源排名" : source.type === "collected" ? "本站入库 · 最近 7 天" : "最新动态"}
            {source.health && source.health !== "ok" && <> · {source.health === "failing" ? "采集失败" : source.health === "degraded" ? "采集不稳定" : "尚未采集"}</>}
            {feed?.refreshedAt && <> · <time dateTime={feed.refreshedAt} title={new Date(feed.refreshedAt).toLocaleString()}>{relativeTime(feed.refreshedAt)}</time>{source.siteSourceId ? "采集" : "读取"}</>}
          </p>
          {source.description && <p className="mt-1 text-[11px] text-ink-4">{source.description}</p>}
        </div>
        <button type="button" aria-label={`${followed ? "取消关注" : "关注"}${label}`} aria-pressed={followed} onClick={onFollow} className={`flex size-10 shrink-0 items-center justify-center hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${followed ? "text-accent" : "text-ink-4"}`}>
          <IconBookmark size={17} filled={followed} />
        </button>
        <button type="button" aria-label={`${source.siteSourceId ? "查看最新入库" : "重新读取"}${label}`} disabled={loading} onClick={() => setRevision((n) => n + 1)} className="flex size-10 shrink-0 items-center justify-center text-ink-4 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
          <IconHistory size={17} />
        </button>
      </header>
      {loading && !feed ? <p className="px-4 py-8 text-[13px] text-ink-4">{nearViewport ? "正在读取…" : "滚动到此处时加载"}</p> : feed?.status === "error" ? (
        <p className="px-4 py-8 text-[13px] text-ink-3" role="status">暂时无法读取此来源。<button type="button" onClick={() => setRevision((n) => n + 1)} className="ml-2 text-accent underline">重试</button></p>
      ) : items.length === 0 ? <p className="px-4 py-8 text-[13px] text-ink-4">暂无内容</p> : (
        <>
          <ol className="divide-y divide-line-soft">
            {visible.map((item, index) => (
              <li key={`${item.id}-${item.url}`} className="flex items-start gap-3 px-4 py-2.5">
                {source.type === "hottest" && <span className={`mono w-4 shrink-0 pt-0.5 text-right text-[12px] ${index < 3 ? "text-accent" : "text-ink-4"}`}>{index + 1}</span>}
                <div className="min-w-0 flex-1">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="block break-words text-[13px] leading-[1.6] text-ink-2 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{item.title}</a>
                  {item.publishedAt && <time dateTime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()} className="mt-1 block text-[11px] text-ink-4">{relativeTime(item.publishedAt)}</time>}
                </div>
              </li>
            ))}
          </ol>
          {items.length > 10 && <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="min-h-11 w-full border-t border-line-soft px-4 text-left text-[12px] text-ink-4 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{expanded ? "收起" : `显示全部 ${items.length} 条`}</button>}
        </>
      )}
    </article>
  );
}

export function NewsnowBoard({ sources }: { sources: BoardSource[] }) {
  const valid = useMemo(() => new Set(sources.map((source) => source.id)), [sources]);
  const initial = useMemo(() => [...PRIORITY.filter((id) => valid.has(id)), ...sources.map((source) => source.id).filter((id) => !PRIORITY.includes(id))], [sources, valid]);
  const [selected, setSelected] = useState(initial);
  const [followed, setFollowed] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const hidden = new Set(savedIds(HIDDEN_KEY, [], valid));
    setSelected(initial.filter((id) => !hidden.has(id)));
    setFollowed(savedIds(FOLLOW_KEY, [], valid));
  }, [initial, valid]);
  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => { const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id]; saveIds(HIDDEN_KEY, initial.filter((value) => !next.includes(value))); return next; });
  }, [initial]);
  const toggleFollow = useCallback((id: string) => {
    setFollowed((current) => { const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id]; saveIds(FOLLOW_KEY, next); return next; });
  }, []);
  const byId = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const visible = selected.map((id) => byId.get(id)).filter((source): source is BoardSource => !!source && (filter === "all" || (filter === "followed" ? followed.includes(source.id) : source.type === filter)));
  const options = sources.filter((source) => `${source.name} ${source.title ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const filters: { value: Filter; label: string }[] = [{ value: "all", label: "全部" }, { value: "realtime", label: "实时" }, { value: "hottest", label: "热榜" }, { value: "collected", label: "入库" }, { value: "followed", label: "关注" }];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="筛选来源">
          {filters.map(({ value, label }) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 px-3 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${filter === value ? "border-b-2 border-accent text-accent" : "text-ink-3 hover:text-ink"}`}>{label}</button>)}
        </div>
        <details className="group relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 border border-line px-3 text-[13px] text-ink-2 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">选择来源 <span className="num text-ink-4">{selected.length}/{sources.length}</span><IconChevronDown size={14} /></summary>
          <div className="absolute left-0 z-20 mt-1 w-[min(90vw,360px)] border border-line bg-surface p-3 shadow-[var(--shadow-soft)] sm:left-auto sm:right-0">
            <label className="block text-[12px] text-ink-3">搜索来源<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称或栏目" className="mt-1 h-10 w-full border border-line bg-bg-sunk px-2 text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" /></label>
            <div className="mt-2 max-h-[min(55vh,480px)] overflow-y-auto overscroll-contain">
              {options.map((source) => <label key={source.id} className="flex min-h-10 cursor-pointer items-center gap-2 border-b border-line-soft px-1 text-[13px] text-ink-2 hover:text-accent"><input type="checkbox" checked={selected.includes(source.id)} onChange={() => toggleSelected(source.id)} /><span>{source.name}{source.title ? ` · ${source.title}` : ""}</span><span className="ml-auto text-[11px] text-ink-4">{source.type === "hottest" ? "热榜" : source.type === "collected" ? "入库" : "实时"}</span></label>)}
              {options.length === 0 && <p className="py-4 text-[13px] text-ink-4">没有匹配的来源</p>}
            </div>
          </div>
        </details>
      </div>
      <p className="py-3 text-[12px] leading-relaxed text-ink-4">实时来源按原始发布时间排列；热榜按来源排名；本站来源显示最近 7 天的公开入库内容。未提供发布时间的不显示时间。关注和来源选择仅保存在此浏览器。</p>
      {visible.length ? <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((source) => <SourceCard key={source.id} source={source} followed={followed.includes(source.id)} onFollow={() => toggleFollow(source.id)} />)}</div> : <div className="border border-line bg-surface px-5 py-12 text-center text-[13px] text-ink-3">{filter === "followed" ? "还没有关注的已选来源。可在来源卡片上关注。" : "当前没有来源，请通过“选择来源”添加。"}</div>}
      <p className="mt-5 flex items-center gap-1 text-[11px] text-ink-4">数据来源于各网站，列表能力参考 <a href="https://github.com/newsnext/newsnow" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent">NewsNow <IconExternal size={11} /></a>。</p>
    </div>
  );
}
