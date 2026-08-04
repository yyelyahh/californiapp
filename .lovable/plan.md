# Otimização do sistema

Fiz uma varredura no código. Nada está quebrado, mas há pontos que vão pesar cada vez mais conforme o volume de vendas cresce. Abaixo, o que encontrei e a ordem sugerida de correção.

## O que está pesando hoje

**1. Todo o banco é carregado no login**
Ao entrar, o sistema busca 19 tabelas inteiras de uma vez (vendas, entradas, despesas, pagamentos, empréstimos, eventos financeiros...), sem limite nem paginação, mesmo que você só vá abrir a tela de Vendas. `sales` e `financial_events` crescem sem parar — esse é o maior risco de lentidão futura.

**2. Re-renderizações desnecessárias em todo o app**
O "estado global" é recriado a cada mudança, então qualquer alteração (ex.: um vendedor) força todas as telas abertas a redesenharem. Correção simples e de efeito imediato.

**3. Atualização em tempo real recarrega tabelas inteiras**
Quando alguém registra uma venda, todos os usuários conectados baixam a tabela de vendas inteira de novo — às vezes duas tabelas por evento. O certo é atualizar só a linha que mudou.

**4. Buscas repetidas dentro de laços (cálculos O(n×m))**
Em Distribuição, Extrato do Vendedor, Dashboard e Vendas, para cada vendedor/produto o código varre a lista inteira de vendas várias vezes. Com 10 vendedores e 5.000 vendas isso vira dezenas de milhares de comparações por render. A página de Insights já faz do jeito certo (índice em mapa) — basta replicar.

**5. Nenhum carregamento sob demanda das páginas**
Todas as 11 páginas e as bibliotecas pesadas (gráficos, PDF, Excel) vão no mesmo pacote inicial, mesmo para quem só abre Vendas. Isso atrasa o primeiro carregamento, principalmente no celular.

**6. Seletores financeiros recalculam a cada chamada**
`getNetProfit`, `getCash`, etc. refazem a soma completa toda vez que são usados na tela.

## Plano de execução (por ordem de impacto/esforço)

1. **Memoizar o valor do StoreContext** — corte imediato de re-renders. Baixo risco.
2. **Carregamento sob demanda das páginas** (`React.lazy` + Suspense em App.tsx) e import dinâmico de PDF/Excel só no clique de exportar.
3. **Substituir varreduras repetidas por mapas de índice** em `CommissionsPage`, `SellerReportDrawer`, `Dashboard`, `SalesPage` — sem mudar nenhuma regra de cálculo, apenas a forma de buscar os dados.
4. **Realtime incremental**: aplicar a linha recebida no evento em vez de re-baixar a tabela; agrupar eventos rápidos (debounce) para `financial_events`.
5. **Adiar o carregamento das tabelas não críticas** (empréstimos, aportes, dividendos, pagamentos de pró-labore, eventos financeiros) para quando Financeiro/Distribuição forem abertos, mantendo no login só o essencial (produtos, vendas, vendedores, atribuições).
6. **Memoizar os seletores financeiros** derivados.

## Detalhes técnicos

- `src/context/StoreContext.tsx:151-171` — `Promise.all` com 19 `select("*")` sem `limit`/`range`.
- `src/context/StoreContext.tsx:1078-1103` — objeto literal no `Provider value`; envolver em `useMemo`.
- `src/context/StoreContext.tsx:202-243` — handlers de realtime fazendo `select("*")` completo; trocar por patch do payload.
- `src/context/StoreContext.tsx:933-937,1050-1075` — seletores `useCallback` que reduzem arrays inteiros a cada chamada.
- `src/pages/CommissionsPage.tsx:148,166-191,283-328`, `src/components/SellerReportDrawer.tsx:103-236`, `src/pages/Dashboard.tsx:64,93,169,360`, `src/pages/SalesPage.tsx:46-58` — `find`/`filter` dentro de `map`; pré-indexar em `Map` (padrão já usado em `InsightsPage.tsx:68`).
- `src/App.tsx:10-23` — imports estáticos de todas as páginas.

## Garantias

Nenhuma regra de negócio, cálculo de comissão, distribuição ou lançamento financeiro será alterada — as mudanças são estruturais (como e quando os dados são buscados e processados). Os valores exibidos devem permanecer idênticos, e vou conferir Distribuição/Extrato antes e depois.
