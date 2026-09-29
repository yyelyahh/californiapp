---
target: dashboard (critica livre)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\Dashboard.tsx"
target_fingerprint: "sha256:59701a0a0623a74856b76e0fa3a1c96cfc82a4de74b3d2f08970dfc55cf1707d"
target_path: "C:\\Users\\base2\\Documents\\californiapp\\src\\pages\\Dashboard.tsx"
timestamp: 2026-09-29T10-12-29Z
slug: src-pages-dashboard-tsx
---
# Crítica livre — Dashboard (src/pages/Dashboard.tsx)

Method: dual-agent (A: revisão de design · B: detector). Regras VISUAIS do CLAUDE.md julgadas como escolhas; regras de número mantidas.

## Heurísticas — 25/40 (Aceitável)
1 Visibilidade 3 — filial nunca nomeada na página; animateOnMount mostra valor errado por 0,7 s.
2 Linguagem 3 — h1 "Dashboard" em inglês; "Trilho/Coluna" no painel.
3 Controle 3 — mês só anda de um em um.
4 Consistência 2 — três cabeçalhos para o mesmo bloco; accent com seis papéis; só Despesas tem variação.
5 Prevenção 3.
6 Reconhecimento 2 — quatro recortes de tempo; bolinha sem legenda.
7 Eficiência 3 — falta pular para um mês.
8 Minimalismo 2 — ~12 tamanhos de letra; camada de ressalvas 11px.
9 Recuperação 2 — sem estado de erro/dado velho próprio.
10 Ajuda 2 — bolinha, mínimo e "Pedir" sem explicação.

## Especificidade
Casca genérica de painel escuro de SaaS; especificidade só no conteúdo (Repor agora → Montar compra, − Vendedores, a pagar/devem). Consignação, duas cidades e o ritual de fechamento não aparecem. Detector: 0 achados no Dashboard (com e sem config); varredura por URL caiu no login (4 achados de lá).

## Problemas prioritários
- [P1] Sem resposta única, herói errado: Receita 30px no trilho; lucro líquido 20px no pé. Faixa de veredito no topo (lucro, receita, vendedores, repor). layout → bolder.
- [P1] Recortes de tempo misturados; linha do Repor junta estoque de hoje com vendas do mês; card sem aviso. Zonas Hoje / Mês / Tendência; "Vendeu" em janela fixa. clarify + layout.
- [P1] Acessibilidade: zoom travado + text-3 ~3,3–3,8:1 em 11px; aria-label do link da Receita e dos modelos apaga o valor; bolinha só por cor. harden.
- [P2] Escala tipográfica com ~15 tamanhos; reduzir a 5 (12/13/15/20/32). typeset.
- [P2] Celular: ~230px de cromo; vendedores ~2.500px abaixo. adapt.

## Personas
Alex: sem pulo de mês/atalho de exportar; trilho com rolagem própria; linhas do Repor não abrem nada; 0,7 s de animação.
Sam: aria-label esconde valores; gráfico sem texto; aside sem nome; bolinha por cor; zoom travado; ←/→ globais.
Casey: dica do gráfico exige toque preciso; alça 24×32; exportar fora do polegar; conclusões 11–12px cinza; barras esmaecem a 19%.

## Menores
Mês três vezes no cabeçalho; "vs …" longe da variação; azul=bom vs verde=recebido; lilás sem significado; Ticket (mês) ao lado de Estoque (hoje); Últimas vendas pobre; eixo sem R$; margem na legenda; #595d6c fixo; personalização 2×2×3×visibilidade×ordem.

## Perguntas
1. Um número só: qual, e por que não é o maior?
2. Onde está a consignação, e em qual cidade?
3. Por que abre no mês que ninguém fecha, e o relatório é ícone cinza?
4. A personalização foi pedida ou evita decidir o propósito?
