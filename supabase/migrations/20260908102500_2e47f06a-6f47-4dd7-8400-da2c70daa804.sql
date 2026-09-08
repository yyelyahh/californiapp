-- ============================================================
-- Reserva de pedido pendente passa a ter prazo de validade (24h)
-- ------------------------------------------------------------
-- Como estava: um pedido 'pendente' segurava o estoque do vendedor
-- para sempre. O `available` do catálogo é a atribuição menos as
-- reservas pendentes, e nada nunca deixava de ser pendente sozinho.
-- Duas consequências:
--
--   1. Cliente que monta o carrinho e desiste tira aquele sabor do
--      catálogo até alguém abrir a SalesPage e recusar na mão.
--   2. create_pending_order é GRANT ... TO anon, sem rate limit:
--      dava para zerar a disponibilidade de um vendedor inteiro
--      mandando pedidos falsos, sem nunca chegar perto do WhatsApp.
--
-- A partir daqui a reserva vale 24h. Isso é aplicado em DOIS níveis
-- de propósito:
--
--   - No cálculo: pedido pendente mais velho que o prazo simplesmente
--     não conta mais como reserva (ver as migrations seguintes, que
--     reescrevem create_pending_order e get_seller_catalog). Assim o
--     estoque volta ao catálogo na hora, sem depender de nada rodar.
--   - No estado: expire_stale_orders() carimba esses pedidos como
--     'expirada', para eles saírem da lista do vendedor.
--
-- Não há pg_cron aqui — a varredura é chamada de dentro do fluxo
-- (create_pending_order) e pela tela de pedidos. Como o cálculo já
-- está correto sem ela, atrasar a varredura não prende estoque
-- nenhum; ela só arruma a lista.
-- ============================================================

-- ----------------------------------------------------------
-- 1) 'expirada' é um desfecho novo, separado de 'recusada'
--    ------------------------------------------------------
--    Recusada é decisão do vendedor. Expirada é ninguém ter
--    respondido a tempo. Misturar as duas apagaria justamente o
--    dado que diz se você está perdendo venda por demora.
-- ----------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pendente', 'confirmada', 'recusada', 'expirada'));

-- ----------------------------------------------------------
-- 2) O prazo mora num lugar só
--    ------------------------------------------------------
--    Três consultas diferentes precisam do mesmo número. Deixar o
--    literal '24 hours' espalhado por elas é garantir que um dia
--    alguém mude duas e esqueça a terceira — e aí o catálogo
--    liberaria estoque que a validação ainda considera reservado.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.order_reservation_ttl()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT interval '24 hours';
$$;

COMMENT ON FUNCTION public.order_reservation_ttl() IS
  'Por quanto tempo um pedido pendente segura o estoque do vendedor. Mudar aqui muda o cálculo do catálogo e a varredura de expiração juntos.';

-- ----------------------------------------------------------
-- 3) A varredura
--    ------------------------------------------------------
--    Idempotente e sem parâmetro: só carimba o que já passou do
--    prazo. Pode ser chamada por qualquer um a qualquer momento
--    sem risco de expirar pedido vivo.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.orders
  SET status = 'expirada'
  WHERE status = 'pendente'
    AND created_at < now() - public.order_reservation_ttl();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- anon NÃO precisa disto: create_pending_order é SECURITY DEFINER e
-- chama a varredura por dentro, com os privilégios do dono. Quem
-- chama de fora é a tela de pedidos, que é autenticada.
REVOKE ALL ON FUNCTION public.expire_stale_orders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_orders() TO authenticated;
