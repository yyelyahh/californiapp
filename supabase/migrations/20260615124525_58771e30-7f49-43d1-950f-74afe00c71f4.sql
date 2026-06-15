
-- 1) Add monthly_pro_labore to partners
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS monthly_pro_labore numeric NOT NULL DEFAULT 0;

-- 2) commission_payments
CREATE TABLE public.commission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_payments TO authenticated;
GRANT ALL ON public.commission_payments TO service_role;
ALTER TABLE public.commission_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage commission payments"
ON public.commission_payments FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Sellers view own commission payments"
ON public.commission_payments FOR SELECT TO authenticated
USING (seller_id = public.get_my_seller_id());

-- 3) pro_labore_payments
CREATE TABLE public.pro_labore_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pro_labore_payments TO authenticated;
GRANT ALL ON public.pro_labore_payments TO service_role;
ALTER TABLE public.pro_labore_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pro labore"
ON public.pro_labore_payments FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
