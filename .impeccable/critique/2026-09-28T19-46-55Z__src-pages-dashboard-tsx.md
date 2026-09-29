---
target: Dashboard
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\Dashboard.tsx"
target_fingerprint: "sha256:652dfe592487137f2c4e107f3b51446d739330f55e2a65079f4ffaff55a29dcb"
target_path: "C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\Dashboard.tsx"
timestamp: 2026-09-28T19-46-55Z
slug: src-pages-dashboard-tsx
closed: true
---
# Critique — Dashboard (src/pages/Dashboard.tsx)

Method: dual-agent (A: design review from screenshots 1440/1280/390 + source · B: CLI detector + browser detector at 1440 and 390)

## Nielsen: 25/40 (Aceitável)
1 Status 3 · 2 Mundo real 3 · 3 Controle 3 · 4 Consistência 2 · 5 Prevenção 3 · 6 Reconhecimento 2 · 7 Eficiência 2 · 8 Minimalismo 3 · 9 Recuperação 2 · 10 Ajuda 2

## Cognitive load: 4 of 8 checks fail (grouping, chunking, choices, working memory)

## Deterministic scan
CLI: 0 findings. Browser: 9 (5 undersized/tiny text at Dashboard.tsx:532, 549, 723, 812, 824, 827, 890; Inter overused-font = false positive, established ERP font; layout-transition from BootProgress = false positive).
Drift: eyebrows hardcode text-[10px] instead of the shared EYEBROW.

## Priority issues
- [P1] Months older than the 3 quick chips can't be opened (periodOptions only appends a selected month, and nothing can select one) — blocks the Excel export for those months too.
- [P1] Numbers without provenance: delta base only in title; "Últimas vendas · N total" ignores the period under "Dinheiro do mês"; "Estoque a custo" is today's position; "− Vendedores" formula hover-only.
- [P1] On phones the money rail is last (RAIL, not RAIL_FIRST): ~1,200px scroll before revenue.
- [P2] Color collisions: received segment uses --nc-accent instead of --nc-ok; net profit in accent while the chart draws profit in --nc-profit.
- [P2] Mobile restock table wraps ("16 un."), chips ~28px tall, tiny text carries the restock quantities.

## Persona red flags
Alex: no drill-down, no "create purchase from this list", no keyboard month step.
Casey: money at the bottom, 28px chips, hover-only explanations.
Sócio fechando o mês: can't open June, can't read the delta base, partial current month plotted as full in the 6-month chart, no seller/order signal.
