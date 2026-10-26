# Plotline brand

Summary of the Plotline Brand Style Guide (Canva, "Brand Guidelines", design `DAHY_QGMe1o`, read on 2026-10-26). M11 restyles the app from it (TASKS.md M11, SPEC §10). If the guide changes, update this file first.

## Identity

- **Name:** plotline (the wordmark is lowercase).
- **Tagline:** "Plot your day. Fill your hours."
- **Mission:** simple, efficient booking for pickleball court owners that fills more playing hours and gives every player a better booking experience.
- **Values:** Simplicity, Efficiency, Reliability.

## Logo

- A rounded square tile in dusty rose, with a warm-brown line chart of four nodes (white nodes; the third node is sage with "km" in it), above the wordmark "plotline" in Fraunces and the tagline.
- **Primary (light):** on cream, white or soft pastel backgrounds.
- **Secondary (dark):** on warm brown only; the wordmark and tagline turn cream.
- **Clear space:** half the tile's width on every side.
- **Minimum size:** 32px wide on screen. Below that, use the tile alone (favicon).
- **Never** stretch, recolor, rotate or add shadows.
- Source files: the Canva account has no SVG export, but `/Users/macbookpro/Documents/Projects/plotline-site/public/logo.svg` (324×324, tile only, ~52 kB: the "km" node is traced paths) already exists. T11.3 starts from it: copy it for the tile and favicon, and size-optimize it (it has many unused clip-paths). The wordmark is live text there (see below), so no wordmark SVG is needed.

## Colors

| Name | Hex | Use |
| --- | --- | --- |
| Warm brown | `#3B2F2A` | Text, lines, dark backgrounds |
| Soft brown | `#5A4A42` | Secondary text |
| Cream | `#F5EFE6` | Main background |
| Dusty rose | `#E8C4B8` | Logo tile, promos |
| Sage | `#B7C4A8` | Buttons, accents |
| Sand | `#E6D9C6` | Dividers, soft panels |
| Terracotta | `#7A3F2C` | Highlight words |

Keep backgrounds light and use brown for text. Sage and dusty rose are too light for text or thin outlines on cream: buttons in sage take warm-brown text, and outlines, focus rings and links need darker shades (worked out and contrast-checked in T11.1).

## Typography

| Font | Use | Weights |
| --- | --- | --- |
| Fraunces (serif; the guide spells it "Faunces") | Headlines and the wordmark | SemiBold 600, Bold 700 |
| DM Sans | Body text, labels and buttons | Medium 500, Bold 700 |

Sample pairing from the guide: "Book your court in three taps" (Fraunces) over "Pick a time, confirm, and show up. We handle the rest." (DM Sans).

## Visual elements

Flat geometric shapes (quarter circles, rings, arches, leaf and star cut-outs) in the palette colors. Optional decoration for the hero, login and empty states; never behind text.

## Contacts

- Brand and marketing: Kyla Khorrine Alingasa
- Website and technical lead: Marc Baring

## Reference implementation: plotline-site

`/Users/macbookpro/Documents/Projects/plotline-site` (Vite + React, same stack) applied this guide. Patterns to reuse in M11; its `src/styles/global.css` is the source.

- **Two token layers.** Fixed brand palette (`--brown`, `--cream`, `--rose`, `--sage`, `--sand`, `--terracotta`, never redefined) plus derived shades (`--warm-white #fffcf7`, `--sage-soft #e5ebdd`, `--sage-dark #9fae8f`, `--rose-soft #f6e4dd`). Components use only role tokens (`--bg`, `--surface`, `--field`, `--text`, `--text-soft`, `--line`, `--highlight`, `--panel`, `--band`, `--ok`, `--err`, ...). Dark theme only redefines the roles.
- **Light = the primary logo on cream; dark = the secondary logo on warm brown** (`prefers-color-scheme`). Dark: `--bg` brown, `--surface #45372f`, `--bg-alt #342924`, `--field #2f2521`, `--text` cream, `--line` soft brown.
- **Highlights:** terracotta in light, dusty rose in dark (terracotta fails on brown). Links use `--highlight`.
- **Status:** `--ok #4c6b3c` (sage in dark), `--err #a3361f` (`#f2b4a3` in dark), each with a soft background.
- **Buttons:** pill (radius 30px), DM Sans bold 15px. Primary is sage with warm-brown text, hover `--sage-dark`. Ghost has a 1.5px `--text` outline. "Dark" button is `--text` on `--bg`.
- **Inputs:** focus ring is `border-color: --text-soft` plus a 3px `rgba(183,196,168,.55)` sage glow. (Check this against the 3:1 non-text contrast rule in T11.1 before copying: the glow alone is too light on cream.)
- **Type:** headings Fraunces 600, h1/h2 700; body DM Sans 500, buttons 700. Google Fonts link `DM Sans 500;700` and `Fraunces opsz 9..144, 600;700`. We plan to self-host instead (T11.1).
- **Wordmark is live text:** lowercase Fraunces 700, 23px, beside a 38px tile, taking the theme text color. An optional `<b>` suffix uses `--highlight`.
- **Shapes:** a sand ring (320px, 56px border) and a rose dot (180px) positioned behind the hero, clipped by the section, decorative only.
- **Radius** 18px for cards; 14px for details/FAQ rows. Shadow `0 12px 34px rgba(59,47,42,.1)`.
- **Meta:** `theme-color` `#F5EFE6` (light) and `#3B2F2A` (dark) by media query; favicon is `logo.svg`.
