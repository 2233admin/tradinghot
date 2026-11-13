// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs, the engine's
// and the site's modules'.
import type { ReactNode } from "react";
import { NAV, subjectAfter, withSubject } from "@aihot/site";
import { webModules } from "../../site-modules";
import {
  MarkAbout, MarkAgent, MarkAll, MarkDaily, MarkFeatured, MarkFeedback, MarkHot, MarkLog, MarkSettings, MarkSources, MarkStar, MarkTopics, MarkUser,
} from "./nav-marks";

export interface NavItem {
  to: string;
  label: string;
  /** The name the collapsed rail shows, where the full one does not fit. */
  short?: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "内容",
    items: [
      { to: "/", label: "精选", icon: MarkFeatured, end: true },
      { to: "/all", label: subjectAfter("全部", "动态"), short: "全部", icon: MarkAll },
      { to: "/hot", label: "热点榜", icon: MarkHot },
      { to: "/daily", label: withSubject("日报"), short: "日报", icon: MarkDaily },
      { to: "/topics", label: "主题", icon: MarkTopics },
      { to: "/starred", label: "收藏", icon: MarkStar },
    ],
  },
  {
    title: "更多",
    items: [
      { to: "/agent", label: "Agent 接入", short: "Agent", icon: MarkAgent },
      { to: "/sources", label: "数据源", icon: MarkSources },
      { to: "/settings", label: "设置", icon: MarkSettings },
      { to: "/about", label: "关于", icon: MarkAbout },
      { to: "/changelog", label: "更新日志", short: "日志", icon: MarkLog, changelog: true },
      { to: "/feedback", label: "反馈", icon: MarkFeedback },
    ],
  },
];

/** Whether an engine page is a way in from the navigation (site.ts NAV.hidden); a hidden page still opens. */
export const inNav = (to: string) => !(NAV.hidden as readonly string[]).includes(to);

const UP = {
  "/hot": { name: "热点榜", back: "热点", tab: "hot" },
  "/topics": { name: "主题", back: "全部主题", tab: "me" },
} as const;

/**
 * Where pages under a navigation entry lead back up to: the entry, or 精选 in its place while the site hides
 * it. `name` is for breadcrumbs and desktop back links (热点榜), `back` for the phone bar (热点), `tab` the
 * phone tab it sits under, `crumbs` its breadcrumb after the site's home.
 */
export function navUp(entry: keyof typeof UP): { to: string; name: string; back: string; tab: TabKey; crumbs: Array<{ name: string; path: string }> } {
  if (!inNav(entry)) return { to: "/", name: "精选", back: "精选", tab: "featured", crumbs: [] };
  return { to: entry, ...UP[entry], crumbs: [{ name: UP[entry].name, path: entry }] };
}

/**
 * The sidebar: the engine's sections with the modules' between 内容 and 更多; a module naming a section
 * that is already there adds to it.
 */
export function sidebar(): Array<{ title: string; items: NavItem[] }> {
  const [content, ...rest] = SECTIONS;
  const more = rest.pop()!;
  const sections = [content!, ...rest].map((s) => ({ ...s, items: s.items.filter((i) => inNav(i.to)) }));
  for (const m of webModules()) {
    if (!m.sidebar) continue;
    const section = sections.find((s) => s.title === m.sidebar!.section);
    if (section) section.items.push(...m.sidebar.items);
    else sections.push({ title: m.sidebar.section, items: [...m.sidebar.items] });
  }
  return [...sections, more];
}

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports. */
export function sidebarIsActive(item: Pick<NavItem, "to" | "end">, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The deepest entry a path belongs to: a page can sit under more than one entry of its section (a module's
 * list and a detail page under it), and only the most specific one is lit.
 */
export function activeSidebarItem(items: readonly NavItem[], pathname: string): NavItem | null {
  let lit: NavItem | null = null;
  for (const item of items) {
    if (sidebarIsActive(item, pathname) && (!lit || item.to.length > lit.to.length)) lit = item;
  }
  return lit;
}

/**
 * The phone tab bar: 全部 lives beside 精选 as a switch, 热点 and 日报 are tabs, and "我的" at /more holds
 * 收藏, 外观, the tools and the site's own pages. Which tab a page sits under is declared by the page
 * itself (components/shell/screens.ts).
 */
export type TabKey =
  | "featured"
  | "hot"
  | "daily"
  | "me"
  // A module's tab.
  | (string & {});

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

const ENGINE_TABS: Tab[] = [
  { key: "featured", to: "/", label: "精选", icon: MarkFeatured },
  { key: "hot", to: "/hot", label: "热点", icon: MarkHot },
  { key: "daily", to: "/daily", label: "日报", icon: MarkDaily },
  { key: "me", to: "/more", label: "我的", icon: MarkUser, changelog: true },
];

/** The tab bar: the engine's, the modules' before 我的. */
export function tabs(): Tab[] {
  return [...ENGINE_TABS.slice(0, -1).filter((t) => inNav(t.to)), ...webModules().flatMap((m) => m.tabs ?? []), ENGINE_TABS.at(-1)!];
}

/**
 * The rail that stands in for the sidebar on narrow desktops (unfolded foldables, tablets upright): the
 * tabs, with 全部 after 精选 since desktop pages have no 精选 | 全部 switch.
 */
export function rail(): Tab[] {
  const all = tabs().filter((t) => t.key !== "me");
  if (!inNav("/all")) return all;
  const at = all.findIndex((t) => t.key === "featured") + 1;
  return [...all.slice(0, at), { key: "all", to: "/all", label: "全部", icon: MarkAll }, ...all.slice(at)];
}

/**
 * The same entries in the same order as the full sidebar: the reader's lanes at the top, the site's own
 * pages at the foot. The collapsed rail and the full column are one navigation, not two.
 */
export function navGroups(): { title: string; items: NavItem[] }[] {
  return sidebar().map((section) => ({ title: section.title, items: section.items }));
}

/**
 * The site's own pages, pinned to the foot of the rail: the reader's lanes sit at the top, the settings
 * and the site's pages at the bottom, separated by a hairline.
 */
export function railBottom(): Tab[] {
  const entries: Tab[] = [
    { key: "me", to: "/more", label: "我的", icon: MarkUser, changelog: true },
    { key: "topics", to: "/topics", label: "主题", icon: MarkTopics },
    { key: "sources", to: "/sources", label: "数据源", icon: MarkSources },
    { key: "settings", to: "/settings", label: "设置", icon: MarkSettings },
    { key: "about", to: "/about", label: "关于", icon: MarkAbout },
  ];
  return entries.filter((t) => inNav(t.to));
}

/** A rail entry is lit on its pages; 我的 also on the pages that sit under it on phones. */
export function railIsActive(tab: Tab, pathname: string, screenTab: TabKey | undefined): boolean {
  if (tab.key === "me") return pathname === tab.to || screenTab === "me";
  return sidebarIsActive({ to: tab.to, end: tab.to === "/" }, pathname);
}
