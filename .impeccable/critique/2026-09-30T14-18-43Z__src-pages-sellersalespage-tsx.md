---
target: sellersalespage
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
target_fingerprint: "sha256:783cc6af8d5833ca90a64f81631a3df988d90afaa6d3ffdfba2487266b88cd3c"
target_path: "C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
timestamp: 2026-09-30T14-18-43Z
slug: src-pages-sellersalespage-tsx
---
# Critique 3 — Minhas vendas (src/pages/SellerSalesPage.tsx)

Method: dual-agent (A: design review from source + preview.local at 390/1280 · B: CLI detector on page + ConfirmProvider, browser detector at 390 cheio/muitos/vazio and 1280 cheio)
Uncommitted working tree after round-2 fixes (order endings as notices, tier gap, month in commission header, Minha loja, a11y pass).

## Nielsen: 27/40 (Acceptable, top of band; 19 → 25 → 27)
1 Status 2 · 2 Real world 3 · 3 Control 2 · 4 Consistency 3 · 5 Prevention 3 · 6 Recognition 3 · 7 Efficiency 2 · 8 Minimalism 3 · 9 Recovery 3 · 10 Help 3

## Cognitive load: 3 of 8 fail (chunking — commission card 5 statements; hierarchy — expired order on top with filled pill; working memory — stock free = qty − reserved in head, month stepper affects section below A receber). No decision >4 options.

## Deterministic scan
CLI: 0 (page and ConfirmProvider). Browser: only FPs — layout-transition (global BootProgress class, 0 elements) in all 4 runs; cramped-padding on WhatsAppPill :253 (h-12 centred, rule reads padding only). Detector self-overlay hits excluded. Round-2 TPs (flat hierarchy, 11.5px sentence) gone.

## Priority issues
- [P1] Confirm feedback off-screen: notices render in a block above the whole list (:1086-1092), not in the card slot (comment at :555 says otherwise); confirming 3rd card → notice at y −592, focus to body, gone in 8s; no mention of stock debit. Fix: single keyed list (popLayout), focus the notice, pause timer on focus, "3 un. saíram do seu estoque".
- [P1] Expired orders sort first (created_at asc) and push the urgent live one down. Fix: live by time left, expired after as compact row with secondary pill.
- [P2] Tier value and retroactivity unsaid: tier applies to whole month (commissions.ts:131-140) → +R$ 25,75 for 1 unit in fixture; ladder reads as marginal. Fix: "Falta 1 unidade paga: aí todo setembro passa a 12,5% (+R$ 25,75)"; ladder into "Ver a conta".
- [P2] Focus lost: month stepper disables pressed button (→ body); after confirm. Fix: aria-disabled / move focus; notice focus.
- [P2] "loja" = owner and storefront (":1485 a loja abre vazia até a loja te passar produto"). Fix: owner = "a California".

## Persona red flags
Casey: 130px fixed header for occasional buttons; commission 1.6–3.6 screens down; 40px close top-right; off-screen confirm feedback. Jordan: "loja" ambiguity; tiers as marginal; #ref unexplained; "Agosto fechou" not final with open August sale. Sam: focus loss (stepper, confirm); unnamed "Anotar" buttons; poll-added orders not announced; no aria-busy while confirming. Seller: headline below orders; tier distance without value; A receber total mixes "Dinheiro com você" (seller owes store) with customer debt.

## Minor
A receber total mixes directions; note placeholder "pagou em dinheiro" invites free-text payment while Cobrar persists; decline notice two X icons; ledger hierarchy inverted (children text, parent muted); stock sheet no free count, warn used for reserved, no loading guard; slow-load message below orders; "Vence em 1h" floors 1h20; empty Recebidas py-12 heavy; desktop wheel outside column.

## Questions
Commission strip in fixed header instead of Estoque/Minha loja? 5s "Desfazer" before confirm RPC? Seller declaring cash-on-delivery? Dark-only theme outdoors?
