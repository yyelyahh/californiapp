
## Problema

Hoje a fórmula é `saldoConsumo = max(0, consumoDoPeríodo − pagamentosDeDívidaDoPeríodo)`.

Como decidimos ignorar tudo antes de 01/06/2026, as **retiradas antigas** ficaram de fora — mas os **pagamentos** dessas dívidas antigas (feitos em junho) continuaram entrando, zerando o consumo do mês.

Caso Rafa (jun/2026):
- Retiradas jun: R$ 155,60
- Pagamentos jun (quitando dívida antiga de R$ 538,50): R$ 163,00
- Resultado errado: saldo de consumo = R$ 0 → nada abate da comissão (R$ 247,63).

## Decisão de cálculo

Manter "só do período", **mas remover os pagamentos de dívida da fórmula do saldo de consumo**. Como dívidas/retiradas pré-junho foram ignoradas por escopo, os pagamentos pré-existentes também devem ser ignorados — não há dívida no período para eles abaterem.

Nova fórmula em `CommissionsPage` e `SellerReportDrawer`:

```
consumoTotal       = retiradas (período) + dívidas manuais (período)
saldoConsumo       = consumoTotal       ← abate direto da comissão
comissão_período   = vendas (período) × faixa final
comissão_paga      = commission_payments (período)
saldo_comissão     = comissão_período − saldoConsumo − comissão_paga
```

Pagamentos de dívida (`seller_debt_payments`) continuam existindo e aparecem na timeline como histórico, mas **não entram mais no cálculo do saldo de comissão**. Ficam só como registro/abatimento informativo.

Validação rápida com o Rafa em junho:
- Comissão: R$ 247,63
- Consumo descontado: R$ 155,60
- Comissão paga: R$ 0
- **Saldo: R$ 92,03**

## Mudanças na UI

### 1. Card do vendedor — `CommissionsPage.tsx`
Adicionar um mini-bloco logo abaixo do nome/faixa, antes do botão "Pagar comissão":

```
Comissão gerada     R$ 247,63
(−) Consumo         R$ 155,60   (3 retiradas)
(−) Comissão paga   R$   0,00
─────────────────────────────────
Saldo               R$  92,03
```

- Linha "Consumo" em destaque (cor `warning`) quando > 0.
- Pequeno chip "consumo zerou comissão" quando `saldoConsumo ≥ accrued`.

### 2. Drawer/Relatório do vendedor — `SellerReportDrawer.tsx`
- Trocar a nota atual de "Saldo: 247,63 − 0 − 0 = ..." pela fórmula correta com **consumo bem destacado** em vermelho/âmbar.
- No grid de Stats, manter "Consumo" mas adicionar tooltip/sub: "abatido da comissão".
- Adicionar bloco "Consumo descontado" listando as retiradas que entraram no abate (data, produto, valor).

### 3. Mensagem WhatsApp — `buildWhatsSales`
Reescrever o bloco 💰 COMISSÃO para deixar a conta explícita:

```
💰 COMISSÃO — junho/2026
• Faixa: 12,5% (13 un.)
• Comissão gerada: R$ 247,63
• (−) Consumo no mês: R$ 155,60
• (−) Comissão já paga: R$ 0,00
──────────────────────────────
• Saldo a receber: R$ 92,03

🍃 CONSUMO DO MÊS (descontado da comissão)
• Pod X (2x) • R$ 80,00
• Pod Y (1x) • R$ 75,60
Total: R$ 155,60
```

## Detalhes técnicos

**`src/pages/CommissionsPage.tsx`** (`periodMetrics`, ~linha 143–165):
- Remover `debtPaymentsTotal` da fórmula do `saldoConsumo`. Manter o cálculo da variável apenas para exibição na timeline.
- `saldoConsumo = consumoTotal`.
- `balance = accrued − saldoConsumo − commPaid` (inalterado em forma).
- Card do vendedor: novo componente inline de "mini demonstrativo" usando as variáveis já calculadas (`accrued`, `saldoConsumo`, `commPaid`, `balance`).

**`src/components/SellerReportDrawer.tsx`** (`report`, ~linha 100–169):
- Mesmo ajuste: `saldoConsumo = consumoTotal` (sem subtrair `debtPaymentsTotal`).
- Atualizar a nota explicativa (linha ~353) com a nova conta.
- Atualizar `buildWhatsSales` com o template acima.

**Sem mudanças** em schema, contexto ou em `seller_debt_payments` (continuam sendo armazenados e exibidos como histórico).

## Arquivos afetados

- `src/pages/CommissionsPage.tsx`
- `src/components/SellerReportDrawer.tsx`
