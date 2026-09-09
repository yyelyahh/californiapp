import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "sales_summary",
  title: "Resumo de vendas",
  description:
    "Resumo das vendas em um período: quantidade de vendas, unidades, receita total, valor já recebido e valor em aberto.",
  inputSchema: {
    start_date: z.string().describe("Data inicial no formato AAAA-MM-DD."),
    end_date: z.string().describe("Data final no formato AAAA-MM-DD (inclusiva)."),
    seller_name: z.string().optional().describe("Filtra por nome do vendedor (busca parcial)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ start_date, end_date, seller_name }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);

    let sellerIds: string[] | null = null;
    if (seller_name) {
      const { data: sellers, error: sellersError } = await supabase
        .from("sellers")
        .select("id")
        .ilike("name", `%${seller_name}%`);
      if (sellersError) {
        return { content: [{ type: "text", text: sellersError.message }], isError: true };
      }
      sellerIds = (sellers ?? []).map((s) => s.id);
      if (sellerIds.length === 0) {
        return {
          content: [{ type: "text", text: "Nenhum vendedor encontrado com esse nome." }],
          isError: true,
        };
      }
    }

    let query = supabase
      .from("sales")
      .select("quantity, total_price, paid_amount, type")
      .gte("date", start_date)
      .lte("date", end_date);
    if (sellerIds) query = query.in("seller_id", sellerIds);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const rows = data ?? [];
    const summary = rows.reduce(
      (acc, r) => {
        acc.sales += 1;
        acc.units += r.quantity;
        acc.revenue += Number(r.total_price);
        acc.received += Number(r.paid_amount);
        return acc;
      },
      { sales: 0, units: 0, revenue: 0, received: 0 },
    );
    const result = {
      period: { start_date, end_date },
      seller_name: seller_name ?? null,
      ...summary,
      outstanding: Number((summary.revenue - summary.received).toFixed(2)),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
});
