# Change Design

Change: `feed-arknights-redesign` — the reader interface in the Arknights language.

## Requirements Map

| product requirement | workflow | design consequence |
| --- | --- | --- |
| 一进来就知道现在该看什么 | arriving on the feed during trading hours | the publish time is the first column, not the fetch time; the lane is on the card |
| 快讯 / 大V / 散户闲聊分得开 | scanning a mixed feed | one lane per card, named once on a chip; a channel filter row |
| 按事件发生的时间排 | reading the timeline | the timeline's instrument column and the card header both carry `published_at` |
| 摘要别掺站点自己的东西 | reading a card | the summary is the source's own text; the page's opening is only the fallback |
| 窄屏不能挤坏 | a narrow window or a zoomed browser | two filter rows that scroll; a rail that gives way instead of squeezing |
| 一眼扫完 | skimming | dense spacing (3–7 px base), small meta, square cards, one accent |

## Evidence Adoption Matrix

| source | observed property | decision | product-specific reason | target |
| --- | --- | --- | --- | --- |
| arknights.global (computed styles) | primary `#a3c4d5`, sat 0.37, hue 200° | adopt | the only saturated colour our pages need is "live/selected" | `--accent` |
| arknights.global | surface `#3b3b3b`, step `#1a1a1a` | adopt, retuned to `#191d24`/`#1e232b` | our ground is a cooler near-black, so the panels sit one step above it | `--bg-surface` |
| arknights.global | border white at 53–54 % coverage | adopt as a hairline | our separators are hairlines, not blocks | `--line` |
| arknights.global | Oswald / Novecento / Noto Sans CJK SC | adopt the roles | the numerals are the instrument layer; the Chinese needs its own face | display / CJK stacks |
| arknights.global | type ladder 52.5→10 px | adopt the steps | our longest headline is 15.5 px; the meta end is 10.5 px | type scale |
| arknights.global | 3–7 px spacing base | adopt | our cards carried far more air than the information needs | spacing |
| arknights.global | white ground, low-contrast greys | reject | we are a dark reading surface; long summaries need a higher text step | — |
| Arknights artwork (not measured) | amber accent | not adopted | it was never measured; the X lane's warm sand is our own stated choice | — |

## Product Design Output

`DESIGN.md` (project root) holds the tokens and the rules. They land in:

1. `apps/web/app/app.css` — the token block and the custom slim square scrollbars.
2. `apps/web/app/components/shell/Sidebar.tsx`, `root.tsx` — the rail: square links, an accent bar on the active one, the narrow-width fallback.
3. `apps/web/app/features/feed/Filters.tsx` — the two filter rows (already split) with the new tab and chip styling.
4. `apps/web/app/features/feed/{Timeline,DayList,FeedItem,parts}.tsx` — the instrument column, the rail, the card.
5. The light theme becomes the counterpart of the same token set, not a second palette.

## Component Source

The components come from **Rare UI** (github.com/swamimalode07/rare-ui), a shadcn-style registry of
animated components: MIT + Commons Clause + Attribution, so every vendored file keeps its header and
the site credits it. Components are copied into the app (no runtime dependency), and the ones that
arrive with their own palette are re-pointed at this project's tokens (`bg-ink`, `bg-bg`, `stroke-ink`)
and at this project's square corners.

| Component | Where it lands | What it brings |
| --- | --- | --- |
| `animated-counter` | `apps/web/app/components/ui/animated-counter.tsx` | the digits that roll into place (the crowding page's index point and score) |
| `scroll-progress` | `apps/web/app/components/ui/scroll-progress.tsx` | the reading ring on the article page, with the outline's entries as the sections it can jump to |

`clsx` and `tailwind-merge` arrive with them, for the `cn` helper in `apps/web/app/lib/utils.ts`.

The layout follows the reference (Twitter/X): a fixed nav column on the left (275px, mark and name),
the feed in the middle under a header that stays while it scrolls, and an aside on the right (350px:
search, what is hot right now, the foot of the site). Phones keep the tab bar at the foot.

## Spec Reconciliation

Graybox: `graybox.png`, captured 2026-11-14T03:14:00+08:00 (the mockup in
`design/changes/feed-arknights-redesign/graybox/feed-arknights.html`, live site data)
Reconciled: 2026-11-14T03:16:00+08:00

| Value | Specified | Implemented | Cause |
| --- | --- | --- | --- |
| X lane chip colour | warm sand `#d7c39a` | warm sand `#d7c39a` | — |
| amber accent | not adopted | not present | the amber was never measured in the reference's computed styles |
| scrollbar | 5–6 px square rule, low contrast | same | — |
| Oswalldisplay face | Oswald | mono stack stand-in | Oswald is not installed on this machine; the role is kept, the face is pending |

The implementation has not changed any specified value yet: the graybox is the spec.
