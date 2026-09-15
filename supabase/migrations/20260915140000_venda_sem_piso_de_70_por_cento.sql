-- ============================================================
-- A venda perde o piso de 70% do preço de tabela
-- ------------------------------------------------------------
-- O `validate_sale_integrity` recusava, para quem não é admin, qualquer venda
-- com `unit_price` abaixo de 70% do preço de tabela do produto. A regra entrou
-- na 20260814121115, num lote de endurecimento de segurança, e nunca foi
-- pedida pelo dono — ela chegou junto com outras coisas e ficou.
--
-- Ela conflita com a fidelidade, que nasceu DEPOIS (20260910150000): a unidade
-- premiada sai por metade do preço, e metade é sempre menos que 70%. Com
-- números do catálogo:
--
--   venda 75, custo 40      → prêmio  46   piso 52,50  → recusado
--   venda 149, custo 68,50  → prêmio  75   piso 104,30 → recusado
--   venda 159, custo 68     → prêmio  80   piso 111,30 → recusado
--
-- Ou seja: o gatilho barrava um preço que o PRÓPRIO BANCO tinha calculado.
-- `order_items.unit_price` não é digitado por ninguém — `create_pending_order`
-- o grava a partir de `product_branch.sale_price` lido lá dentro, justamente
-- para o carrinho não ter voz no preço —, e `confirm_order` só repassa aquele
-- número para `create_sale`. Na prática o admin nunca viu o erro (é isento) e
-- o vendedor não conseguia confirmar, pelo /minhas-vendas, o primeiro pedido
-- de um cliente que chegasse na sexta unidade.
--
-- E o piso também não guardava a porta que dizia guardar: o vendedor não tem
-- formulário de venda manual — a venda dele nasce de pedido do catálogo
-- confirmado. Não havia onde ele digitar um preço para o piso conferir.
--
-- O QUE FICA, e fica de propósito: as quatro checagens de integridade
-- aritmética da linha (quantidade positiva, valor unitário não negativo, total
-- igual a quantidade × unitário, valor pago dentro do total). Essas não são
-- regra de preço, são o que impede o razão de fechar errado — `financial_events`
-- soma `total_price` e `paid_amount` direto.
--
-- Consequência assumida: as policies de RLS permitem ao vendedor um INSERT
-- direto em `sales` via PostgREST, sem passar por `create_sale`, e era este
-- gatilho o único limite de PREÇO naquele caminho. Ele continua limitado no
-- resto (só a própria venda, e `create_sale` é quem checa estoque e
-- atribuição), mas o valor por unidade agora é livre ali. Fechar essa porta é
-- outro assunto: seria revogar o INSERT direto em `sales` de `authenticated` e
-- obrigar tudo a passar pela function, como já acontece de fato no app.
--
-- Mesmo nome, mesma assinatura, mesmo retorno: CREATE OR REPLACE basta e o
-- gatilho pendurado em `sales` continua o mesmo — não é preciso recriá-lo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_sale_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $validate_sale_integrity$
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade inválida';
  END IF;
  IF NEW.unit_price IS NULL OR NEW.unit_price < 0 THEN
    RAISE EXCEPTION 'Valor unitário inválido';
  END IF;
  IF NEW.total_price IS NULL
     OR round(NEW.total_price, 2) <> round(NEW.unit_price * NEW.quantity, 2) THEN
    RAISE EXCEPTION 'Total da venda não confere com quantidade x valor unitário';
  END IF;
  IF COALESCE(NEW.paid_amount, 0) < 0
     OR round(COALESCE(NEW.paid_amount, 0), 2) > round(NEW.total_price, 2) THEN
    RAISE EXCEPTION 'Valor pago inválido';
  END IF;

  RETURN NEW;
END;
$validate_sale_integrity$;

COMMENT ON FUNCTION public.validate_sale_integrity() IS
  'Integridade aritmética da linha de venda. NÃO valida preço contra tabela: a unidade premiada pela fidelidade sai por metade, e quem define preço de pedido é o banco.';
