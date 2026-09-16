-- ============================================================
-- Link curto da loja: /loja/ivoti no lugar de /loja/<uuid>
-- ------------------------------------------------------------
-- O link da loja é o produto: ele vai colado numa mensagem de WhatsApp, e
-- trinta e seis caracteres de uuid ocupam duas linhas no celular sem dizer nada
-- a ninguém. `sellers.slug` é o apelido daquela loja no endereço.
--
-- A ROTA NÃO MUDA. `/loja/:sellerId` passa a aceitar as duas formas, e o uuid
-- continua valendo para sempre: link já enviado não pode parar de funcionar,
-- e ninguém tem como avisar quem guardou o antigo. Por isso o slug é
-- OPCIONAL — vendedor sem slug continua com o link de hoje, inteiro.
--
-- O SLUG NÃO PODE PARECER UM UUID, senão a tela não teria como saber qual dos
-- dois caminhos seguir. O gatilho recusa, e recusa também o que não couber em
-- [a-z0-9-]: acento e espaço viram problema de quem digita o endereço, não de
-- quem o escreveu.
--
-- QUEM RESOLVE É UMA FUNCTION, e não uma leitura da tabela: `sellers` não é
-- alcançável por anon (a loja inteira funciona por SECURITY DEFINER), e abrir a
-- tabela para achar um slug exporia nome, dívida e filial de todo vendedor para
-- a internet. `get_seller_by_slug` devolve UM uuid e nada mais.
-- ============================================================

ALTER TABLE public.sellers ADD COLUMN IF NOT EXISTS slug text;

COMMENT ON COLUMN public.sellers.slug IS
  'Apelido da loja no endereço (/loja/<slug>). Opcional: sem ele, o link é o uuid.';

-- Guardado já normalizado pelo gatilho, então o índice simples basta — e o
-- parcial deixa vários vendedores sem slug conviverem (NULL não colide).
CREATE UNIQUE INDEX IF NOT EXISTS sellers_slug_key
  ON public.sellers (slug) WHERE slug IS NOT NULL;


-- ------------------------------------------------------------
-- A regra do apelido
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_slug_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $seller_slug_guard$
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    -- Vazio é "sem apelido", não string vazia: string vazia colidiria com a
    -- próxima string vazia no índice único.
    NEW.slug := NULL;
    RETURN NEW;
  END IF;

  NEW.slug := lower(btrim(NEW.slug));
  -- Acento não sobrevive num endereço, e espaço vira %20: em vez de recusar o
  -- que a pessoa digitou, normaliza o que é óbvio.
  NEW.slug := translate(NEW.slug, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  NEW.slug := regexp_replace(NEW.slug, '[\s_]+', '-', 'g');
  NEW.slug := regexp_replace(NEW.slug, '-+', '-', 'g');
  NEW.slug := btrim(NEW.slug, '-');

  IF NEW.slug !~ '^[a-z0-9][a-z0-9-]{1,31}$' THEN
    RAISE EXCEPTION 'slug_invalido';
  END IF;

  -- A rota é uma só (`/loja/:sellerId`) e aceita as duas formas: um slug com
  -- cara de uuid deixaria a tela sem como decidir qual é qual.
  IF NEW.slug ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'slug_invalido';
  END IF;

  RETURN NEW;
END;
$seller_slug_guard$;

DROP TRIGGER IF EXISTS sellers_slug_guard ON public.sellers;
CREATE TRIGGER sellers_slug_guard
  BEFORE INSERT OR UPDATE OF slug ON public.sellers
  FOR EACH ROW EXECUTE FUNCTION public.seller_slug_guard();


-- ------------------------------------------------------------
-- Slug → vendedor
-- ------------------------------------------------------------
-- GRANT para anon porque quem abre a loja não está logado. Devolve só o id: é
-- o que a tela precisa para chamar `get_seller_catalog`, e é o mesmo dado que
-- já está no link antigo — nada de novo fica exposto.
CREATE OR REPLACE FUNCTION public.get_seller_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $get_seller_by_slug$
  SELECT s.id FROM public.sellers s
   WHERE s.slug = lower(btrim(p_slug))
   LIMIT 1;
$get_seller_by_slug$;

REVOKE ALL ON FUNCTION public.get_seller_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seller_by_slug(text) TO anon, authenticated;


-- ------------------------------------------------------------
-- Para dar apelido a quem já existe, pelo SQL Editor:
--
--   UPDATE public.sellers SET slug = 'ivoti'       WHERE name = 'Fulano';
--   UPDATE public.sellers SET slug = 'portoalegre' WHERE name = 'Beltrano';
--
-- O gatilho normaliza e recusa o que não serve; tirar o apelido é
-- `SET slug = NULL`, e o link de uuid volta a ser o único. Pelo painel, o campo
-- fica no painel do vendedor, na Distribuição.
-- ------------------------------------------------------------
