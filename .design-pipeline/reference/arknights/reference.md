# Reference: 明日方舟 / Arknights

Observed from <https://arknights.global/> on 2026-11-14 with
`designer-pipeline reference extract` (1440×900, 254 visible elements, computed styles).
Machine evidence: `extraction.json`, `palette-evidence.json`, `design-md-draft.md` in this folder.

## What was actually measured

- **Type** — headings and display use **Oswald** (Bold / DemiBold); UI numerals and labels use
  **Novecentowide Medium**; Chinese text uses **Noto Sans CJK SC** (Regular / Medium). Scale runs
  52.5 / 20.5 / 19.5 / 18 / 16.5 / 16 / 15 / 13.5 / 12 / 10 px — a wide, deliberate range with a
  dense small end (10–13.5 px for meta information).
- **Colour** — a cool, near-neutral base with one saturated colour:
  - primary **#a3c4d5** (HSL saturation 0.37, hue ≈ 200°) — Arknights' cold "Rhodes Island" blue
  - surface **#3b3b3b**, with a darker step **#1a1a1a**
  - text / border **#ffffff**
  - The marketing page's own light ground is #ffffff; the dark panels are #3b3b3b / #1a1a1a.
  - Coverage: background 46–47 %, text 68–69 %, border 53–54 %, primary 35–36 %, surface 18–19 %.
  - Luminance order measured: background → border → text → primary → surface.
  - Saturation posture: a neutral base plus two saturated colours (primary #a3c4d5 and a fully
    saturated one not captured in the DOM pass).
  - Temperature: cool — chromatic colours centre on hue 200°; neutrals stay untinted.
- **Spacing** — the measured gaps cluster on a 3–7 px base, not an 8 px grid. The reference is
  **dense**: little air between related elements, more between groups.
- **5 cross-origin stylesheets could not be read for custom properties**, so the site's own token
  names are unknown; the values above are computed styles, not the site's variables.

## Uncertainties (kept explicit)

- The raster/media palette is **pending**: imagery and the hero were not measured as a separate
  source, so the accent that lives only in artwork (Arknights' amber/orange) is **not** in the
  measured palette. It must not be invented from memory.
- No motion was observed: no video, no frame pair. Every statement about movement, easing and
  transitions below is **inferred** from the layout's geometry, not measured.
- The extraction saw the marketing site, not the game's own interface screen. The game's UI is
  denser and darker than the marketing page; only what the page shows can be claimed.

## Design invariants to carry over (the parts that are not decoration)

1. **One saturated colour, used for state, not decoration.** The cold blue marks what is live or
   selected; everything else is neutral. The current site uses accent colour on many unrelated
   things at once, which flattens the hierarchy.
2. **A cold near-black ground with white text and hairline borders.** The site's own dark theme is
   near-black with a bright cyan accent and no visible structure; the reference separates figure
   from ground with *value steps* (#1a1a1a / #3b3b3b) and hairlines, not with hue.
3. **Display type for the numbers and titles, a CJK sans for the words.** Oswald gives the
   time-and-score fields their industrial, instrument-panel character; Noto Sans CJK SC carries the
   Chinese without a second family pretending to be one.
4. **Density over air.** The reference's gaps sit on a 3–7 px base; this site's cards currently
   float in far more space than the information needs.
5. **Hard geometry.** Straight edges, square corners, thin rules — the reference has no rounded
   "soft UI" vocabulary in its panels.

## What this changes in our site

- The palette becomes: ground `#0f1116`–`#1a1a1a` family, surface `#23262d`, hairline borders at
  low alpha white, text white / `#a3c4d5` for muted, and **#a3c4d5** as the single accent. The
  cream palette is dropped, not tuned.
- The card's time, score and source become the instrument-panel layer (Oswald / Novecento
  numerals); the Chinese headline and body stay Noto Sans CJK SC.
- The filter row becomes two rows of hard-edged tabs (channels, then categories) that scroll rather
  than truncate.
