## Objetivo

Eliminar a página separada "Contas de Funcionários" e trazer toda a operação (consumos, dívidas manuais, pagamentos de dívida) para dentro da página **Comissão**, com regras claras para o legado anterior ao mês 6 (junho/2026 — início do projeto).

---

## Regras de negócio

**Legado (tudo com data anterior a 01/06/2026):**
- Vendas legadas → geram **comissão de 10% fixos** (sem progressão de faixa).
- Consumos legados (retiradas) → entram normalmente no consumo do vendedor.
- Dívidas manuais legadas → entram normalmente no saldo devedor.
- Pagamentos de dívida (`seller_debt_payments`) legados → continuam abatendo consumo/dívida.

**Crédito legado de comissão (10% sobre vendas pré-junho):**
- Usado **apenas para abater consumo/dívida manual** do vendedor.
- **Nunca** aparece como "Comissão paga ao funcionário" nem como saldo a pagar de comissão no período atual.
- Se sobrar saldo positivo após abater consumo/dívida, é simplesmente descartado (não vira crédito futuro de comissão).

**Período atual (junho/2026 em diante):**
- Comissão progressiva normal (10% / 12,5% / 15%) já existente.
- Consumo do período abate o saldo de comissão do período (regra atual já implementada).
- Dívidas manuais e retiradas continuam sendo abatidas primeiro pelo crédito legado e depois pelo saldo de comissão do período.

**Fórmula final do saldo do vendedor (mostrado em "Conta Corrente"):**
```
consumo_total       = retiradas + dívidas manuais (todas as datas)
pagamentos_dívida   = seller_debt_payments (todas as datas)
crédito_legado      = vendas_pré_junho × 10%
saldo_consumo       = max(0, consumo_total − pagamentos_dívida − crédito_legado)
comissão_período    = vendas_no_período × taxa_da_faixa
comissão_paga       = commission_payments no período
saldo_comissão      = comissão_período − saldo_consumo − comissão_paga
```

---

## Mudanças na página Comissão (`CommissionsPage.tsx`)

1. **Novo card "Consumo & Dívidas do Vendedor"** dentro de cada linha da Conta Corrente:
   - Total consumido (retiradas + dívidas manuais, todas as datas)
   - Pagamentos de dívida
   - Crédito legado disponível (vendas pré-junho × 10%)
   - Saldo de consumo a abater
2. **Novo botão "Adicionar Dívida Manual"** no header da seção de vendedores → abre Sheet (igual ao existente em SellerAccountsPage).
3. **Novo botão "Registrar Pagamento de Dívida"** ao lado do "Pagar Comissão" em cada linha do vendedor.
4. **Extrato do vendedor** (drawer já existente) passa a listar também:
   - Retiradas (todas as datas, separadas em "legado" vs "período")
   - Dívidas manuais
   - Pagamentos de dívida
   - Linha "Crédito legado de comissão (10%)" como ajuste informativo
5. **KPI atualizado**: "A pagar a vendedores" passa a usar o `saldo_comissão` da nova fórmula (não muda nome, só a base de cálculo).

---

## Mudanças no Relatório do Vendedor (`SellerReportDrawer.tsx`)

- Consumo passa a considerar **todas as retiradas + dívidas manuais** (não só do período).
- Crédito legado de comissão (10% sobre vendas pré-junho) é mostrado como linha separada em "Comissão", deixando claro que abate consumo mas não é pago.
- Mensagem do WhatsApp ganha bloco extra quando houver legado:
  ```
  💰 COMISSÃO
  • Faixa atual: 12,5%
  • Comissão gerada no período: R$ X
  • Crédito legado (10% sobre vendas anteriores): R$ Y — abate apenas consumo
  • Consumo total (inclui legado): R$ Z
  • Pagamentos de dívida: R$ W
  • Comissão paga: R$ K
  • Saldo disponível: R$ ...
  ```
- O cálculo do saldo na UI e no WhatsApp segue a fórmula final acima.

---

## Remoção da página antiga

- Apagar `src/pages/SellerAccountsPage.tsx`.
- Remover a rota `/seller-accounts` em `src/App.tsx`.
- Remover o item de menu "Contas Func." em `src/components/AppLayout.tsx`.
- Manter intactas todas as tabelas (`seller_debt_payments`, `seller_manual_debts`) e métodos do `StoreContext` — apenas mudam os locais de uso.

---

## Detalhes técnicos

- Cutoff legado: `PROJECT_START = startOfMonth(new Date(2026, 5, 1))` (junho/2026, fixo) — não pode usar mês atual porque já estamos depois de junho.
- Reaproveitar `addSellerDebtPayment`, `addSellerManualDebt`, `deleteSellerDebtPayment`, `deleteSellerManualDebt` do `StoreContext`.
- Nenhuma alteração de schema/DB.

---

## Arquivos afetados

**Editados**
- `src/pages/CommissionsPage.tsx`
- `src/components/SellerReportDrawer.tsx`
- `src/App.tsx`
- `src/components/AppLayout.tsx`

**Removidos**
- `src/pages/SellerAccountsPage.tsx`
