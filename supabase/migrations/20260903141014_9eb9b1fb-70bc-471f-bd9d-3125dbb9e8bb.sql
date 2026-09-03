-- ============================================================
-- Vendedor precisa enxergar o cliente dos próprios pedidos
-- ------------------------------------------------------------
-- customers só tinha policy de admin, então o join embutido
-- customers(name, whatsapp) voltava NULL para o vendedor e o card
-- de pedido novo aparecia como "Sem cliente" / "—" — sem nome nem
-- telefone, ele não sabe para quem é o pedido nem consegue chamar
-- a pessoa no WhatsApp.
-- O limite continua valendo: só clientes que fizeram pedido COM ele.
-- Mesma forma da policy "Sellers read own order_items".
-- ============================================================

DROP POLICY IF EXISTS "Sellers read own customers" ON public.customers;
CREATE POLICY "Sellers read own customers" ON public.customers FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = customers.id
      AND o.seller_id = public.get_my_seller_id()
  ));
