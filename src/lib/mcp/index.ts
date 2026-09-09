import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listInventoryTool from "./tools/list-inventory";
import listPendingOrdersTool from "./tools/list-pending-orders";
import salesSummaryTool from "./tools/sales-summary";
import sellerStockTool from "./tools/seller-stock";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "california",
  title: "California",
  version: "0.1.0",
  instructions:
    "Ferramentas do California (gestão de estoque, vendas e consignação). Use `list_inventory` para consultar estoque e itens em falta, `seller_stock` para o que está com cada vendedor, `list_pending_orders` para pedidos do catálogo aguardando confirmação e `sales_summary` para totais de vendas em um período.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listInventoryTool, sellerStockTool, listPendingOrdersTool, salesSummaryTool],
});
