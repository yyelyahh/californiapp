## Nova área: Financeiro › Comissões e Pró-labore

Nova página dedicada à gestão de comissões progressivas dos vendedores, pró-labore dos sócios e distribuição de resultados, no mesmo padrão visual das demais páginas redesenhadas.

---

### 1. Banco de dados (migrations)

Duas novas tabelas + ajustes mínimos:

**`commission_payments`** — pagamentos de comissão a vendedores
- `id uuid pk`, `seller_id uuid → sellers`, `amount numeric`, `date date`, `notes text`, `created_at timestamptz`
- RLS: admin full access; seller pode ler os próprios (`seller_id = get_my_seller_id()`)
- GRANTs para `authenticated` e `service_role`

**`pro_labore_payments`** — pagamentos de pró-labore a sócios
- `id uuid pk`, `partner_id uuid → partners`, `amount numeric`, `date date`, `notes text`, `created_at timestamptz`
- RLS: admin only

**`partners`** já existe. Adicionar coluna `monthly_pro_labore numeric default 0` para o "Valor Mensal" exibido na tabela.

---

### 2. Lógica de comissão progressiva (frontend, em `src/lib/commissions.ts`)

Para o período selecionado (mês atual por padrão):

```
unidades = soma de quantity das sales do vendedor (type='venda') no período
faturamento = soma de total_price
faixa:
  unidades <= 10 → 10%
  11–15        → 12,5%
  >= 16        → 15%
comissao_acumulada = faturamento * faixa
comissao_paga      = soma de commission_payments do vendedor no período
comissao_pendente  = max(0, acumulada - paga)
```

Próxima faixa e "faltam X unidades" derivados da mesma estrutura.

---

### 3. Página `src/pages/CommissionsPage.tsx` (rota `/commissions`)

Estrutura, top → bottom, no mesmo design system (glass-card, gradientes, tipografia, espaçamentos das páginas Vendas/Dashboard):

1. **Header** — título "Comissões e Pró-labore" + subtítulo + seletor de período (mês/trimestre/ano).
2. **KPIs (4 cards, `grid-cols-2 lg:grid-cols-4`)**
   - Lucro Líquido (período)
   - Comissões Pendentes
   - Pró-labore Pendente
   - **Saldo Disponível** = Lucro − Comissões Pendentes − Pró-labore Pendente (card destacado com gradiente)
3. **Distribuição de Resultados** — card visual com a cascata Lucro → Comissões → Pró-labore → Saldo (barra empilhada + valores).
4. **Tabela de Comissões dos Vendedores**
   - Colunas: Funcionário · Unidades · Faturamento · Faixa Atual · Comissão Acumulada · Pago · Pendente · Ações
   - Barra de progresso até a próxima faixa + texto "Faltam X un. para 15%"
   - Botão "Registrar Pagamento" abre Drawer (Sheet)
5. **Tabela de Pró-labore dos Sócios**
   - Colunas: Sócio · Valor Mensal · Pago no Período · Status (Pago / Parcial / Pendente) · Ações
   - Botão "Registrar Pró-labore" abre Drawer
6. **Gráfico de Evolução** (Recharts, mesmo estilo do Dashboard)
   - Linhas: Lucro Líquido, Comissões, Pró-labore, Saldo Disponível
   - Granularidade segue filtro de período
7. **Timeline de Histórico Financeiro**
   - Agrupado por dia (Hoje / Ontem / data)
   - Itens unificados: commission_payments + pro_labore_payments, ordenados desc

---

### 4. Drawers (padrão Sheet lateral)

**Drawer Comissão**: Funcionário (select) · Valor · Data · Observação · Resumo (Acumulada / Paga / Pendente).
**Drawer Pró-labore**: Sócio (select) · Valor · Data · Observação · Resumo (Mensal / Pago / Restante).

Após submit: insert no Supabase, invalidar dados via `StoreContext` (adicionar `commissionPayments`, `proLaborePayments`, `addCommissionPayment`, `addProLaborePayment`).

---

### 5. Integração com o sistema

- **`StoreContext`**: novos arrays + loaders + mutations.
- **`AppLayout`** (sidebar): novo item "Comissões" (ícone `Wallet`) abaixo de "Despesas", visível só para admin.
- **`App.tsx`**: rota `/commissions` protegida (não-seller).
- **Lucro Líquido**: reusar a mesma fórmula já adotada no Dashboard reformulado (Receita − Despesas − CMV das vendas, sem subtrair compras de estoque).

---

### 6. Design tokens / consistência

- Reusar `glass-card`, `text-rgb-cascade`, badges, `Sheet` (drawer), `Progress` do shadcn.
- Mobile first: `grid-cols-2 sm:grid-cols-4`, tabelas com `overflow-x-auto` + `min-w-[640px]`, sem scroll horizontal no viewport.
- Sem cores hardcoded — apenas tokens semânticos.

---

### Resumo de arquivos

**Migrations**
- criar `commission_payments`, `pro_labore_payments`
- `alter table partners add column monthly_pro_labore numeric default 0`

**Novos**
- `src/pages/CommissionsPage.tsx`
- `src/lib/commissions.ts`
- `src/components/CommissionPaymentDrawer.tsx`
- `src/components/ProLaborePaymentDrawer.tsx`

**Editados**
- `src/App.tsx` (rota)
- `src/components/AppLayout.tsx` (item de menu)
- `src/context/StoreContext.tsx` (novos dados/mutations)
- `src/types/index.ts` (novos tipos + `monthlyProLabore` em Partner)
