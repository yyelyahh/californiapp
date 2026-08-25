import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { PurchaseOrder, PurchaseOrderItem, PurchaseReceiptItemInput, Product, StockEntry, Sale, Expense, Investor, Dividend, Partner, PartnerPayment, Seller, ProductAssignment, SellerDebtPayment, SellerManualDebt, StockLoss, CommissionPayment, ProLaborePayment, PartnerContribution, Loan, LoanPayment, FinancialEvent, FinancialEventKind } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { localDateToISO } from "@/lib/date-utils";

// Columns readable by every authenticated user (purchase_price is admin-only via RPC)
const PRODUCT_COLS = "id,name,brand,model,flavor,sale_price,stock,min_stock,created_at";

interface StoreContextType {
  products: Product[];
  stockEntries: StockEntry[];
  sales: Sale[];
  expenses: Expense[];
  investors: Investor[];
  dividends: Dividend[];
  partners: Partner[];
  sellers: Seller[];
  productAssignments: ProductAssignment[];
  sellerDebtPayments: SellerDebtPayment[];
  partnerPayments: PartnerPayment[];
  purchaseOrders: PurchaseOrder[];
  addPurchaseOrder: (o: { date: string; notes?: string; freightCost?: number; items: { brand: string; model: string; expectedQuantity: number; unitPrice?: number }[] }) => Promise<void>;
  deletePurchaseOrder: (id: string) => Promise<void>;
  receivePurchaseOrder: (id: string, items: PurchaseReceiptItemInput[], date: string) => Promise<boolean>;
  loading: boolean;
  addProduct: (p: Omit<Product, "id" | "createdAt" | "stock">) => Promise<void>;
  updateProduct: (id: string, p: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addStockEntry: (e: Omit<StockEntry, "id" | "totalCost">) => Promise<void>;
  deleteStockEntry: (id: string) => Promise<void>;
  stockLosses: StockLoss[];
  addStockLoss: (l: Omit<StockLoss, "id" | "totalCost" | "unitCost"> & { unitCost?: number }) => Promise<void>;
  deleteStockLoss: (id: string) => Promise<void>;
  getTotalLossValue: () => number;
  addSale: (s: Omit<Sale, "id" | "totalPrice">) => Promise<void>;
  updateSale: (id: string, updates: Partial<Sale>) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
  addExpense: (e: Omit<Expense, "id">) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addInvestor: (i: Omit<Investor, "id" | "createdAt" | "totalReturn">) => Promise<void>;
  updateInvestor: (id: string, i: Partial<Investor>) => Promise<void>;
  deleteInvestor: (id: string) => Promise<void>;
  addDividend: (d: Omit<Dividend, "id">) => Promise<void>;
  deleteDividend: (id: string) => Promise<void>;
  addPartner: (p: Omit<Partner, "id" | "createdAt">) => Promise<void>;
  updatePartner: (id: string, p: Partial<Partner>) => Promise<void>;
  deletePartner: (id: string) => Promise<void>;
  addPartnerPayment: (p: Omit<PartnerPayment, "id">) => Promise<void>;
  deletePartnerPayment: (id: string) => Promise<void>;
  getPartnerPaidForMonth: (partnerId: string, month: string) => number;
  addSeller: (s: Omit<Seller, "id" | "createdAt">) => Promise<void>;
  updateSeller: (id: string, s: Partial<Seller>) => Promise<void>;
  deleteSeller: (id: string) => Promise<void>;
  addProductAssignment: (a: Omit<ProductAssignment, "id" | "createdAt">) => Promise<void>;
  deleteProductAssignment: (id: string) => Promise<void>;
  transferProductAssignment: (assignmentId: string, toSellerId: string, quantity: number) => Promise<void>;
  addSellerDebtPayment: (p: Omit<SellerDebtPayment, "id">) => Promise<void>;
  deleteSellerDebtPayment: (id: string) => Promise<void>;
  sellerManualDebts: SellerManualDebt[];
  addSellerManualDebt: (d: Omit<SellerManualDebt, "id">) => Promise<void>;
  deleteSellerManualDebt: (id: string) => Promise<void>;
  commissionPayments: CommissionPayment[];
  addCommissionPayment: (p: Omit<CommissionPayment, "id">) => Promise<void>;
  deleteCommissionPayment: (id: string) => Promise<void>;
  proLaborePayments: ProLaborePayment[];
  addProLaborePayment: (p: Omit<ProLaborePayment, "id">) => Promise<void>;
  deleteProLaborePayment: (id: string) => Promise<void>;
  getSellerName: (id: string) => string;
  getTotalRevenue: () => number;
  getTotalCosts: () => number;
  getTotalExpenses: () => number;
  getTotalInvested: () => number;
  getNetProfit: () => number;
  getTotalPartnerPayments: () => number;
  getProductName: (id: string) => string;
  getInvestorName: (id: string) => string;
  getPaidToInvestor: (id: string) => number;
  getRemainingForInvestor: (id: string) => number;
  getSellerDebt: (id: string) => number;
  getSellerPaid: (id: string) => number;
  getSellerBalance: (id: string) => number;
  // ---- Novo modelo financeiro ----
  partnerContributions: PartnerContribution[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  financialEvents: FinancialEvent[];
  addPartnerContribution: (c: Omit<PartnerContribution, "id" | "createdAt">) => Promise<void>;
  deletePartnerContribution: (id: string) => Promise<void>;
  addLoan: (l: Omit<Loan, "id" | "createdAt">) => Promise<void>;
  updateLoan: (id: string, l: Partial<Loan>) => Promise<void>;
  deleteLoan: (id: string) => Promise<void>;
  addLoanPayment: (p: Omit<LoanPayment, "id" | "createdAt">) => Promise<void>;
  deleteLoanPayment: (id: string) => Promise<void>;
  refreshFinancialEvents: () => Promise<void>;
  // Selectors do novo modelo (contabilidade simplificada)
  getCash: () => number;
  getInventoryCostValue: () => number;
  getReceivables: () => number;
  getPartnerCapital: () => number;
  getLoansOutstanding: () => number;
  getAccumulatedProfit: () => number;
  getDistributedProfit: () => number;
  getRetainedEarnings: () => number;
  getDistributableProfit: (pendingCommissions?: number) => number;
  getLoanPaid: (loanId: string) => number;
  getLoanRemaining: (loanId: string) => number;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [dividends, setDividends] = useState<Dividend[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [productAssignments, setProductAssignments] = useState<ProductAssignment[]>([]);
  const [sellerDebtPayments, setSellerDebtPayments] = useState<SellerDebtPayment[]>([]);
  const [partnerPayments, setPartnerPayments] = useState<PartnerPayment[]>([]);
  const [sellerManualDebts, setSellerManualDebts] = useState<SellerManualDebt[]>([]);
  const [stockLosses, setStockLosses] = useState<StockLoss[]>([]);
  const [commissionPayments, setCommissionPayments] = useState<CommissionPayment[]>([]);
  const [proLaborePayments, setProLaborePayments] = useState<ProLaborePayment[]>([]);
  const [partnerContributions, setPartnerContributions] = useState<PartnerContribution[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanPayments, setLoanPayments] = useState<LoanPayment[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [financialEvents, setFinancialEvents] = useState<FinancialEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const fetchProductsList = useCallback(async (): Promise<Product[]> => {
    const { data } = await supabase.from("products").select(PRODUCT_COLS).order("created_at", { ascending: true });
    if (!data) return [];
    let costs: Record<string, number> = {};
    if (isAdmin) {
      const { data: c } = await supabase.rpc("get_product_costs");
      if (c) costs = Object.fromEntries((c as any[]).map(r => [r.product_id, Number(r.purchase_price)]));
    }
    return data.map((r: any) => ({
      id: r.id, name: r.name, brand: r.brand, model: r.model || '', flavor: r.flavor,
      purchasePrice: costs[r.id] ?? 0, salePrice: Number(r.sale_price),
      stock: r.stock, minStock: Number(r.min_stock ?? 0), createdAt: r.created_at,
    }));
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;

    // Wave 1: dados essenciais para as telas de operação (produtos, vendas, estoque, vendedores).
    const fetchCore = async () => {
      const [prodList, stockRes, salesRes, selRes, paRes, slRes] = await Promise.all([
        fetchProductsList(),
        supabase.from("stock_entries").select("*").order("created_at", { ascending: true }),
        supabase.from("sales").select("*").order("created_at", { ascending: true }),
        supabase.from("sellers" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("product_assignments" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("stock_losses" as any).select("*").order("created_at", { ascending: true }),
      ]) as any;
      if (cancelled) return;
      setProducts(prodList);
      if (stockRes.data) setStockEntries(stockRes.data.map(mapStockEntry));
      if (salesRes.data) setSales(salesRes.data.map(mapSale));
      if (selRes.data) setSellers((selRes.data as any[]).map(mapSeller));
      if (paRes.data) setProductAssignments((paRes.data as any[]).map(mapProductAssignment));
      if (slRes?.data) setStockLosses((slRes.data as any[]).map(mapStockLoss));
    };

    // Wave 2: dados financeiros/administrativos, carregados logo em seguida sem travar a tela.
    const fetchSecondary = async () => {
      const [expRes, invRes, divRes, partRes, sdpRes, ppRes, smdRes, cpRes, plRes, pcRes, loanRes, lpRes, feRes, poRes] = await Promise.all([
        supabase.from("expenses").select("*").order("created_at", { ascending: true }),
        supabase.from("investors").select("*").order("created_at", { ascending: true }),
        supabase.from("dividends").select("*").order("created_at", { ascending: true }),
        supabase.from("partners").select("*").order("created_at", { ascending: true }),
        supabase.from("seller_debt_payments" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("partner_payments" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("seller_manual_debts" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("commission_payments" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("pro_labore_payments" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("partner_contributions" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("loans" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("loan_payments" as any).select("*").order("created_at", { ascending: true }),
        supabase.from("financial_events" as any).select("*").order("event_date", { ascending: true }),
        supabase.from("purchase_orders" as any).select("*, purchase_order_items(*)").order("created_at", { ascending: false }),
      ]) as any;
      if (cancelled) return;
      if (expRes.data) setExpenses(expRes.data.map(mapExpense));
      if (invRes.data) setInvestors(invRes.data.map(mapInvestor));
      if (divRes.data) setDividends(divRes.data.map(mapDividend));
      if (partRes.data) setPartners(partRes.data.map(mapPartner));
      if (sdpRes.data) setSellerDebtPayments((sdpRes.data as any[]).map(mapSellerDebtPayment));
      if (ppRes.data) setPartnerPayments((ppRes.data as any[]).map(mapPartnerPayment));
      if (smdRes.data) setSellerManualDebts((smdRes.data as any[]).map(mapSellerManualDebt));
      if (cpRes?.data) setCommissionPayments((cpRes.data as any[]).map(mapCommissionPayment));
      if (plRes?.data) setProLaborePayments((plRes.data as any[]).map(mapProLaborePayment));
      if (pcRes?.data) setPartnerContributions((pcRes.data as any[]).map(mapPartnerContribution));
      if (loanRes?.data) setLoans((loanRes.data as any[]).map(mapLoan));
      if (lpRes?.data) setLoanPayments((lpRes.data as any[]).map(mapLoanPayment));
      if (feRes?.data) setFinancialEvents((feRes.data as any[]).map(mapFinancialEvent));
      if (poRes?.data) setPurchaseOrders((poRes.data as any[]).map(mapPurchaseOrder));
    };

    const fetchAll = async () => {
      setLoading(true);
      try {
        await fetchCore();
      } catch (err) {
        console.error("Error fetching data:", err);
        toast.error("Erro ao carregar dados");
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        await fetchSecondary();
      } catch (err) {
        console.error("Error fetching financial data:", err);
      }
    };
    fetchAll();

    // ---- Realtime sync: any change in shared tables refreshes the affected slice ----
    let feTimer: ReturnType<typeof setTimeout> | null = null;
    const refetchFinancialEvents = () => {
      if (feTimer) clearTimeout(feTimer);
      feTimer = setTimeout(async () => {
        const { data } = await supabase.from("financial_events" as any).select("*").order("event_date", { ascending: true });
        if (data && !cancelled) setFinancialEvents((data as any[]).map(mapFinancialEvent));
      }, 400);
    };

    // Aplica a linha recebida no evento em vez de recarregar a tabela inteira.
    const patch = <T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      payload: any,
      mapper: (r: any) => T,
    ) => {
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row?.id) return;
      if (payload.eventType === "DELETE") {
        setter(prev => prev.filter(x => x.id !== row.id));
        return;
      }
      const mapped = mapper(row);
      setter(prev => (prev.some(x => x.id === mapped.id)
        ? prev.map(x => (x.id === mapped.id ? { ...x, ...mapped } : x))
        : [...prev, mapped]));
    };

    let channel = supabase
      .channel(isAdmin ? "admin:store-sync" : "store-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, async (payload: any) => {
        // Produtos precisam do custo (RPC de admin), então recarregamos a lista completa.
        if (payload.eventType === "DELETE") {
          setProducts(prev => prev.filter(p => p.id !== payload.old?.id));
        } else {
          const list = await fetchProductsList();
          if (!cancelled) setProducts(list);
        }
        refetchFinancialEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, (payload: any) => {
        patch(setSales, payload, mapSale);
        refetchFinancialEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_entries" }, (payload: any) => {
        patch(setStockEntries, payload, mapStockEntry);
        refetchFinancialEvents();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "product_assignments" }, (payload: any) => {
        patch(setProductAssignments, payload, mapProductAssignment);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sellers" }, (payload: any) => {
        patch(setSellers, payload, mapSeller);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_losses" }, (payload: any) => {
        patch(setStockLosses, payload, mapStockLoss);
        refetchFinancialEvents();
      });

    // Tabelas financeiras são restritas a administradores: só assinamos quando o usuário é admin.
    if (isAdmin) {
      channel = channel
        .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "commission_payments" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "pro_labore_payments" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "partner_contributions" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "loans" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "loan_payments" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "seller_manual_debts" }, refetchFinancialEvents)
        .on("postgres_changes", { event: "*", schema: "public", table: "seller_debt_payments" }, refetchFinancialEvents);
    }

    channel.subscribe();

    return () => {
      cancelled = true;
      if (feTimer) clearTimeout(feTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchProductsList, isAdmin]);



  const mapProduct = (r: any): Product => ({
    id: r.id, name: r.name, brand: r.brand, model: r.model || '', flavor: r.flavor,
    purchasePrice: Number(r.purchase_price ?? 0), salePrice: Number(r.sale_price),
    stock: r.stock, minStock: Number(r.min_stock ?? 0), createdAt: r.created_at,
  });

  const mapStockEntry = (r: any): StockEntry => ({
    id: r.id, productId: r.product_id, quantity: r.quantity,
    unitCost: Number(r.unit_cost), totalCost: Number(r.total_cost),
    date: r.date, notes: r.notes,
  });

  const mapSale = (r: any): Sale => ({
    id: r.id, productId: r.product_id, quantity: r.quantity,
    unitPrice: Number(r.unit_price), totalPrice: Number(r.total_price),
    date: r.date, notes: r.notes,
    installments: r.installments ?? 1, paidAmount: Number(r.paid_amount ?? 0),
    paidAt: r.paid_at || undefined,
    sellerId: r.seller_id || undefined,
    type: (r.type === "retirada_funcionario" ? "retirada_funcionario" : "venda"),
    paymentMethod: (["pix","dinheiro","pix_pendente","dinheiro_pendente","dinheiro_com_vendedor","pendente"].includes(r.payment_method)) ? r.payment_method : undefined,
  });

  const mapSeller = (r: any): Seller => ({
    id: r.id, name: r.name, createdAt: r.created_at,
    debtPercentage: r.debt_percentage != null ? Number(r.debt_percentage) : 10,
  });

  const mapProductAssignment = (r: any): ProductAssignment => ({
    id: r.id, sellerId: r.seller_id, productId: r.product_id,
    quantity: r.quantity, notes: r.notes, createdAt: r.created_at,
  });

  const mapSellerDebtPayment = (r: any): SellerDebtPayment => ({
    id: r.id, sellerId: r.seller_id, saleId: r.sale_id || undefined,
    amount: Number(r.amount), date: r.date, notes: r.notes,
  });

  const mapSellerManualDebt = (r: any): SellerManualDebt => ({
    id: r.id, sellerId: r.seller_id,
    amount: Number(r.amount), date: r.date, notes: r.notes,
  });

  const mapStockLoss = (r: any): StockLoss => ({
    id: r.id, productId: r.product_id, quantity: r.quantity,
    unitCost: Number(r.unit_cost), totalCost: Number(r.total_cost),
    reason: r.reason || undefined, date: r.date,
    sellerId: r.seller_id || undefined,
  });

  const mapExpense = (r: any): Expense => ({
    id: r.id, description: r.description, category: r.category,
    amount: Number(r.amount), date: r.date,
  });

  const mapInvestor = (r: any): Investor => ({
    id: r.id, name: r.name, investedAmount: Number(r.invested_amount),
    returnPercentage: Number(r.return_percentage), totalReturn: Number(r.total_return),
    createdAt: r.created_at,
  });

  const mapDividend = (r: any): Dividend => ({
    id: r.id, investorId: r.investor_id, amount: Number(r.amount),
    date: r.date, notes: r.notes,
  });

  const mapPartner = (r: any): Partner => ({
    id: r.id, name: r.name, percentage: Number(r.percentage),
    monthlyProLabore: Number(r.monthly_pro_labore ?? 0),
    createdAt: r.created_at,
  });

  const mapPartnerPayment = (r: any): PartnerPayment => ({
    id: r.id, partnerId: r.partner_id, month: r.month,
    amount: Number(r.amount), date: r.date, notes: r.notes,
  });

  const mapCommissionPayment = (r: any): CommissionPayment => ({
    id: r.id, sellerId: r.seller_id,
    amount: Number(r.amount), date: r.date, notes: r.notes,
  });

  const mapProLaborePayment = (r: any): ProLaborePayment => ({
    id: r.id, partnerId: r.partner_id,
    amount: Number(r.amount), date: r.date, notes: r.notes,
  });

  const mapPartnerContribution = (r: any): PartnerContribution => ({
    id: r.id, partnerId: r.partner_id, amount: Number(r.amount),
    date: r.date, notes: r.notes, createdAt: r.created_at,
  });

  const mapLoan = (r: any): Loan => ({
    id: r.id, lenderName: r.lender_name,
    principal: Number(r.principal), interestAmount: Number(r.interest_amount ?? 0),
    receivedDate: r.received_date, notes: r.notes, createdAt: r.created_at,
  });

  const mapLoanPayment = (r: any): LoanPayment => ({
    id: r.id, loanId: r.loan_id,
    principalAmount: Number(r.principal_amount ?? 0),
    interestAmount: Number(r.interest_amount ?? 0),
    date: r.date, notes: r.notes, createdAt: r.created_at,
  });

  const mapFinancialEvent = (r: any): FinancialEvent => ({
    id: r.id, kind: r.kind as FinancialEventKind,
    date: r.event_date, createdAt: r.created_at,
    description: r.description, amount: Number(r.amount),
    cashDelta: Number(r.cash_delta), inventoryDelta: Number(r.inventory_delta),
    receivableDelta: Number(r.receivable_delta), loanDelta: Number(r.loan_delta),
    partnerCapitalDelta: Number(r.partner_capital_delta),
    accumulatedProfitDelta: Number(r.accumulated_profit_delta),
    distributedProfitDelta: Number(r.distributed_profit_delta),
    refTable: r.ref_table, refId: r.ref_id, notes: r.notes ?? undefined,
  });

  const mapPurchaseOrder = (r: any): PurchaseOrder => ({
    id: r.id,
    number: Number(r.number),
    status: r.status === "received" ? "received" : "pending",
    date: r.date,
    notes: r.notes ?? undefined,
    paidAmount: Number(r.paid_amount ?? 0),
    freightCost: Number(r.freight_cost ?? 0),
    receivedAt: r.received_at ?? undefined,
    createdAt: r.created_at,
    items: ((r.purchase_order_items ?? []) as any[]).map((i): PurchaseOrderItem => ({
      id: i.id,
      purchaseOrderId: i.purchase_order_id,
      brand: i.brand ?? "",
      model: i.model ?? "",
      expectedQuantity: Number(i.expected_quantity ?? 0),
      unitPrice: Number(i.unit_price ?? 0),
      receivedFlavors: Array.isArray(i.received_flavors)
        ? (i.received_flavors as any[]).map(f => ({ flavor: String(f.flavor ?? ""), quantity: Number(f.quantity ?? 0) }))
        : [],
    })),
  });

  // ---- Compras aguardando recebimento ----
  const addPurchaseOrder = useCallback(async (o: { date: string; notes?: string; freightCost?: number; items: { brand: string; model: string; expectedQuantity: number; unitPrice?: number }[] }) => {
    const items = o.items.filter(i => i.brand.trim() && i.model.trim() && i.expectedQuantity > 0);
    if (items.length === 0) { toast.error("Informe ao menos um item com quantidade maior que zero"); return; }
    const { data, error } = await supabase.from("purchase_orders" as any).insert({
      date: o.date, notes: o.notes ?? null, status: "pending",
      paid_amount: items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.expectedQuantity, 0),
      freight_cost: o.freightCost ?? 0,
    } as any).select("*").single();
    if (error || !data) { toast.error("Erro ao criar compra"); return; }
    const orderId = (data as any).id;
    const { data: itemRows, error: itemErr } = await supabase.from("purchase_order_items" as any).insert(
      items.map(i => ({
        purchase_order_id: orderId, brand: i.brand.trim(), model: i.model.trim(),
        expected_quantity: i.expectedQuantity, unit_price: i.unitPrice ?? 0, received_flavors: [],
      })) as any,
    ).select("*");
    if (itemErr) {
      await supabase.from("purchase_orders" as any).delete().eq("id", orderId);
      toast.error("Erro ao salvar itens da compra");
      return;
    }
    setPurchaseOrders(prev => [mapPurchaseOrder({ ...(data as any), purchase_order_items: itemRows ?? [] }), ...prev]);
    toast.success("Compra registrada (aguardando recebimento)");
  }, []);

  const deletePurchaseOrder = useCallback(async (id: string) => {
    const { error } = await supabase.from("purchase_orders" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir compra"); return; }
    setPurchaseOrders(prev => prev.filter(o => o.id !== id));
    toast.success("Compra excluída");
  }, []);

  // Recebimento: só aqui o estoque é movimentado. A troca de status é atômica
  // (só ocorre se a compra ainda estiver "pending"), impedindo entrada duplicada.
  const receivePurchaseOrder = useCallback(async (id: string, receiptItems: PurchaseReceiptItemInput[], date: string): Promise<boolean> => {
    const order = purchaseOrders.find(o => o.id === id);
    if (!order) { toast.error("Compra não encontrada"); return false; }
    if (order.status === "received") { toast.error("Esta compra já foi recebida"); return false; }

    for (const item of order.items) {
      const input = receiptItems.find(r => r.itemId === item.id);
      const total = (input?.flavors ?? []).reduce((s, f) => s + (Number(f.quantity) || 0), 0);
      if ((input?.flavors ?? []).some(f => !f.flavor.trim() || Number(f.quantity) < 0)) {
        toast.error("Verifique os sabores e quantidades informados"); return false;
      }
      if (total !== item.expectedQuantity) {
        toast.error(`${item.brand} ${item.model}: recebido ${total} de ${item.expectedQuantity}`);
        return false;
      }
    }

    // Claim atômico do recebimento
    const { data: claimed, error: claimErr } = await supabase
      .from("purchase_orders" as any)
      .update({ status: "received", received_at: new Date().toISOString() } as any)
      .eq("id", id).eq("status", "pending").select("*");
    if (claimErr || !claimed || (claimed as any[]).length === 0) {
      toast.error("Esta compra já foi recebida");
      return false;
    }

    let productList = [...products];
    const newEntries: StockEntry[] = [];

    for (const item of order.items) {
      const input = receiptItems.find(r => r.itemId === item.id);
      if (!input) continue;
      const unitCost = Number(input.unitCost) || 0;
      for (const f of input.flavors) {
        const flavor = f.flavor.trim();
        const qty = Number(f.quantity) || 0;
        if (!flavor || qty <= 0) continue;
        let product = productList.find(p =>
          p.brand.toLowerCase() === item.brand.toLowerCase() &&
          (p.model || "").toLowerCase() === item.model.toLowerCase() &&
          p.flavor.toLowerCase() === flavor.toLowerCase());
        if (!product) {
          const reference = productList.find(p =>
            p.brand.toLowerCase() === item.brand.toLowerCase() &&
            (p.model || "").toLowerCase() === item.model.toLowerCase());
          const salePrice = input.salePrice ?? reference?.salePrice ?? 0;
          const { data: created, error: prodErr } = await supabase.from("products").insert({
            name: item.model, brand: item.brand, model: item.model, flavor,
            purchase_price: unitCost, sale_price: salePrice, stock: 0,
            min_stock: reference?.minStock ?? 0,
          }).select(PRODUCT_COLS).single();
          if (prodErr || !created) { toast.error(`Erro ao criar produto ${item.model} · ${flavor}`); continue; }
          product = mapProduct({ ...(created as any), purchase_price: unitCost });
          productList = [...productList, product];
        }
        const totalCost = qty * unitCost;
        const { data: entry, error: entryErr } = await supabase.from("stock_entries").insert({
          product_id: product.id, quantity: qty, unit_cost: unitCost, total_cost: totalCost,
          date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? localDateToISO(date) : date,
          notes: `Compra #${order.number}`,
        }).select().single();
        if (entryErr || !entry) { toast.error(`Erro ao registrar entrada de ${flavor}`); continue; }
        newEntries.push(mapStockEntry(entry));
        const newStock = product.stock + qty;
        await supabase.from("products").update({ stock: newStock, purchase_price: unitCost }).eq("id", product.id);
        const updated = { ...product, stock: newStock, purchasePrice: unitCost };
        productList = productList.map(p => p.id === product!.id ? updated : p);
      }
      await supabase.from("purchase_order_items" as any)
        .update({ received_flavors: input.flavors.filter(f => f.flavor.trim()) } as any)
        .eq("id", item.id);
    }

    setProducts(productList);
    setStockEntries(prev => [...prev, ...newEntries]);
    setPurchaseOrders(prev => prev.map(o => o.id === id
      ? {
          ...o, status: "received", receivedAt: new Date().toISOString(),
          items: o.items.map(it => ({
            ...it,
            receivedFlavors: (receiptItems.find(r => r.itemId === it.id)?.flavors ?? []).filter(f => f.flavor.trim()),
          })),
        }
      : o));
    toast.success(`Compra #${order.number} recebida e estoque atualizado`);
    return true;
  }, [purchaseOrders, products]);

  // ---- Products ----
  const addProduct = useCallback(async (p: Omit<Product, "id" | "createdAt" | "stock">) => {
    const { data, error } = await supabase.from("products").insert({
      name: p.name, brand: p.brand, model: p.model, flavor: p.flavor,
      purchase_price: p.purchasePrice, sale_price: p.salePrice, stock: 0,
      min_stock: p.minStock ?? 0,
    }).select(PRODUCT_COLS).single();
    if (error) { toast.error("Erro ao adicionar produto"); return; }
    setProducts(prev => [...prev, mapProduct({ ...data, purchase_price: p.purchasePrice })]);
  }, []);

  const updateProduct = useCallback(async (id: string, updates: Partial<Product>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.brand !== undefined) dbUpdates.brand = updates.brand;
    if (updates.flavor !== undefined) dbUpdates.flavor = updates.flavor;
    if (updates.model !== undefined) dbUpdates.model = updates.model;
    if (updates.purchasePrice !== undefined) dbUpdates.purchase_price = updates.purchasePrice;
    if (updates.salePrice !== undefined) dbUpdates.sale_price = updates.salePrice;
    if (updates.stock !== undefined) dbUpdates.stock = updates.stock;
    if (updates.minStock !== undefined) dbUpdates.min_stock = updates.minStock;
    const { error } = await supabase.from("products").update(dbUpdates).eq("id", id);
    if (error) { toast.error("Erro ao atualizar produto"); return; }
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProduct = useCallback(async (id: string) => {
    const product = products.find(p => p.id === id);
    if (product) {
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("deleted_products").insert({
        original_id: product.id,
        name: product.name,
        brand: product.brand,
        model: product.model,
        flavor: product.flavor,
        purchase_price: product.purchasePrice,
        sale_price: product.salePrice,
        stock: product.stock,
        original_created_at: product.createdAt,
        deleted_by: userData.user?.id ?? null,
      });
    }
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir produto"); return; }
    setProducts(prev => prev.filter(p => p.id !== id));
    toast.success("Produto excluído");
  }, [products]);

  // ---- Stock Entries ----
  const addStockEntry = useCallback(async (e: Omit<StockEntry, "id" | "totalCost">) => {
    const totalCost = e.quantity * e.unitCost;
    const { data, error } = await supabase.from("stock_entries").insert({
      product_id: e.productId, quantity: e.quantity,
      unit_cost: e.unitCost, total_cost: totalCost, date: e.date, notes: e.notes,
    }).select().single();
    if (error) { toast.error("Erro ao registrar entrada"); return; }
    setStockEntries(prev => [...prev, mapStockEntry(data)]);
    const product = products.find(p => p.id === e.productId);
    if (product) {
      await supabase.from("products").update({
        stock: product.stock + e.quantity, purchase_price: e.unitCost,
      }).eq("id", e.productId);
      setProducts(prev => prev.map(p => p.id === e.productId
        ? { ...p, stock: p.stock + e.quantity, purchasePrice: e.unitCost } : p));
    }
  }, [products]);

  const deleteStockEntry = useCallback(async (id: string) => {
    const entry = stockEntries.find(e => e.id === id);
    const { error } = await supabase.from("stock_entries").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir entrada"); return; }
    setStockEntries(prev => prev.filter(e => e.id !== id));
    if (entry) {
      const product = products.find(p => p.id === entry.productId);
      if (product) {
        const newStock = Math.max(0, product.stock - entry.quantity);
        await supabase.from("products").update({ stock: newStock }).eq("id", entry.productId);
        setProducts(prev => prev.map(p => p.id === entry.productId ? { ...p, stock: newStock } : p));
      }
    }
  }, [stockEntries, products]);

  // ---- Stock Losses ----
  const addStockLoss = useCallback(async (l: Omit<StockLoss, "id" | "totalCost" | "unitCost"> & { unitCost?: number }) => {
    const product = products.find(p => p.id === l.productId);
    if (!product) { toast.error("Produto não encontrado"); return; }
    if (product.stock < l.quantity) { toast.error("Quantidade maior que o estoque disponível"); return; }

    // Se a perda ocorreu com um vendedor, valida e baixa também da atribuição dele
    let sellerAssignmentRows: any[] = [];
    if (l.sellerId) {
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from("product_assignments")
        .select("*")
        .eq("seller_id", l.sellerId)
        .eq("product_id", l.productId)
        .order("created_at", { ascending: true });
      if (assignmentError) { toast.error("Erro ao verificar estoque do vendedor"); return; }
      sellerAssignmentRows = assignmentRows ?? [];
      const available = sellerAssignmentRows.reduce((sum, a) => sum + Number(a.quantity || 0), 0);
      if (available < l.quantity) {
        toast.error(`Vendedor possui apenas ${available} unidade(s) deste produto`);
        return;
      }
    }

    const unitCost = l.unitCost ?? product.purchasePrice;
    const totalCost = unitCost * l.quantity;
    const { data, error } = await supabase.from("stock_losses" as any).insert({
      product_id: l.productId, quantity: l.quantity,
      unit_cost: unitCost, total_cost: totalCost,
      reason: l.reason, date: l.date,
      seller_id: l.sellerId ?? null,
    }).select().single();
    if (error) { toast.error("Erro ao registrar perda"); return; }
    setStockLosses(prev => [...prev, mapStockLoss(data)]);
    const newStock = Math.max(0, product.stock - l.quantity);
    await supabase.from("products").update({ stock: newStock }).eq("id", l.productId);
    setProducts(prev => prev.map(p => p.id === l.productId ? { ...p, stock: newStock } : p));

    if (l.sellerId) {
      let remaining = l.quantity;
      for (const assignment of sellerAssignmentRows) {
        if (remaining <= 0) break;
        const currentQty = Number(assignment.quantity || 0);
        if (currentQty <= remaining) {
          await supabase.from("product_assignments").delete().eq("id", assignment.id);
          remaining -= currentQty;
        } else {
          await supabase.from("product_assignments").update({ quantity: currentQty - remaining }).eq("id", assignment.id);
          remaining = 0;
        }
      }
      const { data: refreshed } = await supabase.from("product_assignments").select("*").order("created_at", { ascending: true });
      if (refreshed) setProductAssignments((refreshed as any[]).map(mapProductAssignment));
    }

    toast.success("Perda registrada");
  }, [products]);

  const deleteStockLoss = useCallback(async (id: string) => {
    const loss = stockLosses.find(l => l.id === id);
    const { error } = await supabase.from("stock_losses" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir perda"); return; }
    setStockLosses(prev => prev.filter(l => l.id !== id));
    if (loss) {
      const product = products.find(p => p.id === loss.productId);
      if (product) {
        const newStock = product.stock + loss.quantity;
        await supabase.from("products").update({ stock: newStock }).eq("id", loss.productId);
        setProducts(prev => prev.map(p => p.id === loss.productId ? { ...p, stock: newStock } : p));
      }
      // Devolve a unidade para o vendedor, se a perda estava vinculada a ele
      if (loss.sellerId) {
        const { data: existing } = await supabase
          .from("product_assignments")
          .select("*")
          .eq("seller_id", loss.sellerId)
          .eq("product_id", loss.productId)
          .order("created_at", { ascending: true });
        if (existing && existing.length > 0) {
          await supabase.from("product_assignments")
            .update({ quantity: Number(existing[0].quantity || 0) + loss.quantity })
            .eq("id", existing[0].id);
        } else {
          await supabase.from("product_assignments").insert({
            seller_id: loss.sellerId, product_id: loss.productId, quantity: loss.quantity,
          });
        }
        const { data: refreshed } = await supabase.from("product_assignments").select("*").order("created_at", { ascending: true });
        if (refreshed) setProductAssignments((refreshed as any[]).map(mapProductAssignment));
      }
    }
  }, [stockLosses, products]);

  const getTotalLossValue = useCallback(() => {
    return stockLosses.reduce((sum, l) => sum + l.totalCost, 0);
  }, [stockLosses]);


  // ---- Sales ----
  const addSale = useCallback(async (s: Omit<Sale, "id" | "totalPrice">) => {
    const saleType = s.type || "venda";

    const { data, error } = await supabase.rpc("create_sale", {
      p_product_id: s.productId,
      p_quantity: s.quantity,
      p_unit_price: s.unitPrice,
      p_date: s.date,
      p_notes: s.notes ?? null,
      p_installments: s.installments || 1,
      p_paid_amount: s.paidAmount || 0,
      p_type: saleType,
      p_seller_id: s.sellerId ?? null,
      p_payment_method: saleType === "venda" ? (s.paymentMethod ?? null) : null,
    });

    if (error) {
      if (error.message.includes("estoque_insuficiente")) {
        toast.error(`Estoque insuficiente`);
      } else if (error.message.includes("estoque_vendedor_insuficiente")) {
        toast.error("Vendedor não possui estoque suficiente deste produto");
      } else if (error.message.includes("nao_autorizado")) {
        toast.error("Você não tem permissão para registrar essa venda");
      } else if (error.message.includes("quantidade_invalida")) {
        toast.error("Quantidade inválida");
      } else {
        toast.error("Erro ao registrar venda");
      }
      throw error;
    }

    const newSale = mapSale(data);
    setSales(prev => [...prev, newSale]);

    // A function já debitou o estoque no banco; aqui só sincronizamos
    // o estado local (products / product_assignments) com o que ficou.
    const { data: refreshedProduct } = await supabase
      .from("products").select(PRODUCT_COLS).eq("id", s.productId).single();
    if (refreshedProduct) {
      const updated = mapProduct(refreshedProduct);
      setProducts(prev => prev.map(p => p.id === s.productId ? updated : p));
    }
    if (s.sellerId) {
      const { data: refreshedAssignments } = await supabase
        .from("product_assignments").select("*").order("created_at", { ascending: true });
      if (refreshedAssignments) {
        setProductAssignments((refreshedAssignments as any[]).map(mapProductAssignment));
      }
    }
  }, []);

  const updateSale = useCallback(async (id: string, updates: Partial<Sale>) => {
    const existing = sales.find(s => s.id === id);
    const dbUpdates: any = {};
    if (updates.quantity !== undefined) dbUpdates.quantity = updates.quantity;
    if (updates.unitPrice !== undefined) dbUpdates.unit_price = updates.unitPrice;
    if (updates.totalPrice !== undefined) dbUpdates.total_price = updates.totalPrice;
    if (updates.date !== undefined) dbUpdates.date = updates.date;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    if (updates.installments !== undefined) dbUpdates.installments = updates.installments;
    if (updates.paidAmount !== undefined) dbUpdates.paid_amount = updates.paidAmount;
    if (updates.sellerId !== undefined) dbUpdates.seller_id = updates.sellerId || null;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod || null;

    // Data de recebimento: setada quando a venda passa a estar quitada, limpa quando volta a ficar em aberto.
    let nextPaidAt: string | null | undefined;
    if (updates.paidAmount !== undefined || updates.paidAt !== undefined || updates.totalPrice !== undefined) {
      const total = updates.totalPrice ?? existing?.totalPrice ?? 0;
      const paid = updates.paidAmount ?? existing?.paidAmount ?? 0;
      const type = updates.type ?? existing?.type ?? "venda";
      const isPaid = type === "venda" && paid >= total - 0.01;
      nextPaidAt = isPaid
        ? (updates.paidAt || existing?.paidAt || new Date().toISOString())
        : null;
      dbUpdates.paid_at = nextPaidAt;
    }

    const { error } = await supabase.from("sales").update(dbUpdates).eq("id", id);
    if (error) { toast.error("Erro ao atualizar venda"); return; }
    setSales(prev => prev.map(s => s.id === id
      ? { ...s, ...updates, ...(nextPaidAt !== undefined ? { paidAt: nextPaidAt || undefined } : {}) }
      : s));
  }, [sales]);

  const deleteSale = useCallback(async (id: string) => {
    const sale = sales.find(s => s.id === id);

    const { error } = await supabase.rpc("delete_sale", { p_sale_id: id });
    if (error) { toast.error("Erro ao excluir venda"); return; }

    setSales(prev => prev.filter(s => s.id !== id));

    if (sale) {
      const { data: refreshedProduct } = await supabase
        .from("products").select(PRODUCT_COLS).eq("id", sale.productId).single();
      if (refreshedProduct) {
        const updated = mapProduct(refreshedProduct);
        setProducts(prev => prev.map(p => p.id === sale.productId ? updated : p));
      }
      if (sale.sellerId) {
        const { data: refreshedAssignments } = await supabase
          .from("product_assignments").select("*").order("created_at", { ascending: true });
        if (refreshedAssignments) {
          setProductAssignments((refreshedAssignments as any[]).map(mapProductAssignment));
        }
      }
    }
  }, [sales]);

  // ---- Expenses ----
  const addExpense = useCallback(async (e: Omit<Expense, "id">) => {
    const { data, error } = await supabase.from("expenses").insert({
      description: e.description, category: e.category, amount: e.amount, date: e.date,
    }).select().single();
    if (error) { toast.error("Erro ao adicionar despesa"); return; }
    setExpenses(prev => [...prev, mapExpense(data)]);
  }, []);

  const deleteExpense = useCallback(async (id: string) => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir despesa"); return; }
    setExpenses(prev => prev.filter(e => e.id !== id));
  }, []);

  // ---- Investors ----
  const addInvestor = useCallback(async (i: Omit<Investor, "id" | "createdAt" | "totalReturn">) => {
    const totalReturn = i.investedAmount * (1 + i.returnPercentage / 100);
    const { data, error } = await supabase.from("investors").insert({
      name: i.name, invested_amount: i.investedAmount,
      return_percentage: i.returnPercentage, total_return: totalReturn,
    }).select().single();
    if (error) { toast.error("Erro ao adicionar investidor"); return; }
    setInvestors(prev => [...prev, mapInvestor(data)]);
  }, []);

  const updateInvestor = useCallback(async (id: string, updates: Partial<Investor>) => {
    const current = investors.find(i => i.id === id);
    if (!current) return;
    const updated = { ...current, ...updates };
    if (updates.investedAmount !== undefined || updates.returnPercentage !== undefined) {
      updated.totalReturn = updated.investedAmount * (1 + updated.returnPercentage / 100);
    }
    const { error } = await supabase.from("investors").update({
      name: updated.name, invested_amount: updated.investedAmount,
      return_percentage: updated.returnPercentage, total_return: updated.totalReturn,
    }).eq("id", id);
    if (error) { toast.error("Erro ao atualizar investidor"); return; }
    setInvestors(prev => prev.map(i => i.id === id ? updated : i));
  }, [investors]);

  const deleteInvestor = useCallback(async (id: string) => {
    const { error } = await supabase.from("investors").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir investidor"); return; }
    setInvestors(prev => prev.filter(i => i.id !== id));
  }, []);

  // ---- Dividends ----
  const addDividend = useCallback(async (d: Omit<Dividend, "id">) => {
    const { data, error } = await supabase.from("dividends").insert({
      investor_id: d.investorId, amount: d.amount, date: d.date, notes: d.notes,
    }).select().single();
    if (error) { toast.error("Erro ao registrar pagamento"); return; }
    setDividends(prev => [...prev, mapDividend(data)]);
  }, []);

  const deleteDividend = useCallback(async (id: string) => {
    const { error } = await supabase.from("dividends").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir pagamento"); return; }
    setDividends(prev => prev.filter(d => d.id !== id));
  }, []);

  // ---- Partners ----
  const addPartner = useCallback(async (p: Omit<Partner, "id" | "createdAt">) => {
    const { data, error } = await supabase.from("partners").insert({
      name: p.name, percentage: p.percentage,
      monthly_pro_labore: p.monthlyProLabore ?? 0,
    } as any).select().single();
    if (error) { toast.error("Erro ao adicionar sócio"); return; }
    setPartners(prev => [...prev, mapPartner(data)]);
  }, []);

  const updatePartner = useCallback(async (id: string, updates: Partial<Partner>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.percentage !== undefined) dbUpdates.percentage = updates.percentage;
    if (updates.monthlyProLabore !== undefined) dbUpdates.monthly_pro_labore = updates.monthlyProLabore;
    const { error } = await supabase.from("partners").update(dbUpdates).eq("id", id);
    if (error) { toast.error("Erro ao atualizar sócio"); return; }
    setPartners(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deletePartner = useCallback(async (id: string) => {
    const { error } = await supabase.from("partners").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir sócio"); return; }
    setPartners(prev => prev.filter(p => p.id !== id));
  }, []);

  // ---- Partner Payments ----
  const addPartnerPayment = useCallback(async (p: Omit<PartnerPayment, "id">) => {
    const { data, error } = await supabase.from("partner_payments" as any).insert({
      partner_id: p.partnerId, month: p.month, amount: p.amount,
      date: p.date, notes: p.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar pagamento"); return; }
    setPartnerPayments(prev => [...prev, mapPartnerPayment(data)]);
    toast.success("Pagamento registrado");
  }, []);

  const deletePartnerPayment = useCallback(async (id: string) => {
    const { error } = await supabase.from("partner_payments" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir pagamento"); return; }
    setPartnerPayments(prev => prev.filter(p => p.id !== id));
  }, []);

  const getPartnerPaidForMonth = useCallback((partnerId: string, month: string) => {
    return partnerPayments
      .filter(p => p.partnerId === partnerId && p.month === month)
      .reduce((sum, p) => sum + p.amount, 0);
  }, [partnerPayments]);

  const getTotalPartnerPayments = useCallback(() => {
    return partnerPayments.reduce((sum, p) => sum + p.amount, 0);
  }, [partnerPayments]);

  // ---- Sellers ----
  const addSeller = useCallback(async (s: Omit<Seller, "id" | "createdAt">) => {
    const { data, error } = await supabase.from("sellers" as any).insert({
      name: s.name, debt_percentage: s.debtPercentage ?? 10,
    } as any).select().single();
    if (error) { toast.error("Erro ao adicionar vendedor"); return; }
    setSellers(prev => [...prev, mapSeller(data)]);
  }, []);

  const updateSeller = useCallback(async (id: string, updates: Partial<Seller>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.debtPercentage !== undefined) dbUpdates.debt_percentage = updates.debtPercentage;
    const { error } = await supabase.from("sellers" as any).update(dbUpdates).eq("id", id);
    if (error) { toast.error("Erro ao atualizar vendedor"); return; }
    setSellers(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const deleteSeller = useCallback(async (id: string) => {
    const { error } = await supabase.from("sellers" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir vendedor"); return; }
    setSellers(prev => prev.filter(s => s.id !== id));
  }, []);

  // ---- Product Assignments ----
  const addProductAssignment = useCallback(async (a: Omit<ProductAssignment, "id" | "createdAt">) => {
    const { data: existingAssignments = [], error: fetchError } = await supabase
      .from("product_assignments")
      .select("*")
      .eq("seller_id", a.sellerId)
      .eq("product_id", a.productId)
      .order("created_at", { ascending: true });

    if (fetchError) {
      toast.error("Erro ao atribuir produto");
      return;
    }

    if (existingAssignments.length > 0) {
      const [primaryAssignment, ...duplicateAssignments] = existingAssignments;
      const mergedQuantity = existingAssignments.reduce((sum, item) => sum + item.quantity, 0) + a.quantity;

      const { data: updatedAssignment, error: updateError } = await supabase
        .from("product_assignments")
        .update({
          quantity: mergedQuantity,
          notes: a.notes ?? primaryAssignment.notes,
        })
        .eq("id", primaryAssignment.id)
        .select()
        .single();

      if (updateError || !updatedAssignment) {
        toast.error("Erro ao atribuir produto");
        return;
      }

      if (duplicateAssignments.length > 0) {
        const duplicateIds = duplicateAssignments.map(item => item.id);
        const { error: deleteError } = await supabase
          .from("product_assignments")
          .delete()
          .in("id", duplicateIds);

        if (deleteError) {
          toast.error("Erro ao consolidar atribuições");
          return;
        }
      }

      setProductAssignments(prev => {
        const duplicateIdSet = new Set(duplicateAssignments.map(item => item.id));
        const filteredAssignments = prev.filter(item => item.id !== primaryAssignment.id && !duplicateIdSet.has(item.id));

        return [...filteredAssignments, mapProductAssignment(updatedAssignment)];
      });

      return;
    }

    const { data, error } = await supabase.from("product_assignments").insert({
      seller_id: a.sellerId, product_id: a.productId, quantity: a.quantity, notes: a.notes,
    }).select().single();

    if (error) {
      toast.error("Erro ao atribuir produto");
      return;
    }

    setProductAssignments(prev => [...prev, mapProductAssignment(data)]);
  }, []);

  const deleteProductAssignment = useCallback(async (id: string) => {
    const { error } = await supabase.from("product_assignments" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao remover atribuição"); return; }
    setProductAssignments(prev => prev.filter(a => a.id !== id));
  }, []);

  const transferProductAssignment = useCallback(async (assignmentId: string, toSellerId: string, quantity: number) => {
    const source = productAssignments.find(a => a.id === assignmentId);
    if (!source) { toast.error("Atribuição não encontrada"); return; }
    if (quantity <= 0) { toast.error("Quantidade inválida"); return; }
    if (quantity > source.quantity) { toast.error(`Disponível apenas ${source.quantity}`); return; }
    if (toSellerId === source.sellerId) { toast.error("Selecione outro vendedor"); return; }

    const remaining = source.quantity - quantity;
    if (remaining > 0) {
      const { error: updErr } = await supabase.from("product_assignments").update({ quantity: remaining }).eq("id", assignmentId);
      if (updErr) { toast.error("Erro ao transferir"); return; }
      setProductAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, quantity: remaining } : a));
    } else {
      const { error: delErr } = await supabase.from("product_assignments").delete().eq("id", assignmentId);
      if (delErr) { toast.error("Erro ao transferir"); return; }
      setProductAssignments(prev => prev.filter(a => a.id !== assignmentId));
    }

    await addProductAssignment({ sellerId: toSellerId, productId: source.productId, quantity, notes: source.notes });
    toast.success("Atribuição transferida");
  }, [productAssignments, addProductAssignment]);

  // ---- Seller Debt Payments ----
  const addSellerDebtPayment = useCallback(async (p: Omit<SellerDebtPayment, "id">) => {
    const { data, error } = await supabase.from("seller_debt_payments" as any).insert({
      seller_id: p.sellerId, sale_id: p.saleId || null,
      amount: p.amount, date: p.date, notes: p.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar pagamento"); return; }
    setSellerDebtPayments(prev => [...prev, mapSellerDebtPayment(data)]);
  }, []);

  const deleteSellerDebtPayment = useCallback(async (id: string) => {
    const { error } = await supabase.from("seller_debt_payments" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir pagamento"); return; }
    setSellerDebtPayments(prev => prev.filter(p => p.id !== id));
  }, []);

  // ---- Seller Manual Debts ----
  const addSellerManualDebt = useCallback(async (d: Omit<SellerManualDebt, "id">) => {
    const { data, error } = await supabase.from("seller_manual_debts" as any).insert({
      seller_id: d.sellerId, amount: d.amount, date: d.date, notes: d.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar saldo devedor"); return; }
    setSellerManualDebts(prev => [...prev, mapSellerManualDebt(data)]);
    toast.success("Saldo devedor registrado");
  }, []);

  const deleteSellerManualDebt = useCallback(async (id: string) => {
    const { error } = await supabase.from("seller_manual_debts" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir"); return; }
    setSellerManualDebts(prev => prev.filter(d => d.id !== id));
  }, []);

  // ---- Commission Payments ----
  const addCommissionPayment = useCallback(async (p: Omit<CommissionPayment, "id">) => {
    const { data, error } = await supabase.from("commission_payments" as any).insert({
      seller_id: p.sellerId, amount: p.amount, date: p.date, notes: p.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar comissão"); return; }
    setCommissionPayments(prev => [...prev, mapCommissionPayment(data)]);
    toast.success("Comissão registrada");
  }, []);

  const deleteCommissionPayment = useCallback(async (id: string) => {
    const { error } = await supabase.from("commission_payments" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir"); return; }
    setCommissionPayments(prev => prev.filter(p => p.id !== id));
  }, []);

  // ---- Pro-labore Payments ----
  const addProLaborePayment = useCallback(async (p: Omit<ProLaborePayment, "id">) => {
    const { data, error } = await supabase.from("pro_labore_payments" as any).insert({
      partner_id: p.partnerId, amount: p.amount, date: p.date, notes: p.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar pró-labore"); return; }
    setProLaborePayments(prev => [...prev, mapProLaborePayment(data)]);
    toast.success("Pró-labore registrado");
  }, []);

  const deleteProLaborePayment = useCallback(async (id: string) => {
    const { error } = await supabase.from("pro_labore_payments" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir"); return; }
    setProLaborePayments(prev => prev.filter(p => p.id !== id));
  }, []);

  // ---- Computed ----
  const getSellerName = useCallback((id: string) => sellers.find(s => s.id === id)?.name ?? "Vendedor desconhecido", [sellers]);
  const getTotalRevenue = useCallback(() => sales.filter(s => s.type === "venda").reduce((sum, s) => sum + s.totalPrice, 0), [sales]);
  const getTotalCosts = useCallback(() => stockEntries.reduce((sum, e) => sum + e.totalCost, 0), [stockEntries]);
  const getTotalExpenses = useCallback(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);
  const getTotalInvested = useCallback(() => investors.reduce((sum, i) => sum + i.investedAmount, 0), [investors]);
  const getNetProfit = useCallback(() => getTotalRevenue() - getTotalCosts() - getTotalExpenses() - getTotalLossValue() - getTotalPartnerPayments(), [getTotalRevenue, getTotalCosts, getTotalExpenses, getTotalLossValue, getTotalPartnerPayments]);
  const getProductName = useCallback((id: string) => {
    const p = products.find(p => p.id === id);
    if (!p) return "Produto desconhecido";
    const flavor = p.flavor?.trim();
    const model = (p.model || p.name)?.trim();
    if (flavor && model) return `${flavor} · ${model}`;
    return flavor || model || "Produto desconhecido";
  }, [products]);
  const getInvestorName = useCallback((id: string) => investors.find(i => i.id === id)?.name ?? "Investidor desconhecido", [investors]);

  const getPaidToInvestor = useCallback((id: string) => {
    return dividends.filter(d => d.investorId === id).reduce((sum, d) => sum + d.amount, 0);
  }, [dividends]);

  const getRemainingForInvestor = useCallback((id: string) => {
    const investor = investors.find(i => i.id === id);
    if (!investor) return 0;
    return Math.max(0, investor.totalReturn - getPaidToInvestor(id));
  }, [investors, getPaidToInvestor]);

  const getSellerDebt = useCallback((id: string) => {
    const fromRetiradas = sales.filter(s => s.sellerId === id && s.type === "retirada_funcionario").reduce((sum, s) => sum + s.totalPrice, 0);
    const fromManual = sellerManualDebts.filter(d => d.sellerId === id).reduce((sum, d) => sum + d.amount, 0);
    return fromRetiradas + fromManual;
  }, [sales, sellerManualDebts]);

  const getSellerPaid = useCallback((id: string) => {
    return sellerDebtPayments.filter(p => p.sellerId === id).reduce((sum, p) => sum + p.amount, 0);
  }, [sellerDebtPayments]);

  // Saldo = Retirado - Pago.
  // Positivo = funcionário ainda deve. Negativo = crédito/saldo positivo para o funcionário.
  const getSellerBalance = useCallback((id: string) => {
    return getSellerDebt(id) - getSellerPaid(id);
  }, [getSellerPaid, getSellerDebt]);

  // ---- Novo modelo financeiro ----
  const refreshFinancialEvents = useCallback(async () => {
    const { data } = await supabase.from("financial_events" as any).select("*").order("event_date", { ascending: true });
    if (data) setFinancialEvents((data as any[]).map(mapFinancialEvent));
  }, []);

  const addPartnerContribution = useCallback(async (c: Omit<PartnerContribution, "id" | "createdAt">) => {
    const { data, error } = await supabase.from("partner_contributions" as any).insert({
      partner_id: c.partnerId, amount: c.amount, date: c.date, notes: c.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar aporte"); return; }
    setPartnerContributions(prev => [...prev, mapPartnerContribution(data)]);
    await refreshFinancialEvents();
    toast.success("Aporte registrado");
  }, [refreshFinancialEvents]);

  const deletePartnerContribution = useCallback(async (id: string) => {
    const { error } = await supabase.from("partner_contributions" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir aporte"); return; }
    setPartnerContributions(prev => prev.filter(x => x.id !== id));
    await refreshFinancialEvents();
  }, [refreshFinancialEvents]);

  const addLoan = useCallback(async (l: Omit<Loan, "id" | "createdAt">) => {
    const { data, error } = await supabase.from("loans" as any).insert({
      lender_name: l.lenderName, principal: l.principal,
      interest_amount: l.interestAmount ?? 0,
      received_date: l.receivedDate, notes: l.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar empréstimo"); return; }
    setLoans(prev => [...prev, mapLoan(data)]);
    await refreshFinancialEvents();
    toast.success("Empréstimo registrado");
  }, [refreshFinancialEvents]);

  const updateLoan = useCallback(async (id: string, updates: Partial<Loan>) => {
    const dbUpdates: any = {};
    if (updates.lenderName !== undefined) dbUpdates.lender_name = updates.lenderName;
    if (updates.principal !== undefined) dbUpdates.principal = updates.principal;
    if (updates.interestAmount !== undefined) dbUpdates.interest_amount = updates.interestAmount;
    if (updates.receivedDate !== undefined) dbUpdates.received_date = updates.receivedDate;
    if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
    const { error } = await supabase.from("loans" as any).update(dbUpdates).eq("id", id);
    if (error) { toast.error("Erro ao atualizar empréstimo"); return; }
    setLoans(prev => prev.map(x => x.id === id ? { ...x, ...updates } : x));
    await refreshFinancialEvents();
  }, [refreshFinancialEvents]);

  const deleteLoan = useCallback(async (id: string) => {
    const { error } = await supabase.from("loans" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir empréstimo"); return; }
    setLoans(prev => prev.filter(x => x.id !== id));
    setLoanPayments(prev => prev.filter(p => p.loanId !== id));
    await refreshFinancialEvents();
  }, [refreshFinancialEvents]);

  const addLoanPayment = useCallback(async (p: Omit<LoanPayment, "id" | "createdAt">) => {
    const { data, error } = await supabase.from("loan_payments" as any).insert({
      loan_id: p.loanId,
      principal_amount: p.principalAmount ?? 0,
      interest_amount: p.interestAmount ?? 0,
      date: p.date, notes: p.notes,
    } as any).select().single();
    if (error) { toast.error("Erro ao registrar pagamento"); return; }
    setLoanPayments(prev => [...prev, mapLoanPayment(data)]);
    await refreshFinancialEvents();
    toast.success("Pagamento registrado");
  }, [refreshFinancialEvents]);

  const deleteLoanPayment = useCallback(async (id: string) => {
    const { error } = await supabase.from("loan_payments" as any).delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir pagamento"); return; }
    setLoanPayments(prev => prev.filter(x => x.id !== id));
    await refreshFinancialEvents();
  }, [refreshFinancialEvents]);

  const getLoanPaid = useCallback((loanId: string) => {
    return loanPayments.filter(p => p.loanId === loanId).reduce((s, p) => s + p.principalAmount + p.interestAmount, 0);
  }, [loanPayments]);

  const getLoanRemaining = useCallback((loanId: string) => {
    const l = loans.find(x => x.id === loanId);
    if (!l) return 0;
    const total = l.principal + l.interestAmount;
    return Math.max(0, total - getLoanPaid(loanId));
  }, [loans, getLoanPaid]);

  // ---- Selectors do razão (derivados de financial_events) ----
  // Totais calculados uma única vez por atualização do razão, em vez de a cada chamada.
  const ledgerTotals = useMemo(() => {
    const t = {
      cash: 0, inventory: 0, receivable: 0, partnerCapital: 0,
      loan: 0, accumulatedProfit: 0, distributedProfit: 0,
    };
    for (const e of financialEvents) {
      t.cash += Number(e.cashDelta) || 0;
      t.inventory += Number(e.inventoryDelta) || 0;
      t.receivable += Number(e.receivableDelta) || 0;
      t.partnerCapital += Number(e.partnerCapitalDelta) || 0;
      t.loan += Number(e.loanDelta) || 0;
      t.accumulatedProfit += Number(e.accumulatedProfitDelta) || 0;
      t.distributedProfit += Number(e.distributedProfitDelta) || 0;
    }
    return t;
  }, [financialEvents]);

  const getCash = useCallback(() => ledgerTotals.cash, [ledgerTotals]);
  const getInventoryCostValue = useCallback(() => ledgerTotals.inventory, [ledgerTotals]);
  const getReceivables = useCallback(() => ledgerTotals.receivable, [ledgerTotals]);
  const getPartnerCapital = useCallback(() => ledgerTotals.partnerCapital, [ledgerTotals]);
  const getLoansOutstanding = useCallback(() => ledgerTotals.loan, [ledgerTotals]);
  const getAccumulatedProfit = useCallback(() => ledgerTotals.accumulatedProfit, [ledgerTotals]);
  const getDistributedProfit = useCallback(() => ledgerTotals.distributedProfit, [ledgerTotals]);
  const getRetainedEarnings = useCallback(() => ledgerTotals.accumulatedProfit - ledgerTotals.distributedProfit, [ledgerTotals]);
  const getDistributableProfit = useCallback((pendingCommissions: number = 0) => {
    return getRetainedEarnings() - pendingCommissions;
  }, [getRetainedEarnings]);

  const ctxValue = useMemo<StoreContextType>(() => ({
    products, stockEntries, sales, expenses, investors, dividends, partners, sellers, productAssignments, sellerDebtPayments, partnerPayments, sellerManualDebts, stockLosses, commissionPayments, proLaborePayments, loading,
    addProduct, updateProduct, deleteProduct,
    addStockEntry, deleteStockEntry, addStockLoss, deleteStockLoss, getTotalLossValue, addSale, updateSale, deleteSale,
    addExpense, deleteExpense,
    addInvestor, updateInvestor, deleteInvestor,
    addDividend, deleteDividend,
    addPartner, updatePartner, deletePartner,
    addPartnerPayment, deletePartnerPayment, getPartnerPaidForMonth, getTotalPartnerPayments,
    addSeller, updateSeller, deleteSeller, addProductAssignment, deleteProductAssignment, transferProductAssignment,
    addSellerDebtPayment, deleteSellerDebtPayment, addSellerManualDebt, deleteSellerManualDebt,
    addCommissionPayment, deleteCommissionPayment, addProLaborePayment, deleteProLaborePayment,
    getSellerName,
    getTotalRevenue, getTotalCosts, getTotalExpenses, getTotalInvested, getNetProfit,
    getProductName, getInvestorName, getPaidToInvestor, getRemainingForInvestor,
    getSellerDebt, getSellerPaid, getSellerBalance,
    purchaseOrders, addPurchaseOrder, deletePurchaseOrder, receivePurchaseOrder,
    partnerContributions, loans, loanPayments, financialEvents,
    addPartnerContribution, deletePartnerContribution,
    addLoan, updateLoan, deleteLoan,
    addLoanPayment, deleteLoanPayment,
    refreshFinancialEvents,
    getCash, getInventoryCostValue, getReceivables,
    getPartnerCapital, getLoansOutstanding,
    getAccumulatedProfit, getDistributedProfit, getRetainedEarnings, getDistributableProfit,
    getLoanPaid, getLoanRemaining,
  }), [
    products, stockEntries, sales, expenses, investors, dividends, partners, sellers, productAssignments, sellerDebtPayments, partnerPayments, sellerManualDebts, stockLosses, commissionPayments, proLaborePayments, loading,
    addProduct, updateProduct, deleteProduct,
    addStockEntry, deleteStockEntry, addStockLoss, deleteStockLoss, getTotalLossValue, addSale, updateSale, deleteSale,
    addExpense, deleteExpense,
    addInvestor, updateInvestor, deleteInvestor,
    addDividend, deleteDividend,
    addPartner, updatePartner, deletePartner,
    addPartnerPayment, deletePartnerPayment, getPartnerPaidForMonth, getTotalPartnerPayments,
    addSeller, updateSeller, deleteSeller, addProductAssignment, deleteProductAssignment, transferProductAssignment,
    addSellerDebtPayment, deleteSellerDebtPayment, addSellerManualDebt, deleteSellerManualDebt,
    addCommissionPayment, deleteCommissionPayment, addProLaborePayment, deleteProLaborePayment,
    getSellerName,
    getTotalRevenue, getTotalCosts, getTotalExpenses, getTotalInvested, getNetProfit,
    getProductName, getInvestorName, getPaidToInvestor, getRemainingForInvestor,
    getSellerDebt, getSellerPaid, getSellerBalance,
    purchaseOrders, addPurchaseOrder, deletePurchaseOrder, receivePurchaseOrder,
    partnerContributions, loans, loanPayments, financialEvents,
    addPartnerContribution, deletePartnerContribution,
    addLoan, updateLoan, deleteLoan,
    addLoanPayment, deleteLoanPayment,
    refreshFinancialEvents,
    getCash, getInventoryCostValue, getReceivables,
    getPartnerCapital, getLoansOutstanding,
    getAccumulatedProfit, getDistributedProfit, getRetainedEarnings, getDistributableProfit,
    getLoanPaid, getLoanRemaining,
  ]);

  return (
    <StoreContext.Provider value={ctxValue}>
      {children}
    </StoreContext.Provider>
  );
}


export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
