-- ============================================================
-- A posição do razão somada no banco, não no navegador
-- ------------------------------------------------------------
-- O Caixa, o Estoque a custo, o A receber e o resto do Financeiro são a SOMA
-- das colunas *_delta da view financial_events. O front baixava a view inteira
-- e somava lá — e o PostgREST devolve no máximo 1000 linhas por consulta
-- (max_rows do Supabase). Quando o razão passou de 1000 linhas, a consulta
-- começou a voltar CORTADA, sem erro nenhum, e toda posição passou a ser a
-- soma de só uma parte da história. O número na tela estava errado e nada
-- acusava.
--
-- Somar aqui resolve as duas coisas de uma vez: a conta vê todas as linhas, e
-- o que atravessa a rede são sete números em vez de milhares de linhas.
--
-- SECURITY INVOKER de propósito, igual à view (security_invoker = on): quem
-- chama soma exatamente o que já podia ler, pela RLS das tabelas por baixo. A
-- function não abre nada que a leitura direta da view não abrisse.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ledger_position()
RETURNS TABLE (
  cash               numeric,
  inventory          numeric,
  receivable         numeric,
  partner_capital    numeric,
  loan               numeric,
  accumulated_profit numeric,
  distributed_profit numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $ledger_position$
  SELECT
    coalesce(sum(cash_delta), 0)::numeric,
    coalesce(sum(inventory_delta), 0)::numeric,
    coalesce(sum(receivable_delta), 0)::numeric,
    coalesce(sum(partner_capital_delta), 0)::numeric,
    coalesce(sum(loan_delta), 0)::numeric,
    coalesce(sum(accumulated_profit_delta), 0)::numeric,
    coalesce(sum(distributed_profit_delta), 0)::numeric
  FROM public.financial_events;
$ledger_position$;

REVOKE ALL ON FUNCTION public.ledger_position() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledger_position() TO authenticated;

-- ------------------------------------------------------------
-- Para conferir contra a tela, pelo SQL Editor (lá a RLS não se aplica, então
-- o número é o da rede inteira — o mesmo que um admin de todas as filiais vê):
--
--   SELECT * FROM public.ledger_position();
--   SELECT count(*) FROM public.financial_events;
-- ------------------------------------------------------------
