---
target: sellersalespage
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
target_fingerprint: "sha256:fc2fdedb8e2810b94d8f21eda7539ab0e951d2eef7728756ad5b214d374a34cf"
target_path: "C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
timestamp: 2026-09-30T19-31-26Z
slug: src-pages-sellersalespage-tsx
closed: true
---
# Critique 4 — Minhas vendas (src/pages/SellerSalesPage.tsx)

Method: dual-agent (A: design review from source + preview.local at 390/1280 · B: CLI detector on page + ConfirmProvider, browser detector at 390 cheio/muitos/vazio, 1280 cheio, plus decline-dialog and post-decline states)
After commit fd72f33 (pushed): order endings in place, tier value, A receber split, "a California", text-only header buttons.

## Nielsen: 29/40 (Good, 72%; 19 → 25 → 27 → 29)
1 Status 3 · 2 Real world 3 · 3 Control 2 · 4 Consistency 3 · 5 Prevention 3 · 6 Recognition 3 · 7 Efficiency 3 · 8 Minimalism 3 · 9 Recovery 3 · 10 Help 3

## Cognitive load: 2 of 8 fail (working memory — card's R$ 445 vs 360+85 below, nested gains 25,75 ⊂ 81,38, gap ignores unpaid units; chunking — ~10 numbers in 7 lines). No decision >4 options.

## Deterministic scan
CLI: 0 (page and ConfirmProvider). Browser: only known FPs — layout-transition (global BootProgress class, 0 elements) in all 6 runs; cramped-padding on solid WhatsAppPill :270 after decline (48px flex-centred, ~15px gap). Nothing real left for the detector.

## Priority issues
- [P1] Orders that expire while the seller is away vanish: list only reads status pendente (usePendingOrders.ts:136-141); vanished-notice only diffs against first load. Fix: also read own `expirada` orders from last 48–72h not dismissed (localStorage), render in the expired tail row "Venceu enquanto você estava fora · Avisar X".
- [P2] Commission card's secondary numbers don't reconcile: "R$ 445 em aberto" vs 360 + 85 below; +25,75 nested in +81,38 reads additive (178 vs real ceiling 152,50); "Falta 1 unidade paga" ignores 3 sold-unpaid September units. Fix: projection in the page's two buckets giving resulting balance; when unpaid units cover the gap, tier line speaks of collecting.
- [P2] Confirm has no recovery path and focus drops to body while processing (disabled button). Fix: "Confirmou por engano? Avise a California" (wa.me store number + ref) in confirmed notice; aria-disabled while busy.
- [P2] No freshness/retry feedback: retry shows nothing, 60s poll, pull-to-refresh swallowed by overscroll-contain. Fix: "Procurando…" on retry, repeated-failure line with time, quiet "Atualizado agora · Atualizar".
- [P3] New seller never sees the tier ladder (only inside "Ver a conta", absent without ledger); zero-stock "Faltam 11 unidades pagas". Fix: ladder under tier line when no ledger; zero state as a rule.

## Persona red flags
Casey: 8s confirmation, no pull-to-refresh, commission 3.4 screens down with 7 orders. Jordan: no ladder, #ref explained only on hover, note doesn't say who reads it, "Venceu" row unexplained. Sam: focus drop during confirm, focus jumps to list title after notice closes, pause depends on :focus-visible (SR double-tap may not match), alert then differently-worded notice on server-expired, notice title read twice, pinch-zoom locked. Bruna: headline clear but three overlapping figures; gap blind to unpaid/with-seller units; A receber excellent.

## Minor
warn/danger ~10° hue apart (escalate by shape); 1280 header/main misaligned by scrollbar (scrollbar-gutter); received count by sale lines (prize inflates); "0 livres" not emphasised; silent copy failure; note limit without counter; "Novo pedido" ping forever and new orders at bottom; stepper only to last month; slow notice scrolls off.

## Questions
Three meanings of "receber"; tier line about collecting vs selling; hand the way back on wrong confirm; California's signature on the seller's side.
