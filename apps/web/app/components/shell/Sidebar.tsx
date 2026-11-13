import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { IntentLink } from "../ui/IntentLink";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { useChangelogSeen } from "../../lib/local-state";
import { activeSidebarItem, navGroups, type NavItem } from "./nav";
import { useScreen } from "./screens";
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

/** The column's width and whether it is folded, kept in this browser. */
const WIDTH_KEY = "aihot-sidebar-width";
const FOLDED_KEY = "aihot-sidebar-folded";
const MIN_WIDTH = 168;
const MAX_WIDTH = 320;

function useSidebarColumn() {
  const [width, setWidthState] = useState(180);
  const [folded, setFoldedState] = useState(false);
  useEffect(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH) setWidthState(stored);
    setFoldedState(localStorage.getItem(FOLDED_KEY) === "1");
  }, []);
  const setWidth = useCallback((next: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next)));
    setWidthState(clamped);
    localStorage.setItem(WIDTH_KEY, String(clamped));
  }, []);
  const setFolded = useCallback((next: boolean) => {
    setFoldedState(next);
    localStorage.setItem(FOLDED_KEY, next ? "1" : "0");
  }, []);
  return { width, setWidth, folded, setFolded };
}

/**
 * The column's edge: drag it to widen or narrow the column, click it to fold the column to its marks.
 * The width survives a reload, so the reader keeps the column they set.
 */
function ColumnEdge({ width, setWidth, onFold }: { width: number; setWidth: (w: number) => void; onFold: () => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setWidth(start.current.width + (event.clientX - start.current.x));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };
  return (
    <div
      role="separator"
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onFold}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setWidth(width - 12);
        if (event.key === "ArrowRight") setWidth(width + 12);
      }}
      className={`absolute inset-y-0 -right-1 w-2 cursor-col-resize touch-none ${dragging ? "bg-accent/40" : "hover:bg-accent/20"}`}
    />
  );
}

function SideLink({ item, dot, active }: { item: NavItem; dot: boolean; active: boolean }) {
  const Icon = item.icon;
  return (
    <IntentLink
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center gap-2.5 rounded-control px-2.5 text-[14px] transition-colors duration-150 touch:h-11 ${
        active ? "bg-accent/10 font-semibold text-ink dark:bg-accent-soft" : "font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink"
      }`}
    >
      <span className={`flex w-[22px] shrink-0 justify-center ${active ? "text-accent" : ""}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      {dot && item.changelog && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-hot" aria-label="有新的更新" />}
    </IntentLink>
  );
}

/**
 * The marks that stand in for the column on narrow desktops (an unfolded foldable, a tablet upright, a
 * phone on its side) and when the reader folds the column: the same entries in the same order as the
 * full column, the site's own pages at the foot.
 */
function Rail({ dot, folded }: { dot: boolean; folded: boolean }) {
  const { pathname } = useLocation();
  const { tab, home } = useScreen();
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
    <aside
      className={`scrollbar-thin sticky top-0 hidden h-dvh w-[72px] shrink-0 flex-col items-center border-r border-line bg-sidebar px-1.5 pb-[max(14px,env(safe-area-inset-bottom))] pt-5 lg:flex short:overflow-y-auto short:pt-3 ${folded ? "" : "wide:hidden"}`}
    >
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
  const { width, setWidth, folded, setFolded } = useSidebarColumn();
  // The links scroll between the wordmark and the footer; in a short window the footer would leave them
  // only a few rows, so the whole column scrolls instead.
  return (
    <>
      <Rail dot={dot} folded={folded} />
      {!folded && (
        <aside
          className="scrollbar-thin sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-6 wide:flex short:overflow-y-auto"
          style={{ width }}
        >
          <Link to="/" className="mb-4 flex h-[50px] shrink-0 items-center gap-2 px-1 text-ink" aria-label={`${SITE.name} 首页`}>
            <MarkEmblem className="size-6 shrink-0 text-accent" />
            <Wordmark size={22} />
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
                    <div className="px-2.5 pb-1 pt-3.5 text-[11px] text-ink-4">{section.title}</div>
                    <div className="flex flex-col gap-1">
                      {section.items.map((item) => (
                        <SideLink key={item.to} item={item} dot={dot} active={item.to === lit?.to} />
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </nav>
          <div className="mt-2 space-y-2.5 px-1 pt-1">
            {SITE.github && (
              <a
                href={SITE.github}
                target="_blank"
                rel="noopener noreferrer"
                className="mx-1 flex h-[34px] items-center justify-center gap-1.5 rounded-full border border-line text-[12.5px] text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink touch:h-11"
              >
                <IconGithub size={15} />
                <span>GitHub</span>
              </a>
            )}
            {/* Centred under the buttons; the full width keeps the longer public-security number on one line. */}
            <div className="-mx-1 flex flex-col items-center gap-1.5">
              <Filings className="whitespace-nowrap text-[9.5px] leading-[1.3] text-ink-4 hover:text-ink-3" badgeSize={10} />
            </div>
            <ThemeSwitch />
          </div>
          <ColumnEdge width={width} setWidth={setWidth} onFold={() => setFolded(true)} />
        </aside>
      )}
    </>
  );
}
