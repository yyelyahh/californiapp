import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Product, StockEntry, Sale, Expense, Investor, Dividend, Partner, PartnerPayment, Seller, ProductAssignment, SellerDebtPayment, SellerManualDebt, StockLoss, CommissionPayment, ProLaborePayment } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

// Columns readable by every authenticated user (purchase_price is admin-only via RPC)
const PRODUCT_COLS = "id,name,brand,model,flavor,sale_price,stock,created_at";

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
      stock: r.stock, createdAt: r.created_at,
    }));
  }, [isAdmin]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [prodList, stockRes, salesRes, expRes, invRes, divRes, partRes, selRes, paRes, sdpRes, ppRes, smdRes, slRes, cpRes, plRes] = await Promise.all([
          fetchProductsList(),
          supabase.from("stock_entries").select("*").order("created_at", { ascending: true }),
          supabase.from("sales").select("*").order("created_at", { ascending: true }),
          supabase.from("expenses").select("*").order("created_at", { ascending: true }),
          supabase.from("investors").select("*").order("created_at", { ascending: true }),
          supabase.from("dividends").select("*").order("created_at", { ascending: true }),
          supabase.from("partners").select("*").order("created_at", { ascending: true }),
          supabase.from("sellers" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("product_assignments" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("seller_debt_payments" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("partner_payments" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("seller_manual_debts" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("stock_losses" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("commission_payments" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("pro_labore_payments" as any).select("*").order("created_at", { ascending: true }),
        ]) as any;

        setProducts(prodList);
        if (stockRes.data) setStockEntries(stockRes.data.map(mapStockEntry));
        if (salesRes.data) setSales(salesRes.data.map(mapSale));
        if (expRes.data) setExpenses(expRes.data.map(mapExpense));
        if (invRes.data) setInvestors(invRes.data.map(mapInvestor));
        if (divRes.data) setDividends(divRes.data.map(mapDividend));
        if (partRes.data) setPartners(partRes.data.map(mapPartner));
        if (selRes.data) setSellers((selRes.data as any[]).map(mapSeller));
        if (paRes.data) setProductAssignments((paRes.data as any[]).map(mapProductAssignment));
        if (sdpRes.data) setSellerDebtPayments((sdpRes.data as any[]).map(mapSellerDebtPayment));
        if (ppRes.data) setPartnerPayments((ppRes.data as any[]).map(mapPartnerPayment));
        if (smdRes.data) setSellerManualDebts((smdRes.data as any[]).map(mapSellerManualDebt));
        if (slRes.data) setStockLosses((slRes.data as any[]).map(mapStockLoss));
        if (cpRes?.data) setCommissionPayments((cpRes.data as any[]).map(mapCommissionPayment));
        if (plRes?.data) setProLaborePayments((plRes.data as any[]).map(mapProLaborePayment));
      } catch (err) {
        console.error("Error fetching data:", err);
        toast.error("Erro ao carregar dados");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();

    // ---- Realtime sync: any change in shared tables refreshes the affected slice ----
    const channel = supabase
      .channel("store-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, async () => {
        setProducts(await fetchProductsList());
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, async () => {
        const { data } = await supabase.from("sales").select("*").order("created_at", { ascending: true });
        if (data) setSales(data.map(mapSale));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_entries" }, async () => {
        const { data } = await supabase.from("stock_entries").select("*").order("created_at", { ascending: true });
        if (data) setStockEntries(data.map(mapStockEntry));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "product_assignments" }, async () => {
        const { data } = await supabase.from("product_assignments").select("*").order("created_at", { ascending: true });
        if (data) setProductAssignments((data as any[]).map(mapProductAssignment));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sellers" }, async () => {
        const { data } = await supabase.from("sellers" as any).select("*").order("created_at", { ascending: true });
        if (data) setSellers((data as any[]).map(mapSeller));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "stock_losses" }, async () => {
        const { data } = await supabase.from("stock_losses" as any).select("*").order("created_at", { ascending: true });
        if (data) setStockLosses((data as any[]).map(mapStockLoss));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchProductsList]);

  const mapProduct = (r: any): Product => ({
    id: r.id, name: r.name, brand: r.brand, model: r.model || '', flavor: r.flavor,
    purchasePrice: Number(r.purchase_price ?? 0), salePrice: Number(r.sale_price),
    stock: r.stock, createdAt: r.created_at,
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

  // ---- Products ----
  const addProduct = useCallback(async (p: Omit<Product, "id" | "createdAt" | "stock">) => {
    const { data, error } = await supabase.from("products").insert({
      name: p.name, brand: p.brand, model: p.model, flavor: p.flavor,
      purchase_price: p.purchasePrice, sale_price: p.salePrice, stock: 0,
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
    const unitCost = l.unitCost ?? product.purchasePrice;
    const totalCost = unitCost * l.quantity;
    const { data, error } = await supabase.from("stock_losses" as any).insert({
      product_id: l.productId, quantity: l.quantity,
      unit_cost: unitCost, total_cost: totalCost,
      reason: l.reason, date: l.date,
    }).select().single();
    if (error) { toast.error("Erro ao registrar perda"); return; }
    setStockLosses(prev => [...prev, mapStockLoss(data)]);
    const newStock = Math.max(0, product.stock - l.quantity);
    await supabase.from("products").update({ stock: newStock }).eq("id", l.productId);
    setProducts(prev => prev.map(p => p.id === l.productId ? { ...p, stock: newStock } : p));
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
    }
  }, [stockLosses, products]);

  const getTotalLossValue = useCallback(() => {
    return stockLosses.reduce((sum, l) => sum + l.totalCost, 0);
  }, [stockLosses]);


  // ---- Sales ----
  const addSale = useCallback(async (s: Omit<Sale, "id" | "totalPrice">) => {
    const totalPrice = s.quantity * s.unitPrice;
    const saleType = s.type || "venda";

    // ---- Integrity validations (single source of truth) ----
    const { data: productRow, error: productError } = await supabase
      .from("products")
      .select(PRODUCT_COLS)
      .eq("id", s.productId)
      .single();
    const product = productRow ? mapProduct(productRow) : products.find(p => p.id === s.productId);
    if (productError || !product) { toast.error("Produto não encontrado"); throw new Error("product_not_found"); }
    if (s.quantity <= 0) { toast.error("Quantidade inválida"); throw new Error("invalid_qty"); }
    if (product.stock < s.quantity) {
      toast.error(`Estoque insuficiente (disponível: ${product.stock})`);
      throw new Error("insufficient_stock");
    }

    let sellerAssignmentRows: any[] = [];
    if (s.sellerId) {
      // Vendedor só pode vender o que tem atribuído
      const { data: assignmentRows, error: assignmentError } = await supabase
        .from("product_assignments")
        .select("*")
        .eq("seller_id", s.sellerId)
        .eq("product_id", s.productId)
        .order("created_at", { ascending: true });
      if (assignmentError) { toast.error("Erro ao verificar estoque do vendedor"); throw assignmentError; }
      sellerAssignmentRows = assignmentRows ?? [];
      const available = sellerAssignmentRows.reduce((sum, assignment) => sum + Number(assignment.quantity || 0), 0);
      if (available < s.quantity) {
        toast.error(`Vendedor possui apenas ${available} unidade(s) deste produto`);
        throw new Error("seller_insufficient_stock");
      }
    }

    const insertData: any = {
      product_id: s.productId, quantity: s.quantity,
      unit_price: s.unitPrice, total_price: totalPrice, date: s.date, notes: s.notes,
      installments: s.installments || 1,
      paid_amount: saleType === "retirada_funcionario" ? 0 : (s.paidAmount || 0),
      type: saleType,
    };
    if (s.sellerId) insertData.seller_id = s.sellerId;
    if (saleType === "venda" && s.paymentMethod) insertData.payment_method = s.paymentMethod;
    const { data, error } = await supabase.from("sales").insert(insertData).select().single();
    if (error) { toast.error("Erro ao registrar venda"); throw error; }
    const newSale = mapSale(data);
    setSales(prev => [...prev, newSale]);

    // Sempre reduz estoque global do produto
    const newStock = Math.max(0, product.stock - s.quantity);
    await supabase.from("products").update({ stock: newStock }).eq("id", s.productId);
    setProducts(prev => prev.map(p => p.id === s.productId ? { ...p, stock: newStock } : p));

    // Atualiza/remove atribuição do vendedor
    if (s.sellerId) {
      let remainingToDeduct = s.quantity;
      for (const assignment of sellerAssignmentRows) {
        if (remainingToDeduct <= 0) break;
        const currentQty = Number(assignment.quantity || 0);
        if (currentQty <= remainingToDeduct) {
          const { error: deleteAssignmentError } = await supabase.from("product_assignments").delete().eq("id", assignment.id);
          if (deleteAssignmentError) toast.error("Venda registrada, mas houve erro ao baixar atribuição do vendedor");
          remainingToDeduct -= currentQty;
        } else {
          const newQty = currentQty - remainingToDeduct;
          const { error: updateAssignmentError } = await supabase.from("product_assignments").update({ quantity: newQty }).eq("id", assignment.id);
          if (updateAssignmentError) toast.error("Venda registrada, mas houve erro ao baixar atribuição do vendedor");
          remainingToDeduct = 0;
        }
      }
      const { data: refreshedAssignments } = await supabase.from("product_assignments").select("*").order("created_at", { ascending: true });
      if (refreshedAssignments) setProductAssignments((refreshedAssignments as any[]).map(mapProductAssignment));

      // Abatimento automático legado (10%) removido — comissão atual é gerenciada via página de Distribuição.

    }
  }, [products, productAssignments, sellers, sellerDebtPayments, sales]);

  const updateSale = useCallback(async (id: string, updates: Partial<Sale>) => {
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
    const { error } = await supabase.from("sales").update(dbUpdates).eq("id", id);
    if (error) { toast.error("Erro ao atualizar venda"); return; }
    setSales(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const deleteSale = useCallback(async (id: string) => {
    const sale = sales.find(s => s.id === id);
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir venda"); return; }
    setSales(prev => prev.filter(s => s.id !== id));
    if (sale) {
      const product = products.find(p => p.id === sale.productId);
      if (product) {
        await supabase.from("products").update({ stock: product.stock + sale.quantity }).eq("id", sale.productId);
        setProducts(prev => prev.map(p => p.id === sale.productId ? { ...p, stock: p.stock + sale.quantity } : p));
      }
      // Restaura atribuição do vendedor (recria se foi removida ao zerar)
      if (sale.sellerId) {
        const assignment = productAssignments.find(a => a.sellerId === sale.sellerId && a.productId === sale.productId);
        if (assignment) {
          const restoredQty = assignment.quantity + sale.quantity;
          await supabase.from("product_assignments").update({ quantity: restoredQty }).eq("id", assignment.id);
          setProductAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, quantity: restoredQty } : a));
        } else {
          const { data: created } = await supabase.from("product_assignments").insert({
            seller_id: sale.sellerId, product_id: sale.productId, quantity: sale.quantity,
          }).select().single();
          if (created) setProductAssignments(prev => [...prev, mapProductAssignment(created)]);
        }
      }
    }
  }, [sales, products, productAssignments]);

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

  return (
    <StoreContext.Provider value={{
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
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
