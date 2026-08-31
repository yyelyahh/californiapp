export interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  flavor: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  imageUrl?: string;
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
export type PaymentMethod =
  | "pix"
  | "dinheiro"
  | "pix_pendente"
  | "dinheiro_pendente"
  | "dinheiro_com_vendedor"
  | "pendente";

export interface StockLoss {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  reason?: string;
  sellerId?: string;
  date: string;

}

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
  /** Data em que a venda foi efetivamente recebida (quitada). */
  paidAt?: string;
  sellerId?: string;
  type: SaleType;
  paymentMethod?: PaymentMethod;
}

export interface SellerDebtPayment {
  id: string;
  sellerId: string;
  saleId?: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface SellerManualDebt {
  id: string;
  sellerId: string;
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
  monthlyProLabore: number;
  createdAt: string;
}

export interface CommissionPayment {
  id: string;
  sellerId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface ProLaborePayment {
  id: string;
  partnerId: string;
  amount: number;
  date: string;
  notes?: string;
}

export interface PartnerPayment {
  id: string;
  partnerId: string;
  month: string; // YYYY-MM
  amount: number;
  date: string;
  notes?: string;
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

// ---- Novo modelo financeiro (contabilidade simplificada) ----

export interface PartnerContribution {
  id: string;
  partnerId: string;
  amount: number;
  date: string;
  notes?: string;
  createdAt: string;
}

export interface Loan {
  id: string;
  lenderName: string;
  principal: number;
  interestAmount: number;
  receivedDate: string;
  notes?: string;
  createdAt: string;
}

export interface LoanPayment {
  id: string;
  loanId: string;
  principalAmount: number;
  interestAmount: number;
  date: string;
  notes?: string;
  createdAt: string;
}

export type FinancialEventKind =
  | "partner_contribution"
  | "loan_received"
  | "loan_payment"
  | "stock_purchase"
  | "sale"
  | "sale_cogs"
  | "expense"
  | "withdrawal"
  | "commission_paid"
  | "stock_loss";

export interface FinancialEvent {
  id: string;
  kind: FinancialEventKind;
  date: string;
  createdAt: string;
  description: string;
  amount: number;
  cashDelta: number;
  inventoryDelta: number;
  receivableDelta: number;
  loanDelta: number;
  partnerCapitalDelta: number;
  accumulatedProfitDelta: number;
  distributedProfitDelta: number;
  refTable: string;
  refId: string;
  notes?: string;
}

// ---- Compras aguardando recebimento (registro logístico, sem impacto em estoque) ----
export type PurchaseOrderStatus = "pending" | "received";

export interface ReceivedFlavor {
  flavor: string;
  quantity: number;
}

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  brand: string;
  model: string;
  expectedQuantity: number;
  unitPrice: number;
  receivedFlavors: ReceivedFlavor[];
}

export interface PurchaseOrder {
  id: string;
  number: number;
  status: PurchaseOrderStatus;
  date: string;
  notes?: string;
  paidAmount: number;
  freightCost: number;
  receivedAt?: string;
  createdAt: string;
  items: PurchaseOrderItem[];
}

export interface PurchaseReceiptItemInput {
  itemId: string;
  unitCost: number;
  salePrice?: number;
  flavors: ReceivedFlavor[];
}
