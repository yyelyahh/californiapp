## Refatoração financeira — separar patrimônio, capital e lucro

Vamos migrar do modelo atual (que trata compras de estoque como lucro reinvestido) para um modelo de **contabilidade simplificada** baseado em partidas dobradas informais: cada evento afeta contas patrimoniais bem definidas, sem misturar caixa, patrimônio e lucro.

---

### 1. Diagnóstico do estado atual

**Onde estão os cálculos hoje:**

- `src/context/StoreContext.tsx`
  - `getTotalRevenue` — soma `totalPrice` de vendas (regime de competência, ignora pagamento).
  - `getTotalCosts` — soma `totalCost` de `stock_entries` (trata TODA compra de estoque como custo).
  - `getTotalExpenses` — soma despesas.
  - `getTotalInvested` — soma `invested_amount` de investidores (confunde empréstimo com aporte).
  - `getNetProfit = Receita − Compras − Despesas − Perdas − Pró-labore` (conceitualmente errado: compras de estoque não são despesa).
- `src/pages/Dashboard.tsx`
  - Recalcula tudo por mês com CPV real (`purchasePrice × qty`) — este cálculo está correto.
  - Já mostra "Reposição de estoque" separado, mas o KPI "Capital investido" reusa `getTotalInvested` (dos investidores).
- `src/pages/CommissionsPage.tsx`
  - `operatingProfit = Recebido − Despesas − Pagamentos a investidores`.
  - `stockReinvestment` = todas as compras (conceitualmente incorreto — mistura reinvestimento com compras feitas com capital de terceiros/sócios).
  - `freeCash = operatingProfit − stockReinvestment` (idem).
- `src/pages/InvestorsPage.tsx` — trata todos "investidores" como emprestadores (juros fixos), sem distinguir sócio-aportador.

**Problemas conceituais:**

1. Compra de estoque é debitada do lucro — deveria ser troca Caixa↔Estoque.
2. Não existe conceito de "aporte de sócio" (só existem investidores com juros).
3. Empréstimo pago não some do histórico de origem do capital.
4. Retiradas dos sócios reduzem "saldo disponível" mas não separam do lucro operacional.
5. "Lucro reinvestido" é derivado de forma incorreta (soma todas as compras).

---

### 2. Nova arquitetura financeira

**Contas patrimoniais** (o "razão"):

```
ATIVO                            PASSIVO + PATRIMÔNIO
─────                            ────────────────────
Caixa                            Empréstimos a pagar
Estoque (a custo)                Capital dos sócios (aportes)
                                 Lucros acumulados
                                 (− Retiradas de sócios)
```

Identidade: **Ativo = Passivo + Patrimônio Líquido** (sempre).

**Regras de cada evento:**

| Evento | Débito (aumenta) | Crédito (diminui / origem) |
|---|---|---|
| Aporte de sócio | Caixa | Capital dos sócios |
| Empréstimo recebido | Caixa | Empréstimos a pagar |
| Pagamento de empréstimo (principal + juros) | Empréstimos a pagar (principal) + Despesa de juros | Caixa |
| Compra de estoque | Estoque | Caixa |
| Venda (recebida) | Caixa | Receita (→ lucro) e Estoque↓ / CPV↑ |
| Venda a prazo | Contas a receber | Receita |
| Recebimento de venda | Caixa | Contas a receber |
| Despesa operacional | Despesa | Caixa |
| Retirada de sócio | Retiradas (contra Lucros acumulados) | Caixa |
| Comissão paga | Despesa de comissão | Caixa |
| Perda de estoque | Perda (despesa) | Estoque |

**Fórmulas derivadas (nunca armazenadas, sempre calculadas):**

- **Caixa** = Σ(entradas de caixa) − Σ(saídas de caixa) — por partidas acima.
- **Estoque (a custo)** = Σ(compras) − Σ(CPV das vendas) − Σ(perdas).
- **Patrimônio Total** = Caixa + Estoque + Contas a Receber.
- **Empréstimos pendentes** = Σ(empréstimos recebidos) − Σ(pagamentos de principal).
- **Capital dos sócios** = Σ(aportes de sócios).
- **Lucro operacional acumulado** = Receita reconhecida − CPV − Despesas − Juros − Perdas − Comissões.  
  (Compras de estoque e retiradas **não** entram.)
- **Lucro já distribuído** = Σ(retiradas de sócios).
- **Lucro disponível para distribuir** = Lucro operacional acumulado − Lucro já distribuído − Comissões pendentes.
- **Lucros acumulados (retidos)** = Lucro operacional acumulado − Lucro já distribuído.

Validação contábil: `Caixa + Estoque + A Receber = Empréstimos + Capital + Lucros retidos`. Exibir um badge "Livro bate ✓" quando fecha, e diff quando não fecha (útil para detectar dados históricos inconsistentes).

---

### 3. Mudanças no modelo de dados

**Novas tabelas:**

- `partner_contributions` — aportes de sócios (id, partner_id, amount, date, notes).
- `loans` — empréstimos (id, lender_name, principal, interest_amount, received_date, notes, status).
- `loan_payments` — pagamentos de empréstimo (id, loan_id, principal_amount, interest_amount, date, notes).

**Reinterpretação de tabelas existentes** (sem migração destrutiva):

