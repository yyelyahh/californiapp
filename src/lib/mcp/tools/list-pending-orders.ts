import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_pending_orders",
  title: "Pedidos pendentes",
  description:
    "Lista os pedidos feitos pelo catálogo que ainda aguardam confirmação, com cliente, vendedor, valor e itens.",
  inputSchema: {
    limit: z.number().int().optional().describe("Máximo de pedidos (padrão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, status, total_amount, freight_notes, created_at, customers(name, whatsapp), sellers(name), order_items(quantity, unit_price, products(brand, model, flavor))",
      )
      .eq("status", "pendente")
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit ?? 20, 1), 100));

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const orders = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(orders) }],
      structuredContent: { count: orders.length, orders },
    };
  },
});
