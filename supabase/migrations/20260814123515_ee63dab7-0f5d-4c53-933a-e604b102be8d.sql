-- 1) Column-level protection for product cost data
REVOKE SELECT ON public.products FROM authenticated;
GRANT SELECT (id, name, brand, model, flavor, sale_price, stock, min_stock, created_at)
  ON public.products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;

-- 2) get_my_seller_id no longer needs elevated privileges (sellers can read their own row)
CREATE OR REPLACE FUNCTION public.get_my_seller_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT id FROM public.sellers WHERE user_id = auth.uid() LIMIT 1
$$;

-- 3) has_role: restrict elevated lookups to the caller's own identity
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() AND auth.uid() IS NOT NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    )
  END
$$;

-- 4) Scope realtime broadcast topics
DROP POLICY IF EXISTS "Authenticated users read allowed realtime topics" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated users write allowed realtime topics" ON realtime.messages;

CREATE POLICY "Authenticated users read allowed realtime topics"
ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'admin:%' THEN public.has_role(auth.uid(), 'admin')
    WHEN realtime.topic() = 'store-sync' THEN true
    WHEN realtime.topic() LIKE 'seller:%' THEN
      realtime.topic() = 'seller:' || coalesce(public.get_my_seller_id()::text, '-')
    ELSE false
  END
);

CREATE POLICY "Authenticated users write allowed realtime topics"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  CASE
    WHEN realtime.topic() LIKE 'admin:%' THEN public.has_role(auth.uid(), 'admin')
    WHEN realtime.topic() = 'store-sync' THEN true
    WHEN realtime.topic() LIKE 'seller:%' THEN
      realtime.topic() = 'seller:' || coalesce(public.get_my_seller_id()::text, '-')
    ELSE false
  END
);