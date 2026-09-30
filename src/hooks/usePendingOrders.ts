import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmProvider";
import { useStore } from "@/context/StoreContext";
import { useBranch } from "@/context/BranchContext";
import { formatCurrency } from "@/lib/currency";

/**
 * Pedidos do catálogo esperando decisão.
 *
 * Vive num hook porque as DUAS telas que decidem sobre pedido usam a mesma
 * máquina: a SalesPage do admin (tabela `PendingOrdersList`) e a
 * SellerSalesPage do vendedor (cards). Antes isso morava dentro da SalesPage e
 * o vendedor só alcançava porque estava no mesmo arquivo; quando a visão dele
 * saiu de lá, duplicar o fetch/confirm/decline abriria espaço para as duas
 * portas divergirem — exatamente o que não pode acontecer com venda.
 */

export type PaymentMethodValue =
  | "pix"
  | "dinheiro"
  | "pix_pendente"
  | "dinheiro_pendente"
  | "dinheiro_com_vendedor"
  | "pendente";

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  created_at: string;
  products: { name: string; brand: string; model: string | null; flavor: string } | null;
};

export type Order = {
  id: string;
  customer_id: string;
  seller_id: string;
  status: string;
  freight_notes?: string;
  total_amount: number;
  created_at: string;
  confirmed_at?: string;
  customers: { name: string; whatsapp: string } | null;
  sellers: { name: string } | null;
  order_items: OrderItem[];
};

/**
 * As formas de pagamento oferecidas ao confirmar um pedido do catálogo.
 *
 * É o mesmo vocabulário do formulário de venda manual, e a divisão entre
 * recebido e a receber é a mesma regra: método "pago" grava a venda quitada,
 * método "pendente" grava com zero recebido e ela cai nos filtros de cobrança.
 * O valor pago não é digitado aqui de propósito — pedido de catálogo é sempre
 * o total ou nada, e um campo livre só abriria espaço para divergir do total
 * que o cliente já viu no comprovante.
 */
export const ORDER_PAYMENT_CHOICES: { id: PaymentMethodValue; label: string; paid: boolean }[] = [
  { id: "pix", label: "Pix", paid: true },
  { id: "dinheiro", label: "Dinheiro", paid: true },
  { id: "pix_pendente", label: "Falta receber Pix", paid: false },
  { id: "dinheiro_pendente", label: "Falta receber Dinheiro", paid: false },
  { id: "dinheiro_com_vendedor", label: "Dinheiro com o vendedor", paid: false },
  { id: "pendente", label: "Falta receber (a definir)", paid: false },
];

/**
 * `storefront`: a tela do vendedor usa o tema da loja, e o diálogo de
 * confirmação é portado para fora da árvore dela pelo Radix — sem este aviso
 * ele sai pintado com o Nocturne do ERP no meio da loja. O hook é o mesmo nas
 * duas telas, então quem sabe o tema é quem chama.
 */
/**
 * Teto da observação de confirmação. Espelha o `left(..., 80)` do
 * `confirm_order`: cortar só no banco deixaria a pessoa digitar 200
 * caracteres e descobrir depois, na listagem, que metade sumiu.
 */
export const ORDER_NOTE_MAX = 80;

/** O desfecho de confirmar/recusar, para a tela que mostra o resultado no próprio card. */
export type OrderActionResult =
  | { ok: true }
  /** `expired`: o banco recusou por `pedido_expirado` — a tela troca o card pelo aviso de vencido. */
  | { ok: false; message: string; expired?: boolean }
  | { ok: false; cancelled: true };

/**
 * Erro de pedido em frase de gente. Lista de PERMISSÃO (src/pages/CLAUDE.md
 * §10): o que não está aqui vira a frase genérica, nunca o texto cru do banco.
 *
 * O `create_sale` avisa estoque como `estoque_insuficiente:<qtd>` /
 * `estoque_vendedor_insuficiente:<qtd>` — o número depois dos dois-pontos é a
 * QUANTIDADE que sobrou, não o produto, então a mensagem não tem como dizer
 * qual sabor faltou sem inventar.
 */
