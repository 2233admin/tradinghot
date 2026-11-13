---
version: alpha
name: "arknights.global (draft)"
description: "Draft tokens measured from https://arknights.global/ by reference extract; judge every value before adopting it."
colors:
  primary: "#a3c4d5"
  background: "#ffffff"
  surface: "#3b3b3b"
  text: "#ffffff"
  border: "#ffffff"
typography:
  heading-1:
    fontFamily: "(low confidence)"
    fontSize: 52.5px
    fontWeight: 400
  heading-2:
    fontFamily: "Oswald-Bold"
    fontSize: 20.5px
    fontWeight: 400
    lineHeight: 16.5px
  heading-3:
    fontFamily: "Oswald-DemiBold"
    fontSize: 19.5px
    fontWeight: 400
    lineHeight: 19.5px
  heading-4:
    fontFamily: "(low confidence)"
    fontSize: 18px
    fontWeight: 400
  heading-5:
    fontFamily: "NotoSansCJKsc-Regular"
    fontSize: 16.5px
    fontWeight: 400
    lineHeight: 25px
  heading-6:
    fontFamily: "Novecentowide-Medium"
    fontSize: 16px
    fontWeight: 400
  body:
    fontFamily: "Oswald-Bold"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 21px
  small-1:
    fontFamily: "Oswald-Bold"
    fontSize: 13.5px
    fontWeight: 400
  small-2:
    fontFamily: "NotoSansCJKsc-Medium"
    fontSize: 12px
    fontWeight: 400
  small-3:
    fontFamily: "NotoSansCJKsc-Regular"
    fontSize: 10px
    fontWeight: 400
spacing:
  space-1: 3px
  space-2: 4px
  space-3: 6px
  space-4: 7px
  space-5: 7.5px
  space-6: 10px
  space-7: 10.5px
  space-8: 11.5px
  space-9: 15px
  space-10: 19.5px
  space-11: 28px
  space-12: 40px
---

# arknights.global (draft)

## Measured, not judged

These tokens were measured from https://arknights.global/ at 1440x900 on 2026-11-13T18:52:19.419Z by `reference extract` (DOM computed styles; no model).
Judge them against the reference before copying any into DESIGN.md: rename roles, drop incidental values and record what you borrow under Source Decisions.

## Fonts

- Heading: (low confidence)
- Body: Oswald-Bold

## Low confidence

- (low confidence) background surfaces: #dde3e4 (CIEDE2000 6.7), #e4eaeb (CIEDE2000 5.4), #e4eced (CIEDE2000 5.6) merged into #ffffff; on a dark or tinted site this may be a designed surface step, so check the raw members in extraction.json before dropping it
- (low confidence) background surfaces: #a6b8bd (CIEDE2000 6.1) merged into #a3c4d5; on a dark or tinted site this may be a designed surface step, so check the raw members in extraction.json before dropping it
- (low confidence) background surfaces: #1a1a1a (CIEDE2000 10.5) merged into #3b3b3b; on a dark or tinted site this may be a designed surface step, so check the raw members in extraction.json before dropping it
- (low confidence) heading font: no named family appears on two or more heading or display elements
- (low confidence) spacing grid: no 8 px or 4 px base covers 80% of the measured spacing values
