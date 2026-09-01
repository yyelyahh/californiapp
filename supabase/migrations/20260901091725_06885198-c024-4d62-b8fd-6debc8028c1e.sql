-- ============================================================
-- Corrige a causa raiz de "produtos sumiram": a coluna image_url
-- (criada em 20260826150000) nunca foi adicionada à lista de colunas
-- que o usuário autenticado tem permissão de ler em `products`. Como
-- essa permissão é por coluna (não pela tabela toda), pedir
-- image_url numa consulta faz o banco rejeitar a consulta inteira —
-- não só omitir a coluna. Isso fazia a tela de produtos parecer
-- vazia mesmo com os dados intactos no banco.
-- ============================================================

GRANT SELECT (image_url) ON public.products TO authenticated;