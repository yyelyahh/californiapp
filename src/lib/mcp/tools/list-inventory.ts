import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_inventory",
  title: "Consultar estoque",
  description:
    "Lista o estoque da casa (marca, modelo, sabor, preço de venda e quantidade), com filtros opcionais por marca/modelo/sabor e por estoque baixo.",
  inputSchema: {
    brand: z.string().optional().describe("Filtra pela marca (busca parcial)."),
    model: z.string().optional().describe("Filtra pelo modelo (busca parcial)."),
    flavor: z.string().optional().describe("Filtra pelo sabor (busca parcial)."),
    only_low_stock: z
      .boolean()
      .optional()
      .describe("Se verdadeiro, retorna apenas itens com estoque igual ou abaixo do mínimo."),
    limit: z.number().int().optional().describe("Máximo de linhas (padrão 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ brand, model, flavor, only_low_stock, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("products")
      .select("id, brand, model, flavor, sale_price, stock, min_stock")
      .order("brand")
      .order("model")
      .order("flavor")
      .limit(Math.min(Math.max(limit ?? 100, 1), 500));

    if (brand) query = query.ilike("brand", `%${brand}%`);
    if (model) query = query.ilike("model", `%${model}%`);
    if (flavor) query = query.ilike("flavor", `%${flavor}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = (data ?? []).filter((r) => (only_low_stock ? r.stock <= r.min_stock : true));
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
      structuredContent: { count: rows.length, products: rows },
    };
  },
});
