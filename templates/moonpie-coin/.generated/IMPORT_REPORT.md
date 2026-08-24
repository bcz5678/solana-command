# Import report — moonpie-coin

Correct `overrides.json` and re-run. Never edit files under `.generated/`.

## blocker (2)

- `substitutions` — @import from a disallowed origin: https://googleapis.com — strip it, or add the origin to sanitize.allowedOrigins.
- `anonymize` — Anonymize brand, contract address, socials and legal entity before authoring the preset.

## confirm (9)

- `sections["launch"].type` — Type inferred as "prose" (confidence 0.8).
- `sections["vision"].type` — Type inferred as "prose" (confidence 0.95).
- `sections["offering"].type` — Type inferred as "prose" (confidence 0.95).
- `sections["coin"].type` — Type inferred as "prose" (confidence 0.95).
- `typeScale` — Worst fit is 30.2% off — the source's headings are not on a consistent scale. Decide whether to match it or be consistent.
- `substitutions.retoken[".logo|letter-spacing"]` — Mapped to core.typography.letterSpacingWide at confidence 0.6. Sources often use several arbitrary values here; they collapse to one token.
- `substitutions.retoken[".hero|min-height"]` — Mapped to templates.$.sectionMinHeight at confidence 0.6.
- `substitutions.retoken[".section|min-height"]` — Mapped to templates.$.sectionMinHeight at confidence 0.6.
- `substitutions.retoken[".kicker|letter-spacing"]` — Mapped to core.typography.letterSpacingWide at confidence 0.6. Sources often use several arbitrary values here; they collapse to one token.

## note (30)

- `substitutions` — .btn:hover { background-color } is identical to its base state — leave the hover token unset and let resolveTheme derive it.
- `substitutions` — Font "Manrope" is used but never loaded — every render has been falling back. Decide what the preset declares.
- `substitutions` — * declares "margin" 2 times — the earlier one is dead.
- `substitutions` — * declares "padding" 2 times — the earlier one is dead.
- `substitutions` — * declares "box-sizing" 2 times — the earlier one is dead.
- `substitutions` — core.typography.letterSpacingWide is written by 2 declarations with different values — .logo { letter-spacing: 3px }, .kicker { letter-spacing: 2px }. Resolution is stylesheet order, not intent: "2px" (.kicker) was kept, the rest were discarded.
- `substitutions` — semantic.navForeground is written by 2 declarations with different values — .nav-links a { color: #fff }, nav a { color: white }. Resolution is stylesheet order, not intent: "white" (nav a) was kept, the rest were discarded.
- `substitutions` — core.typography.lineHeightHeading is written by 3 declarations with different values — h1 { line-height: 1.05 }, h2 { line-height: 1.1 }, h3 { line-height: 1.1 }. Resolution is stylesheet order, not intent: "1.1" (h3) was kept, the rest were discarded.
- `substitutions.add` — Unmapped: header { padding-block: 25px }
- `substitutions.add` — Unmapped: header { padding-inline: 60px }
- `substitutions.add` — Unmapped: .logo { font-size: 28px }
- `substitutions.add` — Unmapped: .logo { font-weight: 800 }
- `substitutions.add` — Unmapped: .navbar { padding-block: 1rem }
- `substitutions.add` — Unmapped: .navbar { padding-inline: 2rem }
- `substitutions.add` — Unmapped: .menu-toggle { background: none }
- `substitutions.add` — Unmapped: .bar { background-color: #fff }
- `substitutions.add` — Unmapped: nav a { font-size: 14px }
- `substitutions.add` — Unmapped: nav a { text-transform: uppercase }
- `substitutions.add` — Unmapped: nav a { letter-spacing: 1px }
- `substitutions.add` — Unmapped: .hero .content { transform: translateY(-26%) }
- `substitutions.add` — Unmapped: .starship .content { transform: translateY(-26%) }
- `substitutions.add` — Unmapped: .human .content { transform: translateY(-26%) }
- `substitutions.add` — Unmapped: .network .content { transform: translateY(-26%) }
- `substitutions.add` — Unmapped: .kicker { font-size: 15px }
- `substitutions.add` — Unmapped: .btn { padding-block: 14px }
- `substitutions.add` — Unmapped: .btn { padding-inline: 34px }
- `substitutions.add` — Unmapped: .btn { letter-spacing: 1px }
- `substitutions.add` — Unmapped: .btn:hover { color: black }
- `substitutions.add` — Unmapped: .nav-links { padding-block: 1rem }
- `substitutions.add` — Unmapped: .nav-links { padding-inline: 0 }

## Images pending download

- `hero` ← assets/banner.jpeg
- `sections[0]` ← assets/img1.jpeg
- `sections[1]` ← assets/img2.jpeg
- `sections[2]` ← assets/img3.jpeg
