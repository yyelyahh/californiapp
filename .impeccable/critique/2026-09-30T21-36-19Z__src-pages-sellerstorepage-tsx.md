---
target: sellerstorepage
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerStorePage.tsx"
target_fingerprint: "sha256:73bcaa3a57fc37ac861b22ce90c5a2790744c78a70045e2616736eba125b9d42"
target_path: "C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerStorePage.tsx"
timestamp: 2026-09-30T21-36-19Z
slug: src-pages-sellerstorepage-tsx
closed: true
---
# Critique — Loja pública (src/pages/SellerStorePage.tsx)

Method: dual-agent (A: design review from source + preview.local at 390/1280 · B: CLI detector + browser overlay in 7 states: catalog 390/1280, model sheet, cart, checkout, vazio, falha=catalogo)
Preview: preview.local/ (npx vite --config preview.local/vite.config.ts → http://localhost:5199/?tela=loja[&cenario=vazio|pouco][&falha=catalogo|estoque|pendentes|link][&lento=1]; known phone (51) 99999-1234). Mock does not apply discounts.

## Nielsen: 24/40 (Acceptable)
1 Status 3 · 2 Real world 2 · 3 Control 2 · 4 Consistency 2 · 5 Prevention 3 · 6 Recognition 2 · 7 Efficiency 2 · 8 Minimalism 3 · 9 Recovery 2 · 10 Help 3

- 1: combo discount lands silently in the bar (R$ 206 vs card R$ 110); "Confirmar pedido" disabled without reason.
- 2: "Pedido enviado!" while body says to tap to send (:2239-2245).
- 3: closing checkout returns to catalog, not cart; detail sheet auto-closes after each add; no undo on remove.
- 4: "o vendedor" vs "a gente / nosso WhatsApp"; "Ajustei"/"Ajustamos"; "A cada 6" hard-coded at :2901 (should read rules.loyalty_cycle).
- 6: checkout never lists the items; combo rule lives only in a scrolled-away banner.
- 7: one flavor per sheet trip.
- 8: ~1.3 models per screen; price repeated on every flavor row; no-photo card is a big grey box.
- 9: "confira" with nothing on screen to check; "Fale com ele" with no link.
- 10: payment ("Pix ou dinheiro, na entrega") only in Tira-dúvidas, never in checkout.

## Design specificity
Motion is authored (ink+smoke Adicionar button, flood wave → success, promo border light, Ignite featured). Static skeleton is delivery-app generic. The store's differentiator (combo, mix flavors of one model) is fought by the flow: sheet closes after add (:2653), combo price never shown on card/sheet.

Detector: CLI 0 findings. Browser overlay 5 rules / 7 states. True: undersized-ui-text "Promoção" 10.5px (:1336); layout-transition width on pager dots (:1357, transition-all). False positives: clipped-overflow-container (app shell :2299, inner scrollers), buried-raster (lazy fade-in :941-947), cramped-padding (PillButton fixed 52px :2455). Both agents: QtyStepper −/+ without accessible name (:1065, :1074). B only: ProductCard div role=button with nested <button> (:1397, :1427).

## Strengths
1. Loyalty in checkout (:2861-2916): first-name greeting, discount stated as applied; rule shown to new customers.
2. Recovery engineering: stock error names the flavor, idempotent client token, cart reconciled against fresh catalog with notice, 20s timeout.
3. Cart-aware detail sheet: "2 no carrinho · 8 em estoque", "Adicionar mais".

## Priority issues
1. [P1] Success screen misstates state — "Pedido enviado!" + separate "Enviar pedido no WhatsApp" (:2239). Users leave; order sits 24h; 3-pending cap. Fix: "Pedido reservado — falta enviar", WhatsApp as "Passo 2 de 2" or checkout button "Continuar para o WhatsApp". → clarify
2. [P1] Checkout blind to cart — no items, no payment line; stock refusal says "confira". Fix: compact summary + Editar at top, changed line inline on refusal, "Você paga na entrega, Pix ou dinheiro. Próximo passo: WhatsApp" above button. → layout + clarify
3. [P2] Combo only in banner — sheet closes after add (:2653), no combo price on card/sheet. Fix: keep sheet open / "Adicionar e escolher outro sabor", "2+ do V80: R$ 103 cada", one-time "Combo ativado −R$ 14" in bar. → shape + delight
4. [P2] Touch & a11y — stepper 31×23 no aria-label, trash 14×14 (:2761), chips 35px, sheet close 32px, WhatsApp FAB covers card price, nested button in card, 10.5px eyebrow. Fix: ≥44px, aria-labels, single button per card, FAB hides on scroll-down, ≥11px. → adapt + harden
5. [P2] Split voice & dead-end errors — "vendedor" (:91-93, FAQ) vs "a gente"; "Fale com ele" without link; empty catalog reads as search miss, still shows combo promo; "6" hard-coded (:2901). Fix: one actor "a California", inline "Falar no WhatsApp" in errors/empty, read rules.loyalty_cycle. → clarify + harden

## Persona red flags
- Casey: 14px trash, 23px steppers; FAB over price; two sheet trips (~1.15s anim each) for two flavors; leaving checkout loses cart context.
- Jordan: "i" unexplained except by rotating banner; no payment hint near button; disabled button until 2-char name without hint; believes "Pedido enviado!"; "Nível Frequente" unexplained.
- Riley: confirm + "Voltar ao catálogo" ×3 → pending cap pointing at unreachable seller; shared phone greets next person "Oi, Marina"; long flavor truncated at the differentiator (:2607); sold-out card opens sheet of disabled rows.

## Minor
Contrast --sf-text-dim ~3.1:1 on readable state text, "N sabores" pill ~3.6:1 at 11px; "…" vs "..."; price repeated per flavor; chips don't track scroll; search doesn't show matched flavor; desktop gutters don't scroll; loading is text only; WhatsApp message discount line generic; "item(ns)" aria.

## Questions
- Could "Confirmar pedido" be the WhatsApp jump itself?
- Photo-first 4:3 card vs dense list for returning buyers?
- Does the rotating banner earn ~105px on every visit?
- No age statement on a vape store for anonymous visitors — deliberate?
