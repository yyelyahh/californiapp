californiapp — contexto do projeto

Mini-ERP de revenda (estoque, vendas, consignação com vendedores) que está sendo estendido com uma camada de e-commerce por vendedor (catálogo público + carrinho + checkout via WhatsApp + fidelidade).

Stack
Frontend: React + Vite + TypeScript + shadcn/ui + Tailwind. Lib de animação motion já instalada.
Backend: 100% Supabase (Postgres + Auth + RLS + Postgres functions). Não existe servidor próprio — o front fala direto com o banco via supabase-js, e regras de negócio críticas ficam em funções Postgres (SECURITY DEFINER), não só no cliente.
Editor principal do dono do projeto: Lovable (ele não programa diretamente; pede mudanças em linguagem natural e revisa o diff antes de aprovar). Ele tem acesso a VS Code também, mas prefere trocar em linguagem natural — ao propor mudanças, dê o trecho exato de código (antes/depois) e o caminho do arquivo, não só a ideia.
Migrations ficam em supabase/migrations/, aplicadas via Lovable ou direto no SQL Editor do Supabase.
Arquitetura de dados relevante
products: uma linha por sabor (não por modelo). Colunas: brand, model, flavor, sale_price, stock, purchase_price (oculto de authenticated via GRANT por coluna — cuidado ao adicionar coluna nova nessa tabela, ver Gotchas).
product_assignments: quanto de cada produto está atribuído a cada vendedor (consignação).
sales: ledger de vendas confirmadas. Nunca inserido direto pelo client — sempre via function create_sale (atômica).
orders / order_items: pedidos feitos pelo catálogo público (/loja/:sellerId). Status: pendente / confirmada / recusada. order_items.sale_id só é preenchido quando o pedido é confirmado (vira uma linha em sales de verdade). FK com ON DELETE SET NULL — se a venda for deletada depois, o vínculo cai sozinho.
customers: cadastro por WhatsApp (chave única, normalizado — só dígitos, sem formatação).
product_model_images: foto por marca+modelo (não por sabor) — todos os sabores do mesmo modelo compartilham a mesma foto.
Fluxo da loja pública (/loja/:sellerId)
Cliente abre o link do vendedor → pede WhatsApp primeiro (antes do catálogo) → busca fidelidade via get_customer_loyalty → se não achar, pede nome.
Catálogo agrupado por modelo (cards com foto/bloco de cor placeholder), popup/tela cheia com animação motion (layoutId) pra escolher sabor.
Adiciona ao carrinho → finaliza pedido → create_pending_order (reserva estoque virtualmente, sem debitar de verdade — só calcula assignment.quantity - reservas pendentes).
Cliente compartilha via wa.me/?text=... sem número (deixa o WhatsApp dele escolher o contato — decisão consciente de privacidade, não expor telefone do vendedor).
Vendedor (ou admin) vê o pedido na aba "Pedidos pendentes" da SalesPage → confirma (confirm_order, debita estoque de verdade via create_sale) ou recusa (decline_order, libera a reserva virtual).
Fidelidade
Conta unidades compradas (não pedidos), e só as que têm venda de verdade vinculada (order_items.sale_id IS NOT NULL — vendas manuais da SalesPage NÃO contam, só as do catálogo).
Brinde a cada 5 unidades (repete: 5, 10, 15...).
get_customer_loyalty(p_whatsapp) retorna: total_units, units_until_next_gift, gifts_earned, loyalty_tier.
Não existe ainda controle de quais brindes já foram entregues fisicamente (só o cálculo de quantos são "devidos").
Gotchas de Postgres já pegos (não repetir)
FOR UPDATE não pode ser usado junto com função de agregação (SUM, COUNT) na mesma query — dá erro de sintaxe. Padrão correto: travar as linhas numa subquery, agregar por fora dela.
Grant de coluna, não só RLS: products tem REVOKE SELECT ON products FROM authenticated seguido de GRANT SELECT (lista de colunas específicas). RLS sozinho não basta — se adicionar coluna nova numa tabela com esse padrão, sempre dar GRANT SELECT (nova_coluna) ON tabela TO authenticated na mesma migration, ou a consulta inteira falha silenciosamente (o client não trata erro em algumas queries, então parece "dado sumiu" quando na verdade é permissão faltando).
Ao mudar o formato de retorno de uma function existente (RETURNS TABLE(...) com colunas diferentes), CREATE OR REPLACE falha com cannot change return type. Precisa DROP FUNCTION nome(tipos_dos_parametros) antes de recriar.
O que falta (roadmap)
Upload de foto real (hoje é só colar link; sem Supabase Storage ainda).
Lembrar telefone do cliente entre visitas (localStorage, ainda não decidido).
Controle de resgate de brinde (marcar quando um brinde já foi entregue, não só calcular quantos são devidos).
Tela de listagem de clientes (dado já existe em customers, falta a UI).
Checkout com pagamento direto (Stripe) — adiado conscientemente, fluxo atual é WhatsApp + confirmação manual.
