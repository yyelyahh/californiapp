-- Adicionar tipo de registro na tabela sales
ALTER TABLE public.sales 
ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'venda';

-- Adicionar coluna para % de abatimento por vendedor
ALTER TABLE public.sellers
ADD COLUMN IF NOT EXISTS debt_percentage numeric NOT NULL DEFAULT 10;

-- Tabela de pagamentos/abatimentos das retiradas (registra automaticamente a cada venda)
CREATE TABLE IF NOT EXISTS public.seller_debt_payments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL,
  sale_id uuid,
  amount numeric NOT NULL DEFAULT 0,
  date timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_debt_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on seller_debt_payments"
ON public.seller_debt_payments
FOR ALL
USING (true)
WITH CHECK (true);