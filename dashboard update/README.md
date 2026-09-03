# Handoff: Dashboard redesign (California ERP)

## Overview
Reorganized visual design for the admin Dashboard screen of the California mini-ERP (`yyelyahh/californiapp`, `src/pages/Dashboard.tsx`). Same underlying data/decisions as today's screen — this is a visual/layout redesign, not a new feature. The chosen direction (**2a**) surfaces two decisions the owner makes from this screen: **what to restock now** and **which model has the best margin**, using data the app already computes (stock, cost, sale price, sales in period). No new backend data.

## About the Design Files
The files in this bundle are **design references built in HTML** (Nocturne design-system tokens/components) — prototypes of look and layout, not production code. The task is to **recreate this design inside the existing California codebase** (React + Vite + Tailwind + shadcn/ui, per `src/pages/Dashboard.tsx` and `src/components/AppLayout.tsx`), using the app's existing component library, motion helpers (`src/lib/motion.ts`), and data hooks (`useStore`) — not by dropping in the HTML/CSS as-is.

## Fidelity
**High-fidelity.** Colors, type, spacing and component shapes below are final. Numbers shown are the same sample dataset as today's dashboard (Agosto/2026); wire to the real `useStore` data source when implementing. Two sub-metrics used only in the reorganized views (vende/dia, dias de estoque restante, custo estimado de reposição, receita por modelo) are **derivable from existing fields** (stock qty, recent sales, cost, price) — no new DB columns needed, but the exact aggregation query is a backend decision left for implementation.

## Chosen direction: "2a"
Left rail icon sidebar (56px) + content + a fixed 312px right column ("Dinheiro do mês"). Kept from today's dashboard: KPIs, margem bruta/despesas/estoque, modelos mais vendidos, gráfico de 6 meses, últimas vendas, filtro por mês. Dropped from first plane: "Insights automáticos" panel and "Exportar Excel" button (not marked essential by owner — can be added back, e.g. as a secondary action, if needed).

### Layout structure
- Outer frame: `display:flex`, full height.
- **Left rail** — 56px fixed width, icon-only nav (Phosphor icons), same 10 nav items as today's sidebar, vertically centered, active item gets an accent-tinted rounded background.
- **Main column** (flex:1, min-width:0), padding 22px/22px/26px, `display:flex; flex-direction:column; gap:16px`:
  1. Header row: kicker "Agosto/2026" (10px, uppercase, accent color) + `<h4>Dashboard</h4>` (22px) on the left; a 4-way segmented control (Ago/Jul/Jun/Geral) on the right, active segment gets `box-shadow: inset 0 0 0 1px var(--accent)` and accent text color.
  2. **"Repor agora" card** — header row (package icon + title + `3 de 12 modelos` outline tag), then a data table: columns Modelo | Estoque | Vende/dia | Dura | Margem | Custo p/ 30d. Row dot color signals urgency (red = critical, orange = warning). Footer strip (top hairline rule): a note about stalled stock value + a primary outline button "Abrir entrada de estoque".
  3. **"Desempenho financeiro" card** — 240px-tall area chart, two series (Receita, Lucro líquido) as smooth cubic-bezier paths with a gradient fill under each, dashed gridlines, month labels mar–ago. Legend + "Margem média 34.4%" inline in the header.
  4. **"Modelos mais vendidos" card** — a single 100%-width stacked bar split by model (6 segments incl. "Outros"), each segment a different tint of the accent color (from 100% down to ~19% mixed toward the page background), percentage label inside segments ≥~14% wide. Legend below with color swatch + model name + revenue value per segment.
- **Right column** — 312px fixed, slightly darker background than the main column, padding 22px/22px/26px, `display:flex; flex-direction:column; gap:14px`:
  1. Kicker "Dinheiro do mês".
  2. Receita block: big number (30px) + delta chip, a 2-segment proportion bar (received vs. receivable) below it, labels underneath.
  3. Fading `.hr` rule.
  4. A vertical "waterfall": − CPV, − Despesas (with delta), then Lucro líquido (20px, accent-positive color) after a top hairline, then a muted margin summary line.
  5. Fading `.hr` rule.
  6. Two-column mini stats: Ticket médio (with delta), Estoque a custo.
  7. Fading `.hr` rule.
  8. "Últimas vendas" list — kicker + "412 total", then up to 6 rows: product/model name (truncates), amount right-aligned, tabular numerals.

### Typography & tokens (Nocturne design system)
- Font: Inter (headings 500 weight, body 400).
- Ground: `#161826` (page), cards `#232532`, text `#e9e9ed`.
- Accent (chosen as primary signal color for this direction): **`#85B7EB`** (blue) — used for the sparkline, revenue series, positive deltas, active nav/segment, stacked-bar tints. Secondary/alert color: **`#EF9F27`** (orange) — used for negative deltas, receivable amounts, restock urgency. These two are exposed as swappable design tokens (not hardcoded) — see Design Tokens below.
- Numerals use `font-variant-numeric: tabular-nums`.
- Radius: 8px (cards), 2–4px (bars, tags). Rules/dividers fade to transparent over 40–48px at each end rather than a hard line ("Nocturne" signature) — see `.hr` and the gradient-background technique in the HTML source.
- Card elevation: `box-shadow: 0 0 0 1px <divider>, 0 6px 18px rgba(0,0,0,.55)` (`--shadow-sm`/`--shadow-md` in the design system stylesheet).

### Interactions & behavior (to implement)
- Month segmented control switches the dataset (currently static in mockup).
- "Abrir entrada de estoque" / "Registrar entrada" buttons navigate to the existing Entrada flow, pre-filtered to the flagged models where feasible.
- Nav rail: same routes as today's sidebar, collapsed to icon-only — consider a tooltip on hover for the label.
- No modals/animations are prescribed beyond what `src/lib/motion.ts` already provides for numbers/stagger — reuse those for KPI/number transitions.

### Design tokens used
- `--color-bg: #161826`, `--color-surface: #232532`, `--color-text: #e9e9ed`
- `--color-accent (primary, tweakable): #85B7EB`, `--color-alert (tweakable): #EF9F27`, `--color-divider: color-mix(#e9e9ed 16%, transparent)`
- Radius: 8px default, 4px small
- Font: Inter, sizes 10–30px per the scale above

## Assets
No custom images — Phosphor icon font (regular weight) via CDN in the mockup; production should use the icon set already vendored in the codebase (Lucide, per `AppLayout.tsx`) with equivalent glyphs (squares-four→dashboard, tag, package, trend-down, receipt, file-text, hand-coins, chart-line, coins, book-open, sign-out, percent, clock, warning, arrow-up-right/down-right, caret-down, download-simple).

## Files in this bundle
- `Dashboard Mockups.dc.html` — full design file: turn 1 (options 1a/1b/1c, earlier explorations) + turn 2 (**2a**, the chosen direction, at the top). Open in a browser to view; it's a self-contained prototype, not app code.
- `Dashboard Atual.dc.html` — pixel-faithful recreation of today's live Dashboard, for side-by-side comparison against the redesign.
- `github.md` — source-repo notes (repo, files the recreation/redesign were built from).