/** A mensagem de um erro qualquer: o do Supabase não é `Error`, é um objeto com `message`. */
const errorText = (err: unknown) => String((err as { message?: unknown } | null)?.message ?? "");

export function orderActionError(raw: string): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "Você está sem internet. Reconecte e tente de novo.";
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError")) return "A conexão caiu no meio. Tente de novo.";
  if (raw.includes("pedido_expirado"))
    return "Este pedido passou das 24h e a reserva já foi liberada. Peça ao cliente para refazer no catálogo.";
  if (raw.includes("pedido_ja_processado")) return "Este pedido já tinha sido confirmado ou recusado.";
  if (raw.includes("estoque_vendedor_insuficiente"))
    return "Um dos sabores deste pedido não tem mais unidades suficientes com você. Confira no Estoque.";
  if (raw.includes("estoque_insuficiente")) return "Não há mais estoque suficiente para este pedido na cidade.";
  if (raw.includes("nao_autorizado")) return "Este pedido não é da sua loja.";
  return "Não deu certo. Tente de novo.";
}

export function usePendingOrders(options?: { storefront?: boolean }) {
  const storefront = options?.storefront === true;
  const { refreshSales, sellers } = useStore();
  const { branchId } = useBranch();
  const confirm = useConfirm();

  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  // Erro da CARGA (não de ação). A loja mostra no lugar da lista, com "Tentar
  // de novo" (§8); o ERP segue com o toast.
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [processingOrder, setProcessingOrder] = useState<string | null>(null);

  // silent = atualização em segundo plano: não pisca o "Carregando..." nem avisa erro de rede.
  const fetchPendingOrders = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoadingOrders(true);
    try {
      // Carimba como 'expirada' o que passou das 24h antes de listar, senão
      // pedido morto continuaria aqui pedindo uma decisão que não existe mais.
      // O estoque dele já voltou ao catálogo sozinho (o cálculo do `available`
      // ignora reserva vencida), então isto é só a limpeza da lista — se falhar,
      // nada trava: no máximo um card a mais aparece até a próxima passagem.
      await supabase.rpc("expire_stale_orders");
      const { data, error } = await supabase
        .from("orders")
        .select("*, customers(name, whatsapp), sellers(name), order_items(*, products(name, brand, model, flavor))")
        .eq("status", "pendente")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPendingOrders((data as Order[]) ?? []);
      setOrdersError(null);
    } catch (err: unknown) {
      if (!silent) {
        if (storefront) {
          setOrdersError(
            navigator.onLine
              ? "Não deu para carregar os pedidos."
              : "Você está sem internet. Reconecte e tente de novo.",
          );
        }
        else toast({ title: "Erro ao carregar pedidos", description: errorText(err), variant: "destructive" });
      }
    } finally {
      if (!silent) setLoadingOrders(false);
    }
  }, [storefront]);

  useEffect(() => {
    fetchPendingOrders();
  }, [fetchPendingOrders]);

  // Pedido novo precisa aparecer sem recarregar a página: recarrega ao voltar
  // para a aba e a cada minuto enquanto ela está visível.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") fetchPendingOrders({ silent: true });
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    const timer = window.setInterval(refreshIfVisible, 60000);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
      window.clearInterval(timer);
    };
  }, [fetchPendingOrders]);

  /**
   * `notes` é o acerto que não cabe no vocabulário fechado de forma de
   * pagamento: "dia 20", "fiado", "pagou metade". Texto livre, não mexe em
   * valor nenhum — quem deriva o valor pago continua sendo o método. O banco
   * corta em 80 caracteres e grava a observação ANTES da referência do pedido
   * em `sales.notes`, senão a coluna da SalesPage (140px) só mostraria o
   * "Pedido via catálogo #<uuid>".
   */
  /**
   * Na loja (`storefront`) o resultado volta para a tela, que o mostra no
   * próprio card; o toast é do ERP e sai com o tema dele por cima do cabeçalho
   * da loja. No ERP segue o toast de sempre.
   */
  const confirmOrder = async (
    orderId: string,
    method: PaymentMethodValue,
    notes?: string,
  ): Promise<OrderActionResult> => {
    if (processingOrder) return { ok: false, message: "Espere o pedido anterior terminar." };
    setProcessingOrder(orderId);
    try {
      const trimmed = notes?.trim();
      const { error } = await supabase.rpc("confirm_order", {
        p_order_id: orderId,
        p_payment_method: method,
        p_notes: trimmed || undefined,
      });
      if (error) throw error;
      setPendingOrders(prev => prev.filter(o => o.id !== orderId));
      await refreshSales();
      if (!storefront) {
        const paid = ORDER_PAYMENT_CHOICES.find(c => c.id === method)?.paid;
        toast({
          title: "Pedido confirmado",
          description: paid
            ? "Estoque atualizado e venda registrada como recebida."
            : "Estoque atualizado. A venda entrou como falta receber.",
        });
      }
      return { ok: true };
    } catch (err: unknown) {
      const raw = errorText(err);
      const message = orderActionError(raw);
      if (!storefront) toast({ title: "Erro ao confirmar", description: message, variant: "destructive" });
      fetchPendingOrders({ silent: true });
      return { ok: false, message, expired: raw.includes("pedido_expirado") };
    } finally {
      setProcessingOrder(null);
    }
  };

  const declineOrder = async (orderId: string): Promise<OrderActionResult> => {
    // O diálogo diz DE QUEM é o pedido: com dois cards parecidos na tela, "Tem
    // certeza?" não diz qual dos dois vai sumir.
    const order = pendingOrders.find(o => o.id === orderId);
    const who = order?.customers?.name?.trim();
    const amount = order ? formatCurrency(order.total_amount) : null;
    const ok = await confirm({
      title: who ? `Recusar o pedido de ${who}?` : "Recusar pedido?",
      description: [
        amount ? `${amount}. ` : "",
        "A reserva volta para o catálogo e não dá para desfazer. O cliente não é avisado sozinho: combine com ele pelo WhatsApp.",
      ].join(""),
      confirmText: "Recusar",
      cancelText: "Voltar",
      storefront,
    });
    if (!ok) return { ok: false, cancelled: true };
    if (processingOrder) return { ok: false, message: "Espere o pedido anterior terminar." };
    setProcessingOrder(orderId);
    try {
      const { error } = await supabase.rpc("decline_order", { p_order_id: orderId });
      if (error) throw error;
      setPendingOrders(prev => prev.filter(o => o.id !== orderId));
      if (!storefront) toast({ title: "Pedido recusado", description: "O pedido foi cancelado com sucesso." });
      return { ok: true };
    } catch (err: unknown) {
      const message = orderActionError(errorText(err));
      if (!storefront) toast({ title: "Erro ao recusar", description: message, variant: "destructive" });
      return { ok: false, message };
    } finally {
      setProcessingOrder(null);
    }
  };

  /**
   * `orders` não tem `branch_id`: a cidade dela vem do vendedor, como em toda
   * tabela de vendedor. A RLS já corta pelo que a pessoa ALCANÇA; o recorte
   * pela filial ATIVA é feito aqui, contra a lista de `sellers` do contexto —
   * que já chega filtrada pela cidade.
   *
   * Em "Todas" (branchId nulo) não há recorte: a lista mostra os pedidos das
   * duas cidades, e o card já diz de quem é cada um.
   */
  const branchSellerIds = useMemo(() => new Set(sellers.map(s => s.id)), [sellers]);
  const visibleOrders = useMemo(
    () => (branchId ? pendingOrders.filter(o => branchSellerIds.has(o.seller_id)) : pendingOrders),
    [branchId, branchSellerIds, pendingOrders],
  );

  return {
    pendingOrders: visibleOrders,
    loadingOrders,
    ordersError,
    processingOrder,
    fetchPendingOrders,
    confirmOrder,
    declineOrder,
  };
}
