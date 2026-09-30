---
target: sellersalespage
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
target_fingerprint: "sha256:4de705f35a72895b7c9cb93781eca3237ff94ac686844e4b6616203dfa2030ad"
target_path: "C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\SellerSalesPage.tsx"
timestamp: 2026-09-30T12-15-23Z
slug: src-pages-sellersalespage-tsx
---
# Critique — Minhas vendas (src/pages/SellerSalesPage.tsx)

Method: dual-agent (A: design review from source + preview.local at 390/1280 · B: CLI detector + browser detector at 390 cheio/vazio and 1280 cheio)
Preview: preview.local/ (npx vite --config preview.local/vite.config.ts → http://localhost:5199/?cenario=cheio|vazio|muitos&falha=expirado|estoque)

## Nielsen: 19/40 (Poor, borderline Acceptable)
1 Status 2 · 2 Real world 2 · 3 Control 2 · 4 Consistency 1 · 5 Prevention 2 · 6 Recognition 2 · 7 Efficiency 2 · 8 Minimalism 3 · 9 Recovery 2 · 10 Help 1

## Cognitive load: 5 of 8 checks fail (grouping, hierarchy, one thing at a time, ≤4 choices, working memory). Payment picker = 6 methods + note.

## Deterministic scan
CLI: 0. Browser: 22 on cheio (390 = 1280), 9 on vazio. 15 undersized-ui-text (Novo pedido :420, order age :448, StatCard labels :145, CarriedTag 9.5px :187), 6 tiny-text (phone/ref :435, projection :820/:824, footnote :882 = borderline FP), layout-transition = FP (BootProgress/BootScreen class). The pointer:coarse bump in index.css only reaches .nocturne (index.css:543), so storefront labels stay 10px on phones.

## Priority issues
- [P1] Payment picker overloaded and commits on one tap: 6 pills in 264px, all 4 "Falta receber" wrap inside h-9, focus goes to note input (keyboard over options). Fix: two steps (Recebeu? Sim / Ainda não → Pix/Dinheiro/A combinar), "Dinheiro comigo", no autofocus, note behind "+ observação", or bottom Sheet.
- [P1] Commission doesn't answer "how much / how far": Saldo orange when good, Unidades = paid only without saying so, no next tier (unitsUntilNextTier exists), Trimestre shows last month's tier, Consumo lives in Resumo. Fix: hero "Você recebe R$ X", "10/11 un. pagas para 12,5%", move Consumo, drop Trimestre.
- [P2] Post-action feedback: white shadcn toast over header, red error toast far from card (§8), raw err.message on decline/load, stock error doesn't name flavor, no loading state (vazio = what loading looks like). Fix: inline success/error on card, error mapper, "Carregando…".
- [P2] Order items lack model (query has no `model`); prize and combo lines unlabeled; product written 3 ways across the screen. Fix: fetch model, one label everywhere, tag "prêmio fidelidade"/"combo".
- [P2] Legibility/a11y: 20 texts 9.5–11.5px mostly faint; no h1; chips 35px and "Trimestre" cut to "Trime" at 390; paid/open by color only; infinite animate-ping. Fix: 11.5px floor + muted, h1, min-h-11, text "a receber", motion-safe, pulse off after ~1h.

## Persona red flags
Casey: keyboard over popover, 35–37px chips, expiring order looks new, WhatsApp not tappable. Jordan: vazio = 8 zeros and no store link; unexplained Consumo/Acumulada/Saldo; Estoque looks like a filter. Sam: no h1, cards not headings, pills don't say they confirm, color-only status. Bruna: orange Saldo, Unidades ≠ memory, no "1 un. para 12,5%".

## Minor
[P2] empty state without store link; "Em aberto" includes other months under "· Este mês"; "Faixa atual" in Mês passado; "Entrega:" label; commission ctx built by hand instead of currentBalanceContext and no isCommissionSeller; light native scrollbar on desktop; OrderCard enter not gated by reduced motion.

## Questions
Payment at confirmation or at delivery? How does the seller learn about an order if it goes to the store's WhatsApp? Which ONE number? What does Trimestre answer?
