# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Sócios / donos (usuário principal do ERP).** Duas ou três pessoas que tocam o negócio inteiro e fazem tudo no sistema: lançam (venda manual, entrada de estoque, perda, despesa, pagamento de comissão), conferem os números e decidem (reposição, distribuição de estoque entre vendedores, retirada dos sócios). Usam o ERP **no celular e no notebook na mesma medida**: celular para lançar na hora, na rua; notebook para fechar o mês e analisar. Não há equipe operando por eles nem pessoa dedicada por cidade.

**Vendedores (consignados).** Recebem estoque em consignação e vendem pela loja pública deles. Usam uma tela só, `/minhas-vendas`, para confirmar ou recusar os pedidos que chegam do catálogo e acompanhar a comissão. Não registram venda manual.

**Clientes finais.** Abrem o link da loja de um vendedor (`/loja/<apelido>`) que chega pelo WhatsApp, quase sempre no celular. Olham o catálogo sem se identificar, montam o carrinho e mandam o pedido; o telefone só é pedido no checkout.

## Product Purpose

Mini-ERP de uma operação de revenda de produtos organizados por **marca → modelo → sabor** (ex.: Elfbar, Ignite), em **duas cidades (filiais)**, com vendedores em **consignação**, estendido com uma **loja pública por vendedor** (catálogo, carrinho, checkout via WhatsApp e fidelidade).

Sucesso, na ordem que os donos definiram:

1. **Número certo.** Estoque, caixa, comissão e lucro batem com a realidade, e dá para confiar sem conferir à mão.
2. **Lançar rápido.** Venda, entrada e perda em poucos toques, sem atrito, inclusive no celular.
3. **Controlar os vendedores.** Saber o que está na mão de cada um, quanto devem e quanto há para pagar.

Converter mais pela loja pública importa, mas não está entre as prioridades declaradas do sistema.

## Positioning

É um sistema feito para o modelo de **consignação por subconjunto**: o estoque de uma filial já inclui o que está na mão dos vendedores, e cada venda, perda ou transferência debita as duas contas ao mesmo tempo. Somado a isso vêm duas filiais com estoque, preço e custo próprios sob um catálogo compartilhado, e uma loja por vendedor cujo catálogo é calculado a partir do que ele tem na mão. Fidelidade e combo são aplicados, não só anunciados: o preço com desconto é calculado no banco e gravado no pedido. Um ERP genérico ou uma loja genérica não têm essa amarração entre estoque consignado, comissão por faixa e loja do vendedor.

## Operating Context

- **Duas filiais (cidades).** Operação é por filial (estoque, vendas, despesas, comissões); sociedade é global (sócios, aportes, empréstimos, pró-labore); compras ao fornecedor são centrais e divididas entre as cidades no recebimento. "Todas as filiais" é só leitura.
- **Ciclo do vendedor.** Recebe estoque (distribuição) → vende pela loja → confirma o pedido em `/minhas-vendas` → a comissão fecha por mês, em faixas por unidades vendidas (10% → 12,5% → 15%) → o consumo próprio dele é descontado da comissão → os sócios pagam o saldo.
- **Canal de venda.** O pedido nasce na loja e é enviado pelo WhatsApp do próprio cliente; a confirmação e a forma de pagamento são manuais, sem pagamento online.
- **Fechamento.** Os sócios fecham o mês olhando Dashboard, Distribuição (quanto cabe distribuir aos sócios) e Financeiro (caixa, a receber, capital, empréstimos), e exportam um relatório completo em Excel.
- **Como o sistema é mantido.** O dono edita pelo Lovable, em linguagem natural, e revisa o diff antes de aprovar. Não há servidor próprio: o front fala direto com o Supabase, e as regras de dinheiro e estoque moram em functions e gatilhos do Postgres. Migrations são aplicadas pelo Lovable ou pelo SQL Editor.

## Capabilities and Constraints

- **Telas do ERP:** Dashboard (montável por quem usa), Produtos, Entrada (compras e transferência entre filiais), Perdas, Vendas (com pedidos pendentes da loja), Despesas, Distribuição (vendedores, comissões, sócios), Insights (cobertura de estoque), Financeiro (razão, sociedade, empréstimos) e Auditoria (quem fez cada escrita).
- **Loja pública:** catálogo agrupado por modelo, carrinho que sobrevive ao reload, checkout com fidelidade (a cada 6 unidades, uma com desconto) e combo por modelo, reserva de estoque de 24h, link curto por vendedor.
- **Regras que o sistema garante:** nada de dinheiro vem do navegador (preço e custo são lidos no banco); o custo de cada venda fica congelado nela; produto e vendedor não se excluem, só se arquivam; estoque só se mexe por operações atômicas no banco; toda escrita relevante fica na auditoria.
- **Idioma:** tudo em português do Brasil.
- **Limitações conhecidas:** sem upload de foto (só link); sem pagamento online (adiado de propósito); sem tela de clientes nem de histórico de pedidos; o app carrega o histórico de vendas inteiro na memória, com limite de 100 linhas desenhadas por lista.

## Brand Commitments

- **Nome:** California.
- **Voz:** português do Brasil, direto e curto, em segunda pessoa na loja; rótulo de botão no infinitivo ("Registrar venda", "Pagar comissão"). Mensagens de erro dizem o que fazer e o limite ("Só 3 un. livres na casa"), nunca o erro cru do banco.
- **Duas identidades separadas:** o ERP e a loja pública têm linguagens próprias, e uma não empresta nada da outra. A tela do vendedor (`/minhas-vendas`) segue a da loja.

## Evidence on Hand

- Os dados reais (vendas, estoque, clientes, vendedores) moram no Supabase do projeto; nada disso está no repositório.
- Não há depoimentos, estudos de caso, métricas publicadas, prêmios nem imprensa. Trabalho futuro não deve inventar nenhum deles.
- A documentação de regras de negócio está em `CLAUDE.md` (raiz) e a da loja em `src/pages/CLAUDE.md`.

## Product Principles

1. **O número tem que bater.** Um número que aparece em duas telas é a mesma conta nas duas, e número que não se explica faz duvidar do sistema inteiro. Mostrar de onde o número vem vale mais que mostrar mais números.
2. **Regra de dinheiro e estoque mora no banco.** A tela ajuda e antecipa, mas quem garante é o Postgres; regra que existe só no navegador não existe.
3. **O passado não se reescreve.** Arquivar em vez de excluir, custo congelado na venda, correção por lançamento novo em vez de edição silenciosa.
4. **Rápido de lançar, no celular e no notebook.** Toda ação frequente cabe em poucos toques nos dois tamanhos, e a ação principal fica onde o olho já está.
5. **Um assunto, um lugar.** Tudo o que se faz com um vendedor, um produto ou um período acontece num lugar só, sem fechar uma coisa para abrir outra.
