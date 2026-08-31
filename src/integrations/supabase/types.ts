export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      commission_payments: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          notes: string | null
          seller_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          seller_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_payments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          id: string
          name: string
          whatsapp: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          whatsapp: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          whatsapp?: string
        }
        Relationships: []
      }
      deleted_products: {
        Row: {
          brand: string
          deleted_at: string
          deleted_by: string | null
          flavor: string
          id: string
          model: string
          name: string
          original_created_at: string | null
          original_id: string
          purchase_price: number
          sale_price: number
          stock: number
        }
        Insert: {
          brand?: string
          deleted_at?: string
          deleted_by?: string | null
          flavor?: string
          id?: string
          model?: string
          name?: string
          original_created_at?: string | null
          original_id: string
          purchase_price?: number
          sale_price?: number
          stock?: number
        }
        Update: {
          brand?: string
          deleted_at?: string
          deleted_by?: string | null
          flavor?: string
          id?: string
          model?: string
          name?: string
          original_created_at?: string | null
          original_id?: string
          purchase_price?: number
          sale_price?: number
          stock?: number
        }
        Relationships: []
      }
      dividends: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          investor_id: string
          notes: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          date?: string
          id?: string
          investor_id: string
          notes?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          investor_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dividends_investor_id_fkey"
            columns: ["investor_id"]
            isOneToOne: false
            referencedRelation: "investors"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          date: string
          description: string
          id: string
        }
        Insert: {
          amount: number
          category?: string
          created_at?: string
          date?: string
          description: string
          id?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          date?: string
          description?: string
          id?: string
        }
        Relationships: []
      }
      investors: {
        Row: {
          created_at: string
          id: string
          invested_amount: number
          name: string
          return_percentage: number
          total_return: number
        }
        Insert: {
          created_at?: string
          id?: string
          invested_amount?: number
          name: string
          return_percentage?: number
          total_return?: number
        }
        Update: {
          created_at?: string
          id?: string
          invested_amount?: number
          name?: string
          return_percentage?: number
          total_return?: number
        }
        Relationships: []
      }
      loan_payments: {
        Row: {
          created_at: string
          date: string
          id: string
          interest_amount: number
          loan_id: string
          notes: string | null
          principal_amount: number
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          interest_amount?: number
          loan_id: string
          notes?: string | null
          principal_amount?: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          interest_amount?: number
          loan_id?: string
          notes?: string | null
          principal_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "loan_payments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          created_at: string
          id: string
          interest_amount: number
          lender_name: string
          notes: string | null
          principal: number
          received_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          interest_amount?: number
          lender_name: string
          notes?: string | null
          principal: number
          received_date?: string
        }
        Update: {
          created_at?: string
          id?: string
          interest_amount?: number
          lender_name?: string
          notes?: string | null
          principal?: number
          received_date?: string
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          sale_id: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity: number
          sale_id?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          sale_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          confirmed_at: string | null
          created_at: string
          customer_id: string
          freight_notes: string | null
          id: string
          seller_id: string
          status: string
          total_amount: number
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          customer_id: string
          freight_notes?: string | null
          id?: string
          seller_id: string
          status?: string
          total_amount?: number
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          customer_id?: string
          freight_notes?: string | null
          id?: string
          seller_id?: string
          status?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_contributions: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          notes: string | null
          partner_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          partner_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_contributions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_payments: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          month: string
          notes: string | null
          partner_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          month: string
          notes?: string | null
          partner_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          month?: string
          notes?: string | null
          partner_id?: string
        }
        Relationships: []
      }
      partners: {
        Row: {
          created_at: string
          id: string
          monthly_pro_labore: number
          name: string
          percentage: number
        }
        Insert: {
          created_at?: string
          id?: string
          monthly_pro_labore?: number
          name: string
          percentage?: number
        }
        Update: {
          created_at?: string
          id?: string
          monthly_pro_labore?: number
          name?: string
          percentage?: number
        }
        Relationships: []
      }
      pro_labore_payments: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          notes: string | null
          partner_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          partner_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pro_labore_payments_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      product_assignments: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity: number
          seller_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity?: number
          seller_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_assignments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_assignments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string
          created_at: string
          flavor: string
          id: string
          image_url: string | null
          min_stock: number
          model: string
          name: string
          purchase_price: number
          sale_price: number
          stock: number
        }
        Insert: {
          brand?: string
          created_at?: string
          flavor?: string
          id?: string
          image_url?: string | null
          min_stock?: number
          model?: string
          name: string
          purchase_price?: number
          sale_price?: number
          stock?: number
        }
        Update: {
          brand?: string
          created_at?: string
          flavor?: string
          id?: string
          image_url?: string | null
          min_stock?: number
          model?: string
          name?: string
          purchase_price?: number
          sale_price?: number
          stock?: number
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          brand: string
          created_at: string
          expected_quantity: number
          id: string
          model: string
          purchase_order_id: string
          received_flavors: Json
          unit_price: number
          updated_at: string
        }
        Insert: {
          brand?: string
          created_at?: string
          expected_quantity?: number
          id?: string
          model?: string
          purchase_order_id: string
          received_flavors?: Json
          unit_price?: number
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          expected_quantity?: number
          id?: string
          model?: string
          purchase_order_id?: string
          received_flavors?: Json
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          date: string
          freight_cost: number
          id: string
          notes: string | null
          number: number
          paid_amount: number
          received_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date?: string
          freight_cost?: number
          id?: string
          notes?: string | null
          number?: number
          paid_amount?: number
          received_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          freight_cost?: number
          id?: string
          notes?: string | null
          number?: number
          paid_amount?: number
          received_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales: {
        Row: {
          created_at: string
          date: string
          id: string
          installments: number
          notes: string | null
          paid_amount: number
          paid_at: string | null
          payment_method: string | null
          product_id: string
          quantity: number
          seller_id: string | null
          total_price: number
          type: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          installments?: number
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_method?: string | null
          product_id: string
          quantity: number
          seller_id?: string | null
          total_price: number
          type?: string
          unit_price: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          installments?: number
          notes?: string | null
          paid_amount?: number
          paid_at?: string | null
          payment_method?: string | null
          product_id?: string
          quantity?: number
          seller_id?: string | null
          total_price?: number
          type?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_debt_payments: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          notes: string | null
          sale_id: string | null
          seller_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          sale_id?: string | null
          seller_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          sale_id?: string | null
          seller_id?: string
        }
        Relationships: []
      }
      seller_manual_debts: {
        Row: {
          amount: number
          created_at: string
          date: string
          id: string
          notes: string | null
          seller_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          seller_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          seller_id?: string
        }
        Relationships: []
      }
      sellers: {
        Row: {
          created_at: string
          debt_percentage: number
          id: string
          name: string
          user_id: string | null
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          debt_percentage?: number
          id?: string
          name: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          debt_percentage?: number
          id?: string
          name?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      stock_entries: {
        Row: {
          created_at: string
          date: string
          id: string
          notes: string | null
          product_id: string
          quantity: number
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          total_cost: number
          unit_cost: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_entries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_losses: {
        Row: {
          created_at: string
          date: string
          id: string
          product_id: string
          quantity: number
          reason: string | null
          seller_id: string | null
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          product_id: string
          quantity: number
          reason?: string | null
          seller_id?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          product_id?: string
          quantity?: number
          reason?: string | null
          seller_id?: string | null
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_losses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_losses_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      financial_events: {
        Row: {
          accumulated_profit_delta: number | null
          amount: number | null
          cash_delta: number | null
          created_at: string | null
          description: string | null
          distributed_profit_delta: number | null
          event_date: string | null
          id: string | null
          inventory_delta: number | null
          kind: string | null
          loan_delta: number | null
          notes: string | null
          partner_capital_delta: number | null
          receivable_delta: number | null
          ref_id: string | null
          ref_table: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      confirm_order: { Args: { p_order_id: string }; Returns: undefined }
      create_pending_order: {
        Args: {
          p_customer_name: string
          p_customer_whatsapp: string
          p_freight_notes: string
          p_items: Json
          p_seller_id: string
        }
        Returns: string
      }
      create_sale: {
        Args: {
          p_date: string
          p_installments?: number
          p_notes?: string
          p_paid_amount?: number
          p_payment_method?: string
          p_product_id: string
          p_quantity: number
          p_seller_id?: string
          p_type?: string
          p_unit_price: number
        }
        Returns: {
          created_at: string
          date: string
          id: string
          installments: number
          notes: string | null
          paid_amount: number
          paid_at: string | null
          payment_method: string | null
          product_id: string
          quantity: number
          seller_id: string | null
          total_price: number
          type: string
          unit_price: number
        }
        SetofOptions: {
          from: "*"
          to: "sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_order: { Args: { p_order_id: string }; Returns: undefined }
      decrement_product_stock: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: number
      }
      delete_sale: { Args: { p_sale_id: string }; Returns: undefined }
      get_my_seller_id: { Args: never; Returns: string }
      get_product_costs: {
        Args: never
        Returns: {
          product_id: string
          purchase_price: number
        }[]
      }
      get_public_catalog: {
        Args: never
        Returns: {
          brand: string
          flavor: string
          id: string
          model: string
          name: string
          stock: number
        }[]
      }
      get_seller_catalog: {
        Args: { p_seller_id: string }
        Returns: {
          available: number
          brand: string
          flavor: string
          image_url: string
          model: string
          name: string
          product_id: string
          sale_price: number
          seller_name: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_product_stock: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "seller"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "seller"],
    },
  },
} as const
