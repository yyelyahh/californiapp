export interface Product {
  id: string;
  name: string;
  brand: string;
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

export interface Sale {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
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
  sharePercentage: number;
  createdAt: string;
}

export interface Dividend {
  id: string;
  investorId: string;
  amount: number;
  month: string;
  paid: boolean;
  paidAt?: string;
}
