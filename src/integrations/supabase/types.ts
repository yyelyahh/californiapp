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
      archived_models: {
        Row: {
          archived_at: string
          branch_id: string
          brand: string
          brand_key: string
          model: string
          model_key: string
        }
        Insert: {
          archived_at?: string
          branch_id: string
          brand: string
          brand_key: string
          model: string
          model_key: string
        }
        Update: {
          archived_at?: string
          branch_id?: string
          brand?: string
          brand_key?: string
          model?: string
          model_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "archived_models_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_name: string | null
          actor_source: string
          at: string
          changed_fields: string[] | null
          entity: string
          entity_id: string | null
          id: string
          old_data: Json | null
          row_data: Json
          tx: number
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_source: string
          at?: string
          changed_fields?: string[] | null
          entity: string
          entity_id?: string | null
          id?: string
          old_data?: Json | null
          row_data: Json
          tx?: number
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_name?: string | null
          actor_source?: string
          at?: string
          changed_fields?: string[] | null
          entity?: string
          entity_id?: string | null
          id?: string
          old_data?: Json | null
          row_data?: Json
          tx?: number
        }
        Relationships: []
      }
      branches: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
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
          branch_id: string
          category: string
          created_at: string
          date: string
          description: string
          id: string
        }
        Insert: {
          amount: number
          branch_id: string
          category?: string
          created_at?: string
          date?: string
          description: string
          id?: string
        }
        Update: {
          amount?: number
          branch_id?: string
          category?: string
          created_at?: string
          date?: string
          description?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
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
          client_token: string | null
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
          client_token?: string | null
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
          client_token?: string | null
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
      product_branch: {
        Row: {
          branch_id: string
          created_at: string
          min_stock: number
          product_id: string
          purchase_price: number
          sale_price: number
          stock: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          min_stock?: number
          product_id: string
          purchase_price?: number
          sale_price?: number
          stock?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          min_stock?: number
          product_id?: string
          purchase_price?: number
          sale_price?: number
          stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_branch_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_branch_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_model_images: {
        Row: {
          brand: string
          created_at: string
          id: string
          image_url: string
          model: string
        }
        Insert: {
          brand: string
          created_at?: string
          id?: string
          image_url: string
          model?: string
        }
        Update: {
          brand?: string
          created_at?: string
          id?: string
          image_url?: string
          model?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand: string
          created_at: string
          flavor: string
          id: string
          image_url: string | null
          model: string
          name: string
        }
        Insert: {
          brand?: string
          created_at?: string
          flavor?: string
          id?: string
          image_url?: string | null
          model?: string
          name: string
        }
        Update: {
          brand?: string
          created_at?: string
          flavor?: string
          id?: string
          image_url?: string | null
          model?: string
          name?: string
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
          branch_id: string
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
          branch_id: string
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
          branch_id?: string
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
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
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
          branch_id: string
          created_at: string
          debt_percentage: number
          id: string
          name: string
          slug: string | null
          user_id: string | null
          whatsapp: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          debt_percentage?: number
          id?: string
          name: string
          slug?: string | null
          user_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          debt_percentage?: number
          id?: string
          name?: string
          slug?: string | null
          user_id?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sellers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_entries: {
        Row: {
          branch_id: string
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
          branch_id: string
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
          branch_id?: string
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
            foreignKeyName: "stock_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
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
          branch_id: string
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
          branch_id: string
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
          branch_id?: string
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
            foreignKeyName: "stock_losses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
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
      stock_transfers: {
        Row: {
          batch_id: string | null
          created_at: string
          date: string
          from_branch_id: string
          from_seller_id: string | null
          id: string
          notes: string | null
          product_id: string
          quantity: number
          to_branch_id: string
          unit_cost: number
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          date?: string
          from_branch_id: string
          from_seller_id?: string | null
          id?: string
          notes?: string | null
          product_id: string
          quantity: number
          to_branch_id: string
          unit_cost?: number
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          date?: string
          from_branch_id?: string
          from_seller_id?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number
          to_branch_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_seller_id_fkey"
            columns: ["from_seller_id"]
            isOneToOne: false
            referencedRelation: "sellers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_branches: {
        Row: {
          branch_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_display_names: {
        Row: {
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          branch_id: string | null
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
      combo_discount: { Args: never; Returns: number }
      combo_min_units: { Args: never; Returns: number }
      combo_unit_price: {
        Args: { p_purchase_price: number; p_sale_price: number }
        Returns: number
      }
      confirm_order: {
        Args: {
          p_notes?: string
          p_order_id: string
          p_payment_method?: string
        }
        Returns: undefined
      }
      create_pending_order: {
        Args: {
          p_client_token?: string
          p_customer_name: string
          p_customer_whatsapp: string
          p_freight_notes: string
          p_items: Json
          p_seller_id: string
        }
        Returns: Json
      }
      create_sale: {
        Args: {
          p_branch_id?: string
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
          branch_id: string
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
      customer_units: { Args: { p_whatsapp: string }; Returns: number }
      decline_order: { Args: { p_order_id: string }; Returns: undefined }
      decrement_product_stock: {
        Args: { p_branch_id: string; p_product_id: string; p_quantity: number }
        Returns: number
      }
      delete_sale: { Args: { p_sale_id: string }; Returns: undefined }
      expire_stale_orders: { Args: never; Returns: number }
      get_branch_products: {
        Args: { p_branch_id?: string }
        Returns: {
          brand: string
          created_at: string
          flavor: string
          id: string
          image_url: string
          min_stock: number
          model: string
          name: string
          price_varies: boolean
          sale_price: number
          stock: number
        }[]
      }
      get_customer_loyalty: {
        Args: { p_whatsapp: string }
        Returns: {
          customer_name: string
          cycle_units: number
          discounts_used: number
          loyalty_tier: string
          total_units: number
          units_until_next_discount: number
        }[]
      }
      get_my_seller_id: { Args: never; Returns: string }
      get_product_costs: {
        Args: { p_branch_id?: string }
        Returns: {
          product_id: string
          purchase_price: number
        }[]
      }
      get_seller_by_slug: { Args: { p_slug: string }; Returns: string }
      get_seller_catalog: {
        Args: { p_seller_id: string }
        Returns: {
          available: number
          brand: string
          combo_price: number
          flavor: string
          image_url: string
          loyalty_price: number
          model: string
          name: string
          product_id: string
          sale_price: number
          seller_name: string
        }[]
      }
      get_store_rules: {
        Args: never
        Returns: {
          combo_discount: number
          combo_min_units: number
          loyalty_cycle: number
          reservation_hours: number
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
        Args: { p_branch_id: string; p_product_id: string; p_quantity: number }
        Returns: number
      }
      loyalty_cycle: { Args: never; Returns: number }
      loyalty_unit_price: {
        Args: { p_purchase_price: number; p_sale_price: number }
        Returns: number
      }
      my_branch_ids: { Args: never; Returns: string[] }
      order_receipt: { Args: { p_order_id: string }; Returns: Json }
      order_reservation_ttl: { Args: never; Returns: string }
      product_model_key: {
        Args: { p_brand: string; p_id: string; p_model: string }
        Returns: string
      }
      set_model_image: {
        Args: { p_brand: string; p_image_url: string; p_model: string }
        Returns: undefined
      }
      transfer_branch_stock: {
        Args: {
          p_batch_id?: string
          p_date?: string
          p_from_branch_id: string
          p_from_seller_id?: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_to_branch_id: string
        }
        Returns: {
          batch_id: string | null
          created_at: string
          date: string
          from_branch_id: string
          from_seller_id: string | null
          id: string
          notes: string | null
          product_id: string
          quantity: number
          to_branch_id: string
          unit_cost: number
        }
        SetofOptions: {
          from: "*"
          to: "stock_transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transfer_branch_stock_batch: {
        Args: {
          p_date?: string
          p_from_branch_id: string
          p_items: Json
          p_notes?: string
          p_to_branch_id: string
        }
        Returns: {
          batch_id: string | null
          created_at: string
          date: string
          from_branch_id: string
          from_seller_id: string | null
          id: string
          notes: string | null
          product_id: string
          quantity: number
          to_branch_id: string
          unit_cost: number
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_transfers"
          isOneToOne: false
          isSetofReturn: true
        }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