- `investors` + `dividends` → representam os empréstimos históricos. Migração: para cada `investor` existente, criar um `loan` com `principal = invested_amount`, `interest_amount = totalReturn − invested_amount`; para cada `dividend`, criar um `loan_payment` correspondente (rateando principal/juros proporcionalmente). Deixar as tabelas antigas somente-leitura (para não perder histórico) e ocultar o cadastro novo — ou migrar e drop. **Decisão sugerida:** migrar dados e manter a página "Investidores" renomeada como "Empréstimos", já que hoje o único investidor foi quitado.
- `pro_labore_payments` continua sendo "retirada de sócio" (já é o significado atual).

**Ledger unificado (opcional, mas recomendado):**

Uma tabela `financial_events` com `(id, kind, date, amount, ref_id, notes)` onde `kind ∈ {partner_contribution, loan_received, loan_payment, stock_purchase, sale_received, expense, withdrawal, commission_paid, stock_loss}`. Populada por triggers ou pelo próprio código quando cada evento é inserido. Serve como fonte única para:
- Histórico de movimentações da UI.
- Recalcular Caixa em tempo real sem varrer 8 tabelas.

Se preferir manter simples, pular a tabela `financial_events` e derivar tudo das tabelas existentes — funciona igual, só mais consultas.

---

### 4. Mudanças na UI

**Nova página "Financeiro" (ou reformar `CommissionsPage` → aba "Distribuição"):**

Três blocos claros, um conceito por bloco:

```
┌─ Patrimônio ─────────────────┐  ┌─ Capital & Passivo ──────────┐
│ Caixa            R$ X        │  │ Capital dos sócios   R$ X    │
│ Estoque (custo)  R$ Y        │  │ Empréstimos pend.    R$ Y    │
│ A receber        R$ Z        │  │ Lucros acumulados    R$ Z    │
│ ─────────────────────        │  │ ─────────────────────        │
│ Patrimônio total R$ T        │  │ Total                R$ T    │
└──────────────────────────────┘  └──────────────────────────────┘
                     [Livro bate ✓]

┌─ Distribuição de lucro ──────────────────────────────────────┐
│ Lucro operacional acumulado      R$ A                        │
│ (−) Já distribuído aos sócios    R$ B                        │
│ (−) Comissões pendentes          R$ C                        │
│ = Disponível para distribuir     R$ D                        │
└──────────────────────────────────────────────────────────────┘

┌─ Histórico de movimentações ─────────────────────────────────┐
│ 15/07  Compra de estoque          −R$ 500   (Caixa→Estoque)  │
│ 14/07  Retirada — João            −R$ 300   (Lucro dist.)    │
│ 13/07  Aporte — Maria             +R$ 1000  (Capital)        │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

**Dashboard:** manter o painel operacional (Receita/CPV/Lucro/Margem por período) — está conceitualmente correto. Substituir o KPI "Capital investido em estoque" por "Estoque a custo" derivado do razão. Remover a leitura de `getTotalInvested` como se fosse capital próprio.

**Página Investidores:** renomear para **Empréstimos**. Adicionar seção nova **Aportes dos sócios** com CRUD simples (partner_id, valor, data).

---

### 5. Refatoração de código

- `StoreContext.tsx`
  - Deprecar `getTotalCosts`, `getNetProfit`, `getTotalInvested` (manter temporariamente com aviso ou remover após atualizar callers).
  - Adicionar seletores puros: `getCash()`, `getInventoryCost()`, `getReceivables()`, `getPartnerCapital()`, `getLoansOutstanding()`, `getAccumulatedProfit()`, `getDistributedProfit()`, `getRetainedEarnings()`, `getDistributableProfit()`.
  - Cada seletor é uma soma explícita sobre as tabelas — sem derivações que misturem conceitos.
- `CommissionsPage.tsx`
  - Remover `stockReinvestment`, `freeCash`, `operatingProfit` do cálculo local. Passar a consumir seletores do store.
  - `available` (para validação de retirada) = `getDistributableProfit()`.
- `Dashboard.tsx`
  - Trocar "Capital investido em estoque" por `getInventoryCost()`.
  - Manter KPIs de período (receita/CPV/lucro) inalterados.

---

### 6. Ordem de implementação

1. **Migração de dados** — criar `partner_contributions`, `loans`, `loan_payments`; migrar `investors`/`dividends` para `loans`/`loan_payments`; opcional: criar `financial_events`.
2. **Store selectors novos** — adicionar sem remover os antigos.
3. **UI de aportes de sócios** — CRUD mínimo.
4. **Renomear "Investidores" → "Empréstimos"** e ajustar textos.
5. **Nova aba/página Financeiro** com os três blocos (Patrimônio / Capital / Distribuição) + histórico unificado.
6. **Ajustar `CommissionsPage` e `Dashboard`** para consumir os seletores novos.
7. **Remover getters obsoletos** (`getNetProfit`, `getTotalCosts`, `getTotalInvested`).

---

### 7. Perguntas antes de começar

1. **Aportes históricos dos sócios (R$ 831 iniciais):** você quer que eu já cadastre esse aporte na migração, ou vai lançar manualmente pela UI depois?
2. **Página "Investidores":** posso renomear para "Empréstimos" e migrar os dados existentes, ou prefere manter "Investidores" como rótulo (mesmo sendo empréstimo tecnicamente)?
3. **Tabela `financial_events`:** vale a pena criar o ledger unificado (mais robusto, permite histórico único e auditoria) ou prefere derivar tudo direto das tabelas de origem (mais simples, menos código)?
4. **Onde exibir os novos blocos de Patrimônio/Capital:** criar página nova "Financeiro" no menu, ou colocar como abas dentro da atual página "Distribuição"?
