import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmProvider";
import { useStore } from "@/context/StoreContext";

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
  products: { name: string; brand: string; flavor: string } | null;
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

export function usePendingOrders(options?: { storefront?: boolean }) {
  const storefront = options?.storefront === true;
  const { refreshSales } = useStore();
  const confirm = useConfirm();

  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [processingOrder, setProcessingOrder] = useState<string | null>(null);

  // silent = atualização em segundo plano: não pisca o "Carregando..." nem avisa erro de rede.
  const fetchPendingOrders = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoadingOrders(true);
    // Carimba como 'expirada' o que passou das 24h antes de listar, senão
    // pedido morto continuaria aqui pedindo uma decisão que não existe mais.
    // O estoque dele já voltou ao catálogo sozinho (o cálculo do `available`
    // ignora reserva vencida), então isto é só a limpeza da lista — se falhar,
    // nada trava: no máximo um card a mais aparece até a próxima passagem.
    await supabase.rpc("expire_stale_orders");
    const { data, error } = await supabase
      .from("orders")
      .select("*, customers(name, whatsapp), sellers(name), order_items(*, products(name, brand, flavor))")
      .eq("status", "pendente")
      .order("created_at", { ascending: false });
    if (error) {
      if (!silent) toast({ title: "Erro ao carregar pedidos", description: error.message, variant: "destructive" });
    } else {
      setPendingOrders((data as Order[]) ?? []);
    }
    if (!silent) setLoadingOrders(false);
  }, []);

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
  const confirmOrder = async (orderId: string, method: PaymentMethodValue, notes?: string) => {
    if (processingOrder) return;
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
      const paid = ORDER_PAYMENT_CHOICES.find(c => c.id === method)?.paid;
      toast({
        title: "Pedido confirmado",
        description: paid
          ? "Estoque atualizado e venda registrada como recebida."
          : "Estoque atualizado. A venda entrou como falta receber.",
      });
    } catch (err: any) {
      const raw = String(err?.message ?? "");
      // Pedido vencido é o caso mais provável de dar erro aqui, e a mensagem
      // crua do Postgres não diz nada para quem está com o celular na mão.
      const description = raw.includes("pedido_expirado")
        ? "Este pedido passou das 24h e a reserva já foi liberada. Peça ao cliente para refazer no catálogo."
        : raw.includes("pedido_ja_processado")
          ? "Este pedido já tinha sido confirmado ou recusado."
          : raw.includes("estoque")
            ? "Não há mais estoque suficiente para este pedido."
            : raw || "Tente novamente.";
      toast({ title: "Erro ao confirmar", description, variant: "destructive" });
      fetchPendingOrders({ silent: true });
    } finally {
      setProcessingOrder(null);
    }
  };

  const declineOrder = async (orderId: string) => {
    const ok = await confirm({
      title: "Recusar pedido",
      description: "Tem certeza? Essa ação não pode ser desfeita e o pedido será cancelado.",
      confirmText: "Recusar",
      cancelText: "Voltar",
      storefront,
    });
    if (!ok) return;
    if (processingOrder) return;
    setProcessingOrder(orderId);
    try {
      const { error } = await supabase.rpc("decline_order", { p_order_id: orderId });
      if (error) throw error;
      setPendingOrders(prev => prev.filter(o => o.id !== orderId));
      toast({ title: "Pedido recusado", description: "O pedido foi cancelado com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro ao recusar", description: err?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setProcessingOrder(null);
    }
  };

  return {
    pendingOrders,
    loadingOrders,
    processingOrder,
    fetchPendingOrders,
    confirmOrder,
    declineOrder,
  };
}
