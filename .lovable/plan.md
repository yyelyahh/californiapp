# Auditoria dos valores do Financeiro

Fui direto no banco somar cada linha do ledger `financial_events`. Aqui está o que cada card está mostrando hoje e onde estão os erros conceituais.

## Números atuais (fonte de verdade)

**Ativo**
- Caixa: **R$ 3.064,95** (soma de todas as entradas/saídas de dinheiro)
- Estoque a custo (ledger): **R$ 2.634,21** — módulo Produtos mostra R$ 2.609,33 → resíduo ~R$ 25 é o desvio conhecido de custo histórico vs. atual
- A Receber: **R$ 2.906,80** ← o que você contestou
- **Total Ativo: R$ 8.605,96**

**Passivo + PL**
- Capital dos sócios: R$ 0,00 (nenhum aporte cadastrado ainda)
- Empréstimos pendentes: R$ 0,00 (todos quitados)
- Lucros retidos: **R$ 6.618,14** (acumulado 11.512,14 − distribuído 4.894,00)
- **Total Passivo+PL: R$ 6.618,14**

**Δ = R$ 1.987,82** → livro NÃO está batendo. Esse desalinhamento é sintoma dos problemas abaixo.

## Composição do "A Receber" (R$ 2.906,80)

| Origem | Valor |
|---|---|
| Vendas em aberto (`type = venda`, saldo devedor) | R$ 1.036,00 |
| Retiradas de funcionário (`type = retirada_funcionario`, 27 registros, 0 pago) | R$ 1.721,36 |
| Dívidas manuais (`seller_manual_debts`, 3 registros) | R$ 993,91 |
| Pagamentos de dívida (`seller_debt_payments`, 29 registros) | −R$ 842,47 |
| **Total** | **R$ 2.906,80** |

## Problemas identificados

### 1. Dívidas manuais estão contabilizadas com contrapartida errada (Δ = 2 × 993,91 = 1.987,82)
No ledger, cada `seller_manual_debt` faz:
- `receivable_delta = +993,91` (Ativo sobe)
- `accumulated_profit_delta = −993,91` (PL cai)

Como Ativo↑ e PL↓ ao mesmo tempo, o balanço rompe em exatamente **2 × 993,91 = R$ 1.987,82** — que é o Δ do livro. Essa é a causa matemática exata do "livro não bate".

Além disso, o modelo assume que dívida manual é "perda absorvida", mas na prática ela costuma cobrir consumo/quebra que **já saiu do estoque em outro lançamento** (retirada de funcionário, perda). Ou seja, hoje o mesmo prejuízo é reconhecido duas vezes.

### 2. Retirada de funcionário + Dívida manual = potencial duplicação de A Receber
As 27 retiradas de funcionário já geram R$ 1.721,36 de conta a receber (produto sai, vendedor deve). Se as dívidas manuais estão sendo lançadas para cobrir consumo desses mesmos itens, o vendedor aparece devendo o valor duas vezes.

Precisa esclarecer: **dívida manual serve para o quê hoje?** Se é para lançar consumo que **não** tem retirada de estoque correspondente (ex.: quebrou um pod que estava com ele), fica. Se é uma cópia manual do que a retirada já registrou, tem que sair.

### 3. Vendas de funcionário viram receita imediata mesmo sem pagamento
O ledger reconhece as 27 retiradas como venda (receita + CPV → lucro) no ato da retirada, mesmo com `paid_amount = 0`. Isso infla o "Lucros retidos" em ~R$ 1.721 antes de o dinheiro entrar. Vendas normais em aberto (R$ 1.036) têm o mesmo comportamento.

Isso é regime de competência (correto contabilmente), mas incompatível com a política que você usa em Distribuição ("comissão só quando pago"). Vale alinhar: ou o Financeiro também espera o pagamento, ou o card explicita que Lucros Retidos inclui vendas ainda a receber.

### 4. Caixa (R$ 3.064,95) — verificar se bate
Não temos referência externa. Se você tem o extrato real da conta/dinheiro em mãos, comparar com esse número é o teste final. Se divergir, provavelmente está faltando lançamento em algum canal (recebimentos fora do sistema, pagamentos manuais).

## Perguntas antes de corrigir

1. **Dívida manual** (`seller_manual_debts`): representa consumo/quebra que **já saiu** do estoque via retirada de funcionário, ou é um lançamento independente para casos sem retirada?
2. **Retirada de funcionário**: você considera receita no ato ou só quando o vendedor paga? (Isso muda como o lucro operacional é calculado.)
3. **Caixa (R$ 3.064,95)**: você consegue comparar com o saldo real hoje? Se sim, quanto está no caixa/conta de fato?

## Correções propostas (depende das respostas acima)

- **Sempre corrigir**: refazer o lançamento de `seller_manual_debt` no ledger para respeitar a partida dobrada. Se representa perda real → `inventory_delta = −amount` (ou `accumulated_profit_delta = −amount` **sem** subir A Receber, ou subir A Receber **e** reduzir estoque). Se é apenas reclassificação → só mover valores dentro do Ativo, sem tocar PL.
- **Se dívidas manuais duplicam retiradas** (resposta 1): remover o receivable duplicado — mantém só a retirada como fonte da conta a receber.
- **Se retirada de funcionário não deve virar receita antes de pagar** (resposta 2): reclassificar como transferência interna (estoque → conta a receber pelo custo, sem tocar lucro), e só reconhecer margem no `seller_debt_payment`.
- **Ledger consistente**: fechar essas duas frentes derruba o Δ para ~R$ 25 (só o resíduo de valoração de estoque, que fica para depois).

## Arquivos afetados
- **Migração**: `CREATE OR REPLACE VIEW public.financial_events` corrigindo `seller_manual_debt`, `seller_withdrawal` (retirada de funcionário) e possivelmente `seller_debt_payment`.
- **Sem mudança no frontend**: `FinancePage.tsx` lê tudo pela view — os cards passam a mostrar valores corretos automaticamente.

Aguardando suas respostas às 3 perguntas para escolher a variante certa da correção.
