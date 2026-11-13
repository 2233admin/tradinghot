import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { IntentLink } from "../ui/IntentLink";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { useChangelogSeen } from "../../lib/local-state";
import { activeSidebarItem, navGroups, type NavItem } from "./nav";
import { ThemeSwitch } from "./ThemeSwitch";
import { Filings } from "./Filings";
import { IconGithub } from "../icons";
import { MarkEmblem } from "./nav-marks";

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !latestVersion) return false;
  return !seen || seen < latestVersion;
}

/**
 * The column's width, kept to the width the reference layout uses: a fixed nav column beside the feed
 * and the aside, so the reading measure does not move when the window changes.
 */
const NAV_WIDTH = 275;

/**
 * One entry of the nav column: the mark, the name, and the dot for a new release. The row is a pill, the
 * way the reference layout draws its nav, and the active row keeps its mark in the accent colour.
 */
function SideLink({ item, dot, active }: { item: NavItem; dot: boolean; active: boolean }) {
  const Icon = item.icon;
  return (
    <IntentLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={`group flex h-11 items-center gap-4 rounded-full px-4 text-[15px] transition-colors duration-150 touch:h-12 ${
        active ? "font-semibold text-ink" : "font-medium text-ink-2 hover:bg-bg-sunk hover:text-ink"
      }`}
    >
      <span className={`flex w-[22px] shrink-0 justify-center ${active ? "text-accent" : "text-ink-2 group-hover:text-ink"}`}>
        <Icon size={22} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      {dot && item.changelog && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-hot" aria-label="有新的更新" />}
    </IntentLink>
  );
}

/**
 * The marks that stand in for the column on narrow desktops (an unfolded foldable, a tablet upright, a
 * phone on its side): the same entries in the same order as the full column, the site's own pages at
 * the foot.
 */
function Rail({ dot }: { dot: boolean }) {
  const { pathname } = useLocation();
  const groups = navGroups();
  const top = groups[0]?.items ?? [];
  const bottom = groups.slice(1).flatMap((section) => section.items);
  const mark = (item: NavItem) => {
    const Icon = item.icon;
    const on = item.to === pathname || (item.to === "/" && pathname === "/");
    return (
      <IntentLink
        key={item.to}
        to={item.to}
        aria-current={on ? "page" : undefined}
        title={item.label}
        className={`relative flex h-12 shrink-0 flex-col items-center justify-center gap-[2px] text-[10.5px] transition-colors duration-150 ${
          on ? "bg-accent/10 font-semibold text-ink" : "font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink"
        }`}
      >
        {on && <span aria-hidden="true" className="absolute inset-y-1 left-0 w-[2px] bg-accent" />}
        <span className={on ? "text-accent" : ""}>
          <Icon size={19} />
        </span>
        <span className="hidden max-w-full truncate min-[820px]:block">{item.short ?? item.label}</span>
        {dot && item.changelog && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-hot" aria-label="有新的更新" />}
      </IntentLink>
    );
  };
  return (
    <aside className="scrollbar-thin sticky top-0 hidden h-dvh w-[72px] shrink-0 flex-col items-center border-r border-line bg-sidebar px-1.5 pb-[max(14px,env(safe-area-inset-bottom))] pt-5 lg:flex xl:hidden short:overflow-y-auto short:pt-3">
      <Link to="/" className="mb-3 flex size-11 shrink-0 items-center justify-center text-accent short:mb-1" aria-label={`${SITE.name} 首页`}>
        <MarkEmblem className="size-7" />
      </Link>
      <nav className="flex w-full flex-col" aria-label="主导航">
        {top.map(mark)}
      </nav>
      <nav className="mt-auto flex w-full flex-col border-t border-line pt-2" aria-label="站点">
        {bottom.map(mark)}
      </nav>
    </aside>
  );
}

export function Sidebar({ changelogVersion }: { changelogVersion: string | null }) {
  const dot = useChangelogDot(changelogVersion);
  const { pathname } = useLocation();
  return (
    <>
      <Rail dot={dot} />
      {/*
        The nav column, the width the reference layout uses: the wordmark at the top, the lanes down the
        column, the site's own pages at the foot. Below `xl` the marks stand in for it.
      */}
      <aside
        className="scrollbar-thin sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar px-2 pb-[max(14px,env(safe-area-inset-bottom))] pt-4 xl:flex short:overflow-y-auto"
        style={{ width: NAV_WIDTH }}
      >
        <Link to="/" className="mb-2 flex h-[50px] shrink-0 items-center gap-2.5 px-3 text-ink" aria-label={`${SITE.name} 首页`}>
          <MarkEmblem className="size-7 shrink-0 text-accent" />
          <Wordmark size={23} />
        </Link>
        <nav className="scrollbar-thin -mx-1 flex flex-1 flex-col overflow-y-auto px-1 short:flex-none short:overflow-visible" aria-label="主导航">
          {(() => {
            // The reader's lanes sit at the top; the site's own pages (settings, about, log, feedback)
            // are pinned to the foot of the column, separated by a hairline.
            const sections = navGroups();
            const last = sections.length - 1;
            return sections.map((section, index) => {
              // Only the most specific entry of a section is lit, so a detail page does not light the list above it too.
              const lit = activeSidebarItem(section.items, pathname);
              return (
                <div key={section.title} className={index === last ? "mt-auto border-t border-line pt-2" : ""}>
                  <div className="px-4 pb-1 pt-4 text-[11px] text-ink-4">{section.title}</div>
                  <div className="flex flex-col gap-0.5">
                    {section.items.map((item) => (
                      <SideLink key={item.to} item={item} dot={dot} active={item.to === lit?.to} />
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </nav>
        <div className="mt-2 space-y-2 px-1 pt-1">
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            {SITE.github && (
              <a
                href={SITE.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink"
              >
                <IconGithub size={16} />
              </a>
            )}
          </div>
          {/* Centred under the buttons; the full width keeps the longer public-security number on one line. */}
          <div className="-mx-1 flex flex-col items-center gap-1.5">
            <Filings className="whitespace-nowrap text-[9.5px] leading-[1.3] text-ink-4 hover:text-ink-3" badgeSize={10} />
          </div>
        </div>
      </aside>
    </>
  );
}
