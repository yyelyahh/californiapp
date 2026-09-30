import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Order } from "@/hooks/usePendingOrders";
import { RESERVATION_HOURS } from "@/lib/seller-orders";

/** Quanto tempo depois de vencer o pedido ainda aparece para o vendedor avisar o cliente. */
export const EXPIRED_VISIBLE_HOURS = 72;

const storageKey = (sellerId: string) => `minhas-vendas:vencidos-vistos:${sellerId}`;

function readDismissed(sellerId: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(sellerId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(sellerId: string, ids: Set<string>) {
  try {
    // Só os mais recentes: a janela é de 72h, então a lista não precisa crescer.
    localStorage.setItem(storageKey(sellerId), JSON.stringify(Array.from(ids).slice(-200)));
  } catch {
    /* sem armazenamento (aba privada): o aviso volta na próxima visita, nada quebra */
  }
}

/**
 * Pedidos do vendedor que VENCERAM enquanto ele estava fora da tela.
 *
 * A lista de pedidos só lê `pendente`, e o aviso de "venceu" da tela nasce
 * comparando com o que ela já tinha visto — então o pedido que venceu com a
 * tela fechada simplesmente não existia para o vendedor, e o cliente que
 * esperou 24h nunca era avisado. Aqui ele volta, por 72h depois de vencer,
 * até o vendedor dispensar (o dispensado fica guardado no aparelho).
 *
 * É aviso, não conta: se a consulta falhar, a tela segue sem ele. A policy
 * "Sellers read own orders" já dá ao vendedor exatamente isto.
 */
export function useRecentExpiredOrders(sellerId: string | null | undefined) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => (sellerId ? readDismissed(sellerId) : new Set()));

  useEffect(() => {
    if (!sellerId) return;
    setDismissed(readDismissed(sellerId));
    let alive = true;
    (async () => {
      const since = new Date(Date.now() - (RESERVATION_HOURS + EXPIRED_VISIBLE_HOURS) * 3600_000).toISOString();
      const { data, error } = await supabase
        .from("orders")
        .select("*, customers(name, whatsapp), sellers(name), order_items(*, products(name, brand, model, flavor))")
        .eq("seller_id", sellerId)
        .eq("status", "expirada")
        .gte("created_at", since)
        .order("created_at", { ascending: true });
      if (!alive || error || !data) return;
      setOrders(data as Order[]);
    })();
    return () => {
      alive = false;
    };
  }, [sellerId]);

  const dismiss = useCallback(
    (orderId: string) => {
      if (!sellerId) return;
      setDismissed(prev => {
        const next = new Set(prev);
        next.add(orderId);
        writeDismissed(sellerId, next);
        return next;
      });
    },
    [sellerId],
  );

  return { expiredOrders: orders.filter(o => !dismissed.has(o.id)), dismissExpired: dismiss };
}
