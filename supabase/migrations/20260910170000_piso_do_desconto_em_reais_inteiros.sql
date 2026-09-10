-- ============================================================
-- Preço premiado sempre em reais inteiros
-- ------------------------------------------------------------
-- Ajusta a loyalty_unit_price (20260910150000): TODO preço de unidade
-- premiada sai inteiro, sem centavos — tanto o dos 50% quanto o do piso
-- (custo + 15%). Preço de prêmio é número que a pessoa lê no card e o
-- vendedor repete no WhatsApp; R$ 23,00 se fala, R$ 22,47 se soletra.
--
-- SEMPRE PARA CIMA, nunca para o mais perto. Dois motivos, e o primeiro
-- não é estético:
--
--   * `round` quebraria a trava do piso justamente nos valores baixos,
--     onde os 15% valem menos de R$ 0,50:
--       custo R$ 2,00 → 2,30 → round = 2  → igual ao custo. Proibido.
--       custo R$ 2,00 → 2,30 → ceil  = 3  → acima, em qualquer valor.
--   * `ceil` anda para o mesmo lado da regra inteira (protege a margem) e
--     embaralha a dedução do custo a partir do preço: com centavos,
--     dividir por 1,15 devolvia o número exato; com o inteiro, uma faixa.
--
-- O LEAST saiu de dentro do CASE e passou a envolver o resultado todo. É
-- o mesmo cuidado de antes — o preço premiado nunca pode passar o preço
-- de prateleira — mas agora ele vale para os três caminhos, porque
-- arredondar para cima também pode estourar no ramo dos 50%: produto de
-- R$ 0,50 daria ceil(0,25) = R$ 1,00, um "desconto" que dobra o preço.
-- Quando o LEAST morde, o preço premiado fica IGUAL ao cheio, e a
-- create_pending_order trata isso como prêmio não usado: ele passa para o
-- próximo item em vez de virar uma linha de desconto que não desconta.
--
-- A comparação do meio testa o preço QUE VAI SER COBRADO (já com o ceil),
-- não a metade exata: é ele que precisa ficar acima do custo.
--
-- Mesmo nome, mesmos parâmetros, mesmo tipo de retorno: CREATE OR REPLACE
-- basta (sem DROP), a ACL é preservada, e rodar de novo não faz nada.
-- ============================================================

CREATE OR REPLACE FUNCTION public.loyalty_unit_price(
  p_sale_price     numeric,
  p_purchase_price numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $loyalty_unit_price$
  SELECT LEAST(
    CASE
      -- Sem custo cadastrado não há piso a respeitar: metade do preço.
      WHEN p_purchase_price IS NULL OR p_purchase_price <= 0
        THEN ceil(COALESCE(p_sale_price, 0) * 0.5)
      -- A metade arredondada ainda fica ACIMA do custo: é o desconto cheio.
      WHEN ceil(COALESCE(p_sale_price, 0) * 0.5) > p_purchase_price
        THEN ceil(COALESCE(p_sale_price, 0) * 0.5)
      -- A metade encostaria no custo: sobe para custo + 15%.
      ELSE ceil(p_purchase_price * 1.15)
    END,
    COALESCE(p_sale_price, 0)
  );
$loyalty_unit_price$;
