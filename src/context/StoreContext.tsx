import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Product, StockEntry, Sale, Expense, Investor, Dividend } from "@/types";

interface StoreContextType {
  products: Product[];
  stockEntries: StockEntry[];
  sales: Sale[];
  expenses: Expense[];
  investors: Investor[];
  dividends: Dividend[];
  addProduct: (p: Omit<Product, "id" | "createdAt" | "stock">) => void;
  updateProduct: (id: string, p: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  addStockEntry: (e: Omit<StockEntry, "id" | "totalCost">) => void;
  addSale: (s: Omit<Sale, "id" | "totalPrice">) => void;
  addExpense: (e: Omit<Expense, "id">) => void;
  deleteExpense: (id: string) => void;
  addInvestor: (i: Omit<Investor, "id" | "createdAt" | "totalReturn">) => void;
  updateInvestor: (id: string, i: Partial<Investor>) => void;
  deleteInvestor: (id: string) => void;
  addDividend: (d: Omit<Dividend, "id">) => void;
  deleteDividend: (id: string) => void;
  getTotalRevenue: () => number;
  getTotalCosts: () => number;
  getTotalExpenses: () => number;
  getTotalInvested: () => number;
  getNetProfit: () => number;
  getProductName: (id: string) => string;
  getInvestorName: (id: string) => string;
  getPaidToInvestor: (id: string) => number;
  getRemainingForInvestor: (id: string) => number;
}

const StoreContext = createContext<StoreContextType | null>(null);

function load<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function save(key: string, data: unknown) {
  localStorage.setItem(key, JSON.stringify(data));
}

const uid = () => crypto.randomUUID();

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>(() => load("pods_products", []));
  const [stockEntries, setStockEntries] = useState<StockEntry[]>(() => load("pods_stock_entries", []));
  const [sales, setSales] = useState<Sale[]>(() => load("pods_sales", []));
  const [expenses, setExpenses] = useState<Expense[]>(() => load("pods_expenses", []));
  const [investors, setInvestors] = useState<Investor[]>(() => load("pods_investors", []));
  const [dividends, setDividends] = useState<Dividend[]>(() => load("pods_dividends", []));

  useEffect(() => save("pods_products", products), [products]);
  useEffect(() => save("pods_stock_entries", stockEntries), [stockEntries]);
  useEffect(() => save("pods_sales", sales), [sales]);
  useEffect(() => save("pods_expenses", expenses), [expenses]);
  useEffect(() => save("pods_investors", investors), [investors]);
  useEffect(() => save("pods_dividends", dividends), [dividends]);

  const addProduct = useCallback((p: Omit<Product, "id" | "createdAt" | "stock">) => {
    setProducts(prev => [...prev, { ...p, id: uid(), stock: 0, createdAt: new Date().toISOString() }]);
  }, []);

  const updateProduct = useCallback((id: string, updates: Partial<Product>) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const deleteProduct = useCallback((id: string) => {
    setProducts(prev => prev.filter(p => p.id !== id));
  }, []);

  const addStockEntry = useCallback((e: Omit<StockEntry, "id" | "totalCost">) => {
    const entry: StockEntry = { ...e, id: uid(), totalCost: e.quantity * e.unitCost };
    setStockEntries(prev => [...prev, entry]);
    setProducts(prev => prev.map(p => p.id === e.productId ? { ...p, stock: p.stock + e.quantity, purchasePrice: e.unitCost } : p));
  }, []);

  const addSale = useCallback((s: Omit<Sale, "id" | "totalPrice">) => {
    const sale: Sale = { ...s, id: uid(), totalPrice: s.quantity * s.unitPrice };
    setSales(prev => [...prev, sale]);
    setProducts(prev => prev.map(p => p.id === s.productId ? { ...p, stock: Math.max(0, p.stock - s.quantity), salePrice: s.unitPrice } : p));
  }, []);

  const addExpense = useCallback((e: Omit<Expense, "id">) => {
    setExpenses(prev => [...prev, { ...e, id: uid() }]);
  }, []);

  const deleteExpense = useCallback((id: string) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
  }, []);

  const addInvestor = useCallback((i: Omit<Investor, "id" | "createdAt" | "totalReturn">) => {
    const totalReturn = i.investedAmount * (1 + i.returnPercentage / 100);
    setInvestors(prev => [...prev, { ...i, id: uid(), totalReturn, createdAt: new Date().toISOString() }]);
  }, []);

  const updateInvestor = useCallback((id: string, updates: Partial<Investor>) => {
    setInvestors(prev => prev.map(i => {
      if (i.id !== id) return i;
      const updated = { ...i, ...updates };
      // Recalculate totalReturn if amount or percentage changed
      if (updates.investedAmount !== undefined || updates.returnPercentage !== undefined) {
        updated.totalReturn = updated.investedAmount * (1 + updated.returnPercentage / 100);
      }
      return updated;
    }));
  }, []);

  const deleteInvestor = useCallback((id: string) => {
    setInvestors(prev => prev.filter(i => i.id !== id));
  }, []);

  const addDividend = useCallback((d: Omit<Dividend, "id">) => {
    setDividends(prev => [...prev, { ...d, id: uid() }]);
  }, []);

  const deleteDividend = useCallback((id: string) => {
    setDividends(prev => prev.filter(d => d.id !== id));
  }, []);

  const getTotalRevenue = useCallback(() => sales.reduce((sum, s) => sum + s.totalPrice, 0), [sales]);
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

  return (
    <StoreContext.Provider value={{
      products, stockEntries, sales, expenses, investors, dividends,
      addProduct, updateProduct, deleteProduct,
      addStockEntry, addSale,
      addExpense, deleteExpense,
      addInvestor, updateInvestor, deleteInvestor,
      addDividend, deleteDividend,
      getTotalRevenue, getTotalCosts, getTotalExpenses, getTotalInvested, getNetProfit,
      getProductName, getInvestorName, getPaidToInvestor, getRemainingForInvestor,
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
