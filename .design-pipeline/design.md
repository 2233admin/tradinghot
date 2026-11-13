# Design: the reader interface in the Arknights language

The owner asked for 明日方舟's design language and palette on 2026-11-14, and for a static mockup
first. The mockup is `graybox/feed-arknights.html`, rendered to `graybox.png`; its data is the live
site's own feed.

## The idea in one line

A **terminal panel**, not a magazine: the reader's screen is an instrument that shows what happened
and when, with the market's own words — dense, square, cold, and legible at a glance.

## Tokens (measured, not invented)

From `.design-pipeline/reference/arknights/` (the official site's computed styles):

| role | value | why |
| --- | --- | --- |
| ground | `#0f1116` | the measured dark step `#1a1a1a` lifted into a cool near-black |
| panel (rail) | `#15181e` | one value step above the ground, so the rail reads without a border |
| card | `#191d24` | the measured surface `#3b3b3b` darkened to sit between ground and text |
| hairline | `rgba(255,255,255,.075)` | the measured border is white at low coverage |
| accent | `#a3c4d5` | the measured primary (HSL sat 0.37, hue 200°) — the **only** saturated colour |
| text | `#eef2f5` | the measured white, softened just enough for long reading |
| muted / faint | `#9aa6b0` / `#69737e` | two steps below the text; the reference's dense small end |

Type: the **Oswald** slot carries the instrument layer (times, scores, the day header, the channel
chips) — uppercase, tracked out, the way the reference sets its numerals; **Noto Sans CJK SC** carries
every Chinese word; the site's existing mono stack stands in for Oswald until it is self-hosted.

Scale: the reference's 52.5 / 20.5 / 16.5 / 15 / 13.5 / 12 / 10 px ladder, used as
h1 23 · card headline 15.5 · body 12.5 · meta 11.5 · instrument 12.5 mono.

Spacing: the reference's 3–7 px base, so the card's internal gaps are 6 / 8 / 10 px and the rows
sit 8 px apart.

## Layout

- **Left rail (76 px)** — the mark, the section links, hairline separators. The active link carries a
  2 px accent bar on the left edge and an accent-tinted ground, never a filled pill.
- **Content column (max 1040 px)** — the title, the two filter rows, then the timeline.
- **Filter rows, two of them** — the channels (全部 / 资讯 / X 大V / 散户闲聊 / 一手) and the
  categories (12 of them). Both scroll horizontally; the scrollbar is a 5–6 px square rule at low
  contrast, never the browser's chunky one. Nothing is ever cut off: the category row scrolls.
- **Timeline** — a 64 px instrument column (the publish time, mono, accent), a 22 px rail carrying a
  1 px line and a 7 px square dot, then the card. The time is the item's own publish time, so the
  rail reads as one continuous thread and the gutter agrees with the card.
- **Card** — flat panel, 1 px hairline, square corners, no shadow. Source · channel chip · score on
  one line; the headline at 15.5 px; the summary clamped to two lines in muted grey; tags and the
  original link as small hairline chips.

## What the lanes mean on screen

The channel chip carries the lane, and it is the only place the lane is named: 资讯 (cold blue),
X 大V (warm sand), 散户闲聊 (grey-green). The three lanes never mix inside one row.

## Uncertainties and what stays open

- The amber accent in Arknights artwork was never measured → **not used**. The X lane uses a warm
  sand instead, which is this site's own choice, not a measured fact.
- Oswald is not installed on this machine → the mockup stands in with the mono stack. Self-hosting
  Oswald (or a condensed substitute) is a decision for the implementation, not the concept.
- No motion was observed in the reference. The only motion proposed is a 120 ms colour change on
  hover and the existing 200 ms fades — stated as a choice, not as evidence.

## How it lands in the code

1. `apps/web/app/app.css` — the token block (the site reads its colours from CSS variables) and the
   custom slim square scrollbars.
2. `apps/web/app/components/shell/Sidebar.tsx` + `root.tsx` — the rail: square links, an accent bar
   for the active one, no text-label overflow at narrow widths.
3. `apps/web/app/features/feed/Filters.tsx` — the two filter rows (already split) and the new chip
   and tab styling.
4. `apps/web/app/features/feed/{Timeline,DayList,FeedItem,parts}.tsx` — the instrument column, the
   rail, the card.
5. The theme switch keeps both grounds; the cream theme becomes the light counterpart of the same
   token set rather than a separate palette.

## Spec Reconciliation

Graybox: `graybox.png`, captured 2026-11-14T03:14:00+08:00 (the mockup in `graybox/feed-arknights.html`,
rendered from the live feed).
Reconciled: 2026-11-14T03:20:00+08:00

| Value | Specified | Implemented | Cause |
| --- | --- | --- | --- |
| X lane chip | warm sand `#d7c39a` | warm sand `#d7c39a` | — |
| amber accent | not adopted | not present | the amber was never measured in the reference's computed styles |
| scrollbar | 5–6 px square rule | same | — |
| Oswald display face | Oswald | mono stack stand-in | Oswald is not installed on this machine |
