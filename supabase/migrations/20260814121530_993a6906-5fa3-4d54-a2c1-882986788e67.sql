-- Realtime channel authorization (RLS is already enabled on realtime.messages)
DROP POLICY IF EXISTS "Authenticated users read allowed realtime topics" ON realtime.messages;
CREATE POLICY "Authenticated users read allowed realtime topics"
ON realtime.messages FOR SELECT TO authenticated
USING (
  CASE
    WHEN realtime.topic() LIKE 'admin:%' THEN public.has_role(auth.uid(), 'admin')
    ELSE true
  END
);

DROP POLICY IF EXISTS "Authenticated users write allowed realtime topics" ON realtime.messages;
CREATE POLICY "Authenticated users write allowed realtime topics"
ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  CASE
    WHEN realtime.topic() LIKE 'admin:%' THEN public.has_role(auth.uid(), 'admin')
    ELSE true
  END
);

-- Trigger-only function must not be callable through the API
REVOKE ALL ON FUNCTION public.validate_sale_integrity() FROM authenticated, anon, public;