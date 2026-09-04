# Handoff: Seller Store (Marketplace) Mobile Redesign

## Overview
Mobile redesign of `src/pages/SellerStorePage.tsx` — the public storefront customers open from a seller's link. Same flow as today (identify by WhatsApp → browse catalog → pick a flavor → cart → checkout → WhatsApp handoff), restyled for mobile with a premium dark theme, bigger product photography, and bottom-sheet cart/checkout instead of the desktop-style right-side `Sheet`.

## About the Design Files
The bundled `Seller Store Mobile.dc.html` is a **design reference built in HTML/React for prototyping only** — it is not production code to copy in. Recreate this UI inside the existing app using its real stack: React + TypeScript, Tailwind, the shadcn/radix components in `src/components/ui`, `lucide-react` icons, and `sonner` toasts. Where the prototype hand-draws something (icons, sheet chrome), use the equivalent already in the codebase.

## Fidelity
**High-fidelity.** Colors, spacing, and typography below are final — implement pixel-accurate, not "inspired by."

## Precedent in this codebase
`src/index.css` already scopes a page-specific theme this way for the Dashboard: a `.nocturne` class + a block of custom properties (`--nc-bg`, `--nc-accent`, etc.) applied only where that class is present, so no other page is affected. Do the same for this page — e.g. a `.storefront` class + `--sf-*` tokens — rather than touching the global `--background`/`--primary` tokens Tailwind's utilities read from.

## Design tokens
Add these as custom properties scoped to a `.storefront` wrapper class (mirroring `.nocturne`):

| Token | Value | Use |
| --- | --- | --- |
| `--sf-bg` | `#14141a` | Page / sheet background |
| `--sf-surface` | `#1c1c22` | Cards, inputs, chips (inactive), thumbnails |
| `--sf-surface-2` | `#23232b` | Tags / pills on top of surface |
| `--sf-border` | `rgba(255,255,255,0.08)` | Hairline borders/dividers |
| `--sf-text` | `#f5f3ee` | Primary text |
| `--sf-text-muted` | `rgba(245,243,238,0.55)` | Secondary text |
| `--sf-text-faint` | `rgba(245,243,238,0.35–0.45)` | Tertiary / disabled text |
| `--sf-accent` | `#8fc1e3` (pastel blue) | Primary buttons, prices, selected states, badges |
| `--sf-accent-tint` | `rgba(143,193,227,0.12–0.14)` | Selected-row background |
| `--sf-warn` | `#d98c6b` | "Only N left" low-stock text |

Font: **Manrope** (400/500/600/700/800) — import via `@fontsource/manrope` or a Google Fonts `<link>`, then a Tailwind font key (e.g. `fontFamily.storefront`) or an inline `font-family` on the `.storefront` root. Don't touch the app-wide `--font-sans`/`--font-display` (DM Sans / Space Grotesk) — this page opts into its own family, same spirit as `.nocturne`.

