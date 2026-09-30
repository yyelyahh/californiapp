---
target: sellersalespage
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
target_fingerprint: "sha256:7f53f51e4ecc01f51d271704264146742fc320b7a13bb2113d7f82e4490bf503"
target_path: "C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
timestamp: 2026-09-30T13-42-08Z
slug: src-pages-sellersalespage-tsx
---
# Critique 2 — Minhas vendas (src/pages/SellerSalesPage.tsx)

Method: dual-agent (A: design review from source + preview.local at 390/1280 · B: CLI detector + browser detector at 390 cheio/vazio and 1280 cheio)
After commit 046ff14 (confirm without payment method, owner-only payment, order: orders → commission → a receber → received sales).

## Nielsen: 25/40 (Acceptable; previous run 19/40)
1 Status 3 · 2 Real world 3 · 3 Control 2 · 4 Consistency 3 · 5 Prevention 2 · 6 Recognition 3 · 7 Efficiency 2 · 8 Minimalism 3 · 9 Recovery 2 · 10 Help 2

## Cognitive load: 3 of 8 fail (single focus — period chips above orders they don't filter; hierarchy — tier gap muted, h1 14px; working memory — thresholds beyond next tier unseen, customer contact lost after decline). No decision >4 options.

## Deterministic scan
CLI: 0. Browser: 4 distinct. flat-type-hierarchy TP (h1 14px < h3 16px, max step 1.14); tiny-text TP at :550 ("Dinheiro com você…" 11.5px sentence); layout-transition FP (BootProgress/BootScreen class); cramped-padding FP (empty state :1046). Both agents: --sf-text-dim empty/loading text 3.0:1.

## Priority issues
- [P1] Decline/expire removes the only way to reach the customer: card vanishes with WhatsApp link right after "combine pelo WhatsApp"; expired card shows "Vence em 1h" + "passou das 24h" with Confirm still enabled. Fix: closing notice "Pedido de X recusado · Avisar no WhatsApp" (prefilled), kept until dismissed; expired → Confirm off, WhatsApp primary.
- [P1] Tier gap buried: "10/11 un. pagas para 12,5%" muted 13px, 15% (16 un.) never shown; headline is running balance, month commission hidden in ledger. Fix: "Falta 1 venda paga para 12,5%" 15px bold + "15% a partir de 16 un."; tie to who owes ("Diego (2 un.) já te leva").
- [P2] Period chips in header filter sections up to 3 screens below, orders ignore them; h1 14px < customer name 16px. Fix: "‹ setembro ›" in commission header; h1 to 19–22px.
- [P2] Store link: only before first sale, shown with 0 stock. Fix: permanent "Minha loja" next to Estoque; onboarding card gated on stock.
- [P2] A11y: focus lost after decline dialog and Estoque sheet (verified); phone link 24px; dim 3.0:1; "Confirmando…" ~2:1; per-card button names; aria-live over whole list; 11.5px sentence at :550.

## Persona red flags
Casey: 24px phone link, six identical Confirm buttons with no undo, 5s notice, commission 3 screens down. Jordan: faixa/acerto/consumo/#ref unexplained, no tier ladder, link gone after first sale, "loja no ar" with 0 stock. Sam: focus loss, unnamed buttons, whole list re-read on poll, load error not announced, WhatsApp aria-label hides number. Bruna: running balance vs month commission, muted tier gap without 15%, oldest debt without age, Cobrar without prefilled message.

## Minor
Prize line repeated in A receber grouping; combo tag wrapping inconsistent; no danger escalation <1h; two redundant timestamps; note placeholder "fiado" obsolete; new seller ledger shows +R$0/R$0; helper line repeated per card.

## Questions
Cobrar as second thing on the screen? Headline = running balance or month commission? Confirm one-tap vs decline guarded? End-of-day summary keeping contacts?
