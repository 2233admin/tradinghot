---
name: 股市热点 · 读者界面（明日方舟语言）
tokens:
  ground: "#0f1116"
  panel: "#15181e"
  surface: "#191d24"
  surfaceRaised: "#1e232b"
  accent: "#a3c4d5"
  text: "#eef2f5"
  muted: "#9aa6b0"
  faint: "#69737e"
  border: "rgba(255,255,255,0.075)"
  borderStrong: "rgba(255,255,255,0.14)"
  accentDim: "rgba(163,196,213,0.20)"
  accentWash: "rgba(163,196,213,0.10)"
---

## Product Context

**股市热点** is a reader-facing Chinese finance site: 72 sources (exchange notices, wires, media,
community forums, X accounts) are collected continuously, judged, and published as a feed, a daily
report and per-source pages. The reader arrives on a phone during trading hours and wants to know
**what happened and when** — not to browse a magazine.

- Real brands: 明日方舟 / Arknights (design language only, no characters or artwork)
- Active synthesis change: feed-arknights-redesign (`design/changes/feed-arknights-redesign/`)
- Brand facts: `design/changes/feed-arknights-redesign/brand-facts.md`

## Overview

**Brand & style**: Arknights' interface language, adopted as the site's own.

A **terminal panel**, not a magazine. The screen is an instrument: the market's own words, the time
they were said, and nothing else in the way. Dense, square, cold, and legible at a glance.

The language comes from Arknights' official interface: a near-black ground, hairline structure, one
desaturated cold blue as the only saturated colour, condensed display type for the numbers, and a
tight spacing base. The reader's Chinese stays in Noto Sans CJK SC; only the instrument layer
(times, scores, day headers, chips) changes face.

The three lanes stay apart on screen: **资讯** (news wires), **X 大V** (accounts), **散户闲聊**
(community forums). A card never mixes lanes, and the lane is named once, on the chip.

## Colors

| token | value | role |
| --- | --- | --- |
| `--bg` | `#0f1116` | the ground; the page's darkest value |
| `--bg-panel` | `#15181e` | the rail and the note panels, one step above the ground |
| `--bg-surface` | `#191d24` | a card |
| `--bg-surface-hi` | `#1e232b` | a card under the pointer |
| `--line` | `rgba(255,255,255,.075)` | the hairline: every separation in the interface |
| `--line-strong` | `rgba(255,255,255,.14)` | a hairline that must read (hover, active border) |
| `--accent` | `#a3c4d5` | the **only** saturated colour: the active tab, the time column, the rail dot, the score, the channel chip |
| `--accent-dim` | `rgba(163,196,213,.20)` | an accent border |
| `--accent-wash` | `rgba(163,196,213,.10)` | an accent ground behind an active item |
| `--ink` | `#eef2f5` | body text |
| `--ink-2` | `#9aa6b0` | the summary and the source name |
| `--ink-3` | `#69737e` | meta, tags, inactive tabs |

Rules: one saturated colour; value steps carry hierarchy; no hue except the accent; no colour
means "state", never "decoration".

## Typography

| role | face | size | note |
| --- | --- | --- | --- |
| day header | display (Oswald) | 15 px, tracked +0.10em, uppercase | the reference's numeral voice; the mono stack stands in until Oswald is self-hosted |
| instrument (time, score) | display / mono | 12.5 px | the publish time and the score |
| card headline | Noto Sans CJK SC | 15.5 px / 1.45, 600 | the reader's headline |
| summary | Noto Sans CJK SC | 12.5 px / 1.6, muted | two lines, clamped |
| source · chip | Noto Sans CJK SC | 11.5 px | the source and the lane chip |
| meta · tag | Noto Sans CJK SC | 10.5–11.5 px | the dense small end the reference uses |

The reference's ladder (52.5 / 20.5 / 16.5 / 15 / 13.5 / 12 / 10) is the source of the steps; the
site's own h1 is 23 px.

## Layout & Spacing

- **Left rail 76 px**: the mark, the section links, hairline separators. The active link carries a
  2 px accent bar on its left edge and an accent wash — never a filled pill. Below the rail's width
  the page switches to the phone bar; the rail never squeezes the content.
- **Content column ≤ 1040 px**, centred, 22–26 px page padding.
- **Two filter rows**: the channels (5) and the categories (12). Both scroll horizontally; the
  scrollbar is a 5–6 px square rule at low contrast. **Nothing is cut off.**
- **Timeline**: a 64 px instrument column (the publish time), a 22 px rail (a 1 px line and a 7 px
  square dot), then the card. The time is the item's own publish time, so the rail is one continuous
  thread and the gutter agrees with the card.
- **Spacing base 3–7 px** (the reference's): card padding 11/13 px, gaps 6 / 8 / 10 px, rows 8 px
  apart.

## Components

- **Card** — flat surface, 1 px hairline, square corners, no shadow. Source · lane chip · score on one
  line; the headline; the summary clamped to two lines; tags and the original link as hairline chips.
- **Channel chip** — a 1 px outline chip: 资讯 in the accent, X 大V in a warm sand, 散户闲聊 in a
  grey-green. The lane is named once, here.
- **Tabs** — square, 1 px transparent border; the active one carries the accent text, the accent
  border and the accent wash.
- **Rail** — a 1 px vertical line with a 7 px square dot in the accent at each item's time.
- **Score** — the reference's numeral voice, right aligned in the card header.
- **Empty state** — a bordered panel on the panel ground, one line of muted text, never a blank page.

## Do's and Don'ts

**Do** — keep one saturated colour; let hairlines and value steps carry the hierarchy; put the
publish time beside the item; name the lane once; keep the summary in the source's own words; let
rows scroll instead of clipping; square everything.

**Don't** — don't use the cream theme's warm ground or terracotta accent; don't use a bright cyan on
near-black; don't round the corners or drop shadows; don't repeat the title in the summary; don't
put the site's own menu in a card; don't let a filter row be cut off; don't use a hue for
decoration.

## Source Decisions

**Evidence and adaptation** — what the reference gave, what we took, what we left.

- Evidence: `.design-pipeline/reference/arknights/` — the official site's computed styles, measured
  (not remembered). Colours closer than CIEDE2000 15 were merged; the coverage and the luminance
  order are in `palette-evidence.json`.
- **Adopted**: the primary `#a3c4d5`, the dark surface steps `#3b3b3b`/`#1a1a1a` (as `#191d24`/`#1e232b`
  on our ground), white text and hairlines, the Oswald / Novecento / Noto Sans CJK SC roles, the type
  ladder, the 3–7 px spacing base, the hairline-and-flat-panel structure.
- **Rejected**: the marketing page's white ground (we are a dark-first reading surface) and its
  low-contrast text greys (our summaries are long, so they need a higher step).
- **Not adopted, because it was never measured**: the amber accent in Arknights artwork. The X
  lane's warm sand is our own choice, stated as such.
- **Inferred, not observed**: every motion statement. No video of the reference was studied; the
  only motion proposed is a 120 ms colour change on hover and the site's existing 200 ms fades.