Buttons/inputs are fully rounded (`border-radius: 999px` — pill shape), cards/sheets use `20px`–`28px` radii. No sharp corners anywhere in this design (unlike the rest of the app's `--radius: 0.875rem`).

## Screens

### 1. Identify
- Full-height centered column, `--sf-bg` background, `padding: 80px 26px 40px`.
- Kicker: seller/brand name, 20px/800 weight, `--sf-accent`.
- `h1` 23px/700 "Bem-vindo ao catálogo".
- Body 14px `--sf-text-muted`.
- Two stacked fields (name, WhatsApp) — reuse `Input`/`Label`, restyle: 50px height, `border-radius:14px`, `background:var(--sf-surface)`, `border:1px solid var(--sf-border)`.
- Primary button: full width, 52px, pill, `background:var(--sf-accent)`, text `#1a1a1a` (dark-on-pastel for contrast), disabled state at 30% opacity fill.
- Behavior unchanged from current code (`continuar()` gates on phone length + name).

### 2. Catalog (main list)
- Sticky header, `padding-top:54px` (mobile status-bar clearance not needed in a real browser tab, use normal `16px`), brand name (14px/800/`--sf-accent`) + "Oi, {name}" subline.
- Cart icon button top-right: circular, `--sf-surface` bg, badge (pill, `--sf-accent` bg, dark text) top-right corner showing `cartCount`, shown only when `cartCount > 0`.
- Search input below header: pill, `--sf-surface` bg, no border, search icon inset left.
- **New**: horizontal scroll of category/brand filter chips (pill, active = `--sf-accent` fill + dark text, inactive = `--sf-surface` + muted text). Filters the product list client-side by brand; "Todos" resets it. This is additive — no equivalent existed before.
- Product list: **single column** (not the current `grid-cols-2/3`), one card per model, `gap:16px`, grouped under a small uppercase brand label exactly like today's `<h2>{brand}</h2>` grouping.
- **Card — this is the main visual change requested ("bigger product photo")**:
  - `border-radius:20px`, `background:var(--sf-surface)`, `border:1px solid var(--sf-border)`, `overflow:hidden`.
  - Image area: full card width, **176px tall** (versus today's `aspect-[4/3]` inside a small grid cell) — render the existing `image_url` here at that larger size; keep the existing icon-placeholder fallback for products with no photo.
  - Floating circular quick-add button (36px, `--sf-accent` fill, 2px `--sf-bg` ring, drop shadow) anchored `bottom:12px; right:12px` over the image — opens the same detail sheet as tapping the card (flavor must always be chosen, so it's not a blind add).
  - Content padding `14px 16px 16px`: name 16px/700, one-line desc 12.5px muted, then a row with a "{N} sabores" pill (`--sf-surface-2` bg) on the left and price on the right, 15px/800 `--sf-accent`, "A partir de" prefix when flavors differ in price (same `samePrice` logic already in `ModelCard`).
- Bottom cart bar: unchanged behavior (`cartCount > 0` and no overlay open), pill button, `--sf-accent` fill, `linear-gradient` fade above it instead of a hard border.

### 3. Product detail — bottom sheet, not a right-side panel
- Use shadcn `Sheet`, but set **`side="bottom"`** (it already supports this) with a height class like `h-[88vh]` and `rounded-t-[28px] rounded-b-none`, instead of today's `side="right"` / full-screen-on-mobile branch. This single change is most of the "feels out of place on mobile" fix.
- Hero image: 230px tall, full width, top of sheet (`image_url`, larger than today's 38vh/160px area).
- Circular back/close button top-left over the image (translucent dark, blurred).
- Body: brand kicker (11.5px/700/`--sf-accent`), model name `h2` 22px/800, desc, then flavor list.
- Flavor rows: pill-radius (16px) buttons, selected = `--sf-accent-tint` bg + `--sf-accent` border + filled dot with checkmark; unchanged selection/stock logic (`Esgotado`, `Só restam N`, `N em estoque`) from the current `flavorList`.
- Sticky footer: qty stepper (pill, `--sf-surface` bg) + full-width `Adicionar · {price}` pill button — same logic as today's `footer`, just restyled.

### 4. Cart — bottom sheet
- Same `Sheet side="bottom"` treatment, `h-[76vh]`, `rounded-t-[28px]`.
- Row: 56×56 rounded-12px thumbnail (`image_url`) + name/flavor + qty stepper, price + trash icon on the right. Logic identical to current cart list.
- Footer: total row + full-width pill "Finalizar pedido" button.

### 5. Checkout — bottom sheet
- Same treatment, `h-[70vh]`.
- Identity summary row (name/phone + "Editar" — same `Alterar` behavior as today, just relabeled) in a `--sf-surface` rounded-16px box.
- Notes `Textarea`, restyled to match (`--sf-surface` bg, 14px radius).
- Total row + full-width pill "Confirmar pedido" button. Submit logic (`supabase.rpc('create_pending_order', …)`, WhatsApp deep link) is unchanged.

### 6. Success — full screen (unchanged behavior, restyled)
- Centered column, 68px circular `--sf-accent` badge with a check icon, heading, muted body, "Reabrir WhatsApp" pill button + "Voltar ao catálogo" text button.

## Interactions & behavior (no functional changes)
All data flow, validation, and Supabase/WhatsApp logic in the current `SellerStorePage.tsx` stays as-is: loyalty lookup, `addToCart`/`setItemQty`/`removeItem`, `buildMessage`/`submit`, error toasts via `friendlyError`. This handoff is visual + the sheet placement + the card layout — not a rewrite of the data logic. The only new piece of UI state is the category filter (`activeCategory`, defaults to `'all'`), which only needs to filter the already-fetched `rows`/`groups` client-side.

## Assets
No new image assets — this design renders the existing `CatalogRow.image_url` at a larger size. Where a product has no photo, keep a placeholder treatment (the prototype uses a hand-drawn box icon over a diagonal-hatch background at `--sf-surface`/`--sf-surface-2` — recreate simply, or keep the current `Package` icon fallback from `lucide-react`, just bigger).

## Screenshots
`screenshots/01-identify.png` … `06-success.png` — one per screen above, in order.

## Files in this bundle
- `Seller Store Mobile.dc.html` — the interactive HTML prototype (open in a browser) covering all six screens above, including working add-to-cart/cart/checkout state.
- `screenshots/` — static PNGs of each screen (see above).
