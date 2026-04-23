export interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  createdAt: string;
}

export interface StockEntry {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  date: string;
  notes?: string;
}

export type SaleType = "venda" | "retirada_funcionario";

export interface Sale {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  date: string;
  notes?: string;
  installments: number;
  paidAmount: number;
  sellerId?: string;
  type: SaleType;
}

export interface SellerDebtPayment {
  id: string;
  sellerId: string;
  saleId?: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number;
  date: string;
}

export interface Investor {
  id: string;
  name: string;
  investedAmount: number;
  returnPercentage: number;
  totalReturn: number; // investedAmount * (1 + returnPercentage/100)
  createdAt: string;
}

export interface Dividend {
  id: string;
  investorId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface Partner {
  id: string;
  name: string;
  percentage: number;
  createdAt: string;
}

export interface Seller {
  id: string;
  name: string;
  debtPercentage: number;
  createdAt: string;
}

export interface ProductAssignment {
  id: string;
  sellerId: string;
  productId: string;
  quantity: number;
  notes?: string;
  createdAt: string;
}
