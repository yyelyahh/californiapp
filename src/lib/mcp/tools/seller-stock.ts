import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "seller_stock",
  title: "Estoque com vendedores",
  description:
    "Mostra quanto de cada produto está atribuído a cada vendedor (consignação), opcionalmente filtrado por vendedor.",
  inputSchema: {
    seller_name: z.string().optional().describe("Filtra por nome do vendedor (busca parcial)."),
    limit: z.number().int().optional().describe("Máximo de linhas (padrão 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ seller_name, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("product_assignments")
      .select("quantity, sellers(name), products(brand, model, flavor, sale_price)")
      .gt("quantity", 0)
      .limit(Math.min(Math.max(limit ?? 200, 1), 500));

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const needle = seller_name?.trim().toLowerCase();
    const rows = (data ?? []).filter((r) =>
      needle ? (r.sellers?.name ?? "").toLowerCase().includes(needle) : true,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { count: rows.length, assignments: rows },
    };
  },
});
