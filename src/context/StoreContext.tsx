import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Product, StockEntry, Sale, Expense, Investor, Dividend, Partner, PartnerPayment, Seller, ProductAssignment, SellerDebtPayment } from "@/types";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  loading: boolean;
  addProduct: (p: Omit<Product, "id" | "createdAt" | "stock">) => Promise<void>;
  updateProduct: (id: string, p: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addStockEntry: (e: Omit<StockEntry, "id" | "totalCost">) => Promise<void>;
  deleteStockEntry: (id: string) => Promise<void>;
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
  addSeller: (s: Omit<Seller, "id" | "createdAt">) => Promise<void>;
  updateSeller: (id: string, s: Partial<Seller>) => Promise<void>;
  deleteSeller: (id: string) => Promise<void>;
  addProductAssignment: (a: Omit<ProductAssignment, "id" | "createdAt">) => Promise<void>;
  deleteProductAssignment: (id: string) => Promise<void>;
  addSellerDebtPayment: (p: Omit<SellerDebtPayment, "id">) => Promise<void>;
  deleteSellerDebtPayment: (id: string) => Promise<void>;
  getSellerName: (id: string) => string;
  getTotalRevenue: () => number;
  getTotalCosts: () => number;
  getTotalExpenses: () => number;
  getTotalInvested: () => number;
  getNetProfit: () => number;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [prodRes, stockRes, salesRes, expRes, invRes, divRes, partRes, selRes, paRes, sdpRes] = await Promise.all([
          supabase.from("products").select("*").order("created_at", { ascending: true }),
          supabase.from("stock_entries").select("*").order("created_at", { ascending: true }),
          supabase.from("sales").select("*").order("created_at", { ascending: true }),
          supabase.from("expenses").select("*").order("created_at", { ascending: true }),
          supabase.from("investors").select("*").order("created_at", { ascending: true }),
          supabase.from("dividends").select("*").order("created_at", { ascending: true }),
          supabase.from("partners").select("*").order("created_at", { ascending: true }),
          supabase.from("sellers" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("product_assignments" as any).select("*").order("created_at", { ascending: true }),
          supabase.from("seller_debt_payments" as any).select("*").order("created_at", { ascending: true }),
        ]);

        if (prodRes.data) setProducts(prodRes.data.map(mapProduct));
        if (stockRes.data) setStockEntries(stockRes.data.map(mapStockEntry));
        if (salesRes.data) setSales(salesRes.data.map(mapSale));
        if (expRes.data) setExpenses(expRes.data.map(mapExpense));
        if (invRes.data) setInvestors(invRes.data.map(mapInvestor));
        if (divRes.data) setDividends(divRes.data.map(mapDividend));
        if (partRes.data) setPartners(partRes.data.map(mapPartner));
        if (selRes.data) setSellers((selRes.data as any[]).map(mapSeller));
        if (paRes.data) setProductAssignments((paRes.data as any[]).map(mapProductAssignment));
        if (sdpRes.data) setSellerDebtPayments((sdpRes.data as any[]).map(mapSellerDebtPayment));
      } catch (err) {
        console.error("Error fetching data:", err);
        toast.error("Erro ao carregar dados");
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const mapProduct = (r: any): Product => ({
    id: r.id, name: r.name, brand: r.brand, model: r.model || '', flavor: r.flavor,
    purchasePrice: Number(r.purchase_price), salePrice: Number(r.sale_price),
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
    id: r.id, name: r.name, percentage: Number(r.percentage), createdAt: r.created_at,
  });

  // ---- Products ----
  const addProduct = useCallback(async (p: Omit<Product, "id" | "createdAt" | "stock">) => {
    const { data, error } = await supabase.from("products").insert({
      name: p.name, brand: p.brand, model: p.model, flavor: p.flavor,
      purchase_price: p.purchasePrice, sale_price: p.salePrice, stock: 0,
    }).select().single();
    if (error) { toast.error("Erro ao adicionar produto"); return; }
    setProducts(prev => [...prev, mapProduct(data)]);
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
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir produto"); return; }
    setProducts(prev => prev.filter(p => p.id !== id));
  }, []);

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

  // ---- Sales ----
  const addSale = useCallback(async (s: Omit<Sale, "id" | "totalPrice">) => {
    const totalPrice = s.quantity * s.unitPrice;
    const saleType = s.type || "venda";
    const insertData: any = {
      product_id: s.productId, quantity: s.quantity,
      unit_price: s.unitPrice, total_price: totalPrice, date: s.date, notes: s.notes,
      installments: s.installments || 1,
      paid_amount: saleType === "retirada_funcionario" ? 0 : (s.paidAmount || 0),
      type: saleType,
    };
    if (s.sellerId) insertData.seller_id = s.sellerId;
    const { data, error } = await supabase.from("sales").insert(insertData).select().single();
    if (error) { toast.error("Erro ao registrar venda"); return; }
    const newSale = mapSale(data);
    setSales(prev => [...prev, newSale]);
    const product = products.find(p => p.id === s.productId);
    if (product) {
      const newStock = Math.max(0, product.stock - s.quantity);
      await supabase.from("products").update({ stock: newStock }).eq("id", s.productId);
      setProducts(prev => prev.map(p => p.id === s.productId
        ? { ...p, stock: newStock } : p));
    }
    // Deduct from seller's product assignment if sale has a seller
    if (s.sellerId) {
      const assignment = productAssignments.find(a => a.sellerId === s.sellerId && a.productId === s.productId);
      if (assignment) {
        const newQty = Math.max(0, assignment.quantity - s.quantity);
        await supabase.from("product_assignments").update({ quantity: newQty }).eq("id", assignment.id);
        setProductAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, quantity: newQty } : a));
      }
      // Auto-debit X% from seller's debt on a regular sale (not retirada)
      if (saleType === "venda") {
        const seller = sellers.find(sl => sl.id === s.sellerId);
        const pct = seller?.debtPercentage ?? 0;
        const debt = sellerDebtPayments
          .filter(p => p.sellerId === s.sellerId && !p.saleId)
          .reduce((sum, p) => sum + p.amount, 0);
        const retiradas = (sales.concat([newSale]))
          .filter(sl => sl.sellerId === s.sellerId && sl.type === "retirada_funcionario")
          .reduce((sum, sl) => sum + sl.totalPrice, 0);
        const auto = sellerDebtPayments
          .filter(p => p.sellerId === s.sellerId && p.saleId)
          .reduce((sum, p) => sum + p.amount, 0);
        const balance = Math.max(0, retiradas - debt - auto);
        const abatement = Math.min(balance, totalPrice * (pct / 100));
        if (pct > 0 && abatement > 0) {
          const { data: pData, error: pErr } = await supabase.from("seller_debt_payments" as any).insert({
            seller_id: s.sellerId, sale_id: newSale.id, amount: abatement,
            date: s.date, notes: `Abatimento automático (${pct}%)`,
          }).select().single();
          if (!pErr && pData) {
            setSellerDebtPayments(prev => [...prev, mapSellerDebtPayment(pData)]);
          }
        }
      }
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
      // Restore seller's product assignment quantity
      if (sale.sellerId) {
        const assignment = productAssignments.find(a => a.sellerId === sale.sellerId && a.productId === sale.productId);
        if (assignment) {
          const restoredQty = assignment.quantity + sale.quantity;
          await supabase.from("product_assignments").update({ quantity: restoredQty }).eq("id", assignment.id);
          setProductAssignments(prev => prev.map(a => a.id === assignment.id ? { ...a, quantity: restoredQty } : a));
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
    }).select().single();
    if (error) { toast.error("Erro ao adicionar sócio"); return; }
    setPartners(prev => [...prev, mapPartner(data)]);
  }, []);

  const updatePartner = useCallback(async (id: string, updates: Partial<Partner>) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.percentage !== undefined) dbUpdates.percentage = updates.percentage;
    const { error } = await supabase.from("partners").update(dbUpdates).eq("id", id);
    if (error) { toast.error("Erro ao atualizar sócio"); return; }
    setPartners(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deletePartner = useCallback(async (id: string) => {
    const { error } = await supabase.from("partners").delete().eq("id", id);
    if (error) { toast.error("Erro ao excluir sócio"); return; }
    setPartners(prev => prev.filter(p => p.id !== id));
  }, []);

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

  // ---- Computed ----
  const getSellerName = useCallback((id: string) => sellers.find(s => s.id === id)?.name ?? "Vendedor desconhecido", [sellers]);
  const getTotalRevenue = useCallback(() => sales.filter(s => s.type === "venda").reduce((sum, s) => sum + s.totalPrice, 0), [sales]);
  const getTotalCosts = useCallback(() => stockEntries.reduce((sum, e) => sum + e.totalCost, 0), [stockEntries]);
  const getTotalExpenses = useCallback(() => expenses.reduce((sum, e) => sum + e.amount, 0), [expenses]);
  const getTotalInvested = useCallback(() => investors.reduce((sum, i) => sum + i.investedAmount, 0), [investors]);
  const getNetProfit = useCallback(() => getTotalRevenue() - getTotalCosts() - getTotalExpenses(), [getTotalRevenue, getTotalCosts, getTotalExpenses]);
  const getProductName = useCallback((id: string) => products.find(p => p.id === id)?.name ?? "Produto desconhecido", [products]);
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
    return sales.filter(s => s.sellerId === id && s.type === "retirada_funcionario").reduce((sum, s) => sum + s.totalPrice, 0);
  }, [sales]);

  const getSellerPaid = useCallback((id: string) => {
    return sellerDebtPayments.filter(p => p.sellerId === id).reduce((sum, p) => sum + p.amount, 0);
  }, [sellerDebtPayments]);

  const getSellerBalance = useCallback((id: string) => {
    return Math.max(0, getSellerDebt(id) - getSellerPaid(id));
  }, [getSellerDebt, getSellerPaid]);

  return (
    <StoreContext.Provider value={{
      products, stockEntries, sales, expenses, investors, dividends, partners, sellers, productAssignments, sellerDebtPayments, loading,
      addProduct, updateProduct, deleteProduct,
      addStockEntry, deleteStockEntry, addSale, updateSale, deleteSale,
      addExpense, deleteExpense,
      addInvestor, updateInvestor, deleteInvestor,
      addDividend, deleteDividend,
      addPartner, updatePartner, deletePartner,
      addSeller, updateSeller, deleteSeller, addProductAssignment, deleteProductAssignment,
      addSellerDebtPayment, deleteSellerDebtPayment, getSellerName,
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
