# Directions

Three distinct directions for the reader interface, each with its own fit, risk and evidence.

## A — 仪表盘 / Terminal panel (**selected**)

Arknights' own interface language: near-black cool ground, one desaturated cold blue as the only
accent, hairline structure, flat square cards, the times and scores in a condensed display face,
the Chinese in Noto Sans CJK SC, density on a 3–7 px base.

- **Fit**: the feed is an instrument — what happened, when, from where. A terminal panel answers
  that in one glance and never competes for attention.
- **Risk**: the cold palette is less warm than the current cream; long summaries need a higher
  text step than the reference's greys.
- **Adopted evidence**: primary `#a3c4d5`, the dark surface steps, white text and hairlines, the
  Oswald/Novecento/Noto CJK roles, the type ladder, the 3–7 px base.
- **Rejected evidence**: the marketing page's white ground and its low-contrast greys; the unmeasured
  amber.
- **Graybox**: `graybox.png` (the live-data mockup in `graybox/feed-arknights.html`).

## B — 报纸 / Newspaper column

A serif headline on a paper-white ground, hairline column rules, a narrow measure, the date in the
masthead, sources in small caps.

- **Fit**: the daily report and the long reads want a reading column.
- **Risk**: a paper metaphor fights the product — a reader checks the feed between trades, and a
  serif column asks for attention we cannot spend. It also loses the three lanes: a newspaper has
  one column.
- **Adopted evidence**: none of the measured Arknights tokens fit this direction; it borrows only
  the reference's restraint (one accent, hard edges).

## C — 终端绿 / Phosphor terminal

Black ground, phosphor green as the single accent, monospace everywhere, a blinking cursor, ASCII
rules.

- **Fit**: the "instrument" mood at its most literal, and it reads well for a dense quote stream.
- **Risk**: green-on-black is the most worn retro cliché in this genre and would date the site; the
  Chinese text is the weakest in a monospace face; the reference's cold blue is the opposite of
  phosphor.
- **Adopted evidence**: none. It contradicts the measured palette.

## Selected

**A** — the owner named 明日方舟's design language and palette as the direction (2026-11-14) and
accepted a static mockup before implementation. B and C are recorded as considered and rejected:
B drops the lane separation, C contradicts the measured palette.

## The draw (2026-11-14, `direction draw --medium web`)

The roulette drew two specimens, both read through the owner's context (明日方舟):

- **web #19 Swiss 极致黑白** (Vercel-style pure black and white, sharp corners, a metrics band) —
  *structurally* the closest thing to the Arknights language: monochrome, square, instrument-like.
  What it drops is the one saturated colour, which is the reference's whole point. Its metric band
  (覆盖/延迟/精度/价格) is worth borrowing as a pattern for the reader's own numbers.
- **east #07 中国传统色·节气色谱** — a warm cream ground with vermilion and the solar-term colours. It
  is the cream palette the owner ruled out; rejected on the owner's own anti-goal, not on taste.

Both are recorded in the appearance ledger; neither replaces the selected direction.
