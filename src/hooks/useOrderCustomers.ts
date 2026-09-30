import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OrderCustomer = { name: string; whatsapp: string };

/**
 * Nome e WhatsApp do cliente de pedidos JÁ confirmados — a venda não guarda o
 * cliente, só a referência do pedido na nota. Serve à lista "A receber" do
 * vendedor, onde "Lucas · R$ 90" se reconhece e "#3F9A1C22" não.
 *
 * É enfeite, não conta: se falhar, a linha fica com a referência e nada trava
 * (por isso não há estado de erro). As policies "Sellers read own orders" e
 * "Sellers read own customers" já dão ao vendedor exatamente isto.
 */
export function useOrderCustomers(orderIds: string[]) {
  // Chave estável: a lista é recalculada a cada render da página.
  const key = useMemo(() => Array.from(new Set(orderIds)).sort().join(","), [orderIds]);
  // `null` = já perguntado e sem cliente: não pergunta de novo a cada render.
  const [byOrder, setByOrder] = useState<Record<string, OrderCustomer | null>>({});

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const missing = ids.filter(id => !(id in byOrder));
    if (missing.length === 0) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, customers(name, whatsapp)")
        .in("id", missing);
      if (!alive || error || !data) return;
      setByOrder(prev => {
        const next = { ...prev };
        for (const id of missing) next[id] = null;
        for (const row of data as { id: string; customers: OrderCustomer | null }[]) {
          next[row.id] = row.customers ?? null;
        }
        return next;
      });
    })();
    return () => {
      alive = false;
    };
    // `byOrder` fora de propósito: ele muda com a própria resposta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return byOrder;
}
