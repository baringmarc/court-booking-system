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
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      blackouts: {
        Row: {
          court_id: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          reason: string
          starts_at: string
        }
        Insert: {
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          reason?: string
          starts_at: string
        }
        Update: {
          court_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          reason?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blackouts_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blackouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_venue: boolean
          court_id: string
          created_at: string
          created_by: string | null
          during: unknown
          expires_at: string | null
          guest_email: string | null
          guest_name: string
          guest_phone: string | null
          guest_token_hash: string | null
          id: string
          reference_code: string
          rejection_count: number
          source: Database["public"]["Enums"]["booking_source"]
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_venue?: boolean
          court_id: string
          created_at?: string
          created_by?: string | null
          during: unknown
          expires_at?: string | null
          guest_email?: string | null
          guest_name: string
          guest_phone?: string | null
          guest_token_hash?: string | null
          id?: string
          reference_code: string
          rejection_count?: number
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_venue?: boolean
          court_id?: string
          created_at?: string
          created_by?: string | null
          during?: unknown
          expires_at?: string | null
          guest_email?: string | null
          guest_name?: string
          guest_phone?: string | null
          guest_token_hash?: string | null
          id?: string
          reference_code?: string
          rejection_count?: number
          source?: Database["public"]["Enums"]["booking_source"]
          status?: Database["public"]["Enums"]["booking_status"]
          total_amount?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      court_rates: {
        Row: {
          court_id: string
          day_of_week: number
          price: number
          start_hour: number
        }
        Insert: {
          court_id: string
          day_of_week: number
          price: number
          start_hour: number
        }
        Update: {
          court_id?: string
          day_of_week?: number
          price?: number
          start_hour?: number
        }
        Relationships: [
          {
            foreignKeyName: "court_rates_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          created_at: string
          default_hourly_rate: number
          description: string
          id: string
          is_active: boolean
          name: string
          photo_path: string | null
          sort_order: number
          sport: Database["public"]["Enums"]["sport"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_hourly_rate: number
          description?: string
          id?: string
          is_active?: boolean
          name: string
          photo_path?: string | null
          sort_order?: number
          sport: Database["public"]["Enums"]["sport"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_hourly_rate?: number
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          photo_path?: string | null
          sort_order?: number
          sport?: Database["public"]["Enums"]["sport"]
          updated_at?: string
        }
        Relationships: []
      }
      operating_hours: {
        Row: {
          close_time: string
          day_of_week: number
          is_closed: boolean
          open_time: string
        }
        Insert: {
          close_time: string
          day_of_week: number
          is_closed?: boolean
          open_time: string
        }
        Update: {
          close_time?: string
          day_of_week?: number
          is_closed?: boolean
          open_time?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          booking_id: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string | null
          reference_number: string | null
          review_note: string | null
          review_status: Database["public"]["Enums"]["payment_review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          storage_path: string | null
          submitted_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number?: string | null
          review_note?: string | null
          review_status?: Database["public"]["Enums"]["payment_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          storage_path?: string | null
          submitted_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number?: string | null
          review_note?: string | null
          review_status?: Database["public"]["Enums"]["payment_review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          storage_path?: string | null
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      venue_settings: {
        Row: {
          banner_alt: string | null
          banner_path: string | null
          booking_window_days: number
          cancel_cutoff_hours: number
          currency: string
          id: boolean
          max_rejections: number
          name: string
          payment_hold_minutes: number
          payment_instructions: string
          slot_minutes: number
          timezone: string
          updated_at: string
        }
        Insert: {
          banner_alt?: string | null
          banner_path?: string | null
          booking_window_days?: number
          cancel_cutoff_hours?: number
          currency?: string
          id?: boolean
          max_rejections?: number
          name: string
          payment_hold_minutes?: number
          payment_instructions?: string
          slot_minutes?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          banner_alt?: string | null
          banner_path?: string | null
          booking_window_days?: number
          cancel_cutoff_hours?: number
          currency?: string
          id?: boolean
          max_rejections?: number
          name?: string
          payment_hold_minutes?: number
          payment_instructions?: string
          slot_minutes?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_booking: {
        Args: {
          p_booking_id?: string
          p_reason?: string
          p_reference_code?: string
          p_token?: string
        }
        Returns: Database["public"]["Enums"]["booking_status"]
      }
      claim_guest_bookings: { Args: never; Returns: number }
      create_booking: {
        Args: {
          p_court_id: string
          p_guest_email?: string
          p_guest_name?: string
          p_guest_phone?: string
          p_slots: number
          p_start: string
        }
        Returns: {
          guest_token: string
          id: string
          reference_code: string
        }[]
      }
      create_walk_in: {
        Args: {
          p_amount?: number
          p_court_id: string
          p_method?: Database["public"]["Enums"]["payment_method"]
          p_name: string
          p_phone?: string
          p_reference_number?: string
          p_slots: number
          p_start: string
        }
        Returns: {
          id: string
          reference_code: string
        }[]
      }
      get_availability: {
        Args: { p_court_id?: string; p_date: string }
        Returns: {
          court_id: string
          price: number
          slot_end: string
          slot_start: string
          status: string
        }[]
      }
      get_guest_booking: {
        Args: { p_reference_code: string; p_token: string }
        Returns: {
          cancel_reason: string
          cancelled_at: string
          cancelled_by_venue: boolean
          court_id: string
          court_name: string
          created_at: string
          expires_at: string
          guest_email: string
          guest_name: string
          id: string
          payment_instructions: string
          payments: Json
          reference_code: string
          rejection_count: number
          slot_end: string
          slot_start: string
          sport: Database["public"]["Enums"]["sport"]
          status: Database["public"]["Enums"]["booking_status"]
          total_amount: number
        }[]
      }
      proof_target: {
        Args: { p_reference_code: string; p_token: string; p_user_id: string }
        Returns: {
          booking_id: string
          total_amount: number
        }[]
      }
      record_payment_proof: {
        Args: {
          p_amount: number
          p_booking_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_reference_number?: string
          p_storage_path: string
        }
        Returns: {
          payment_id: string
        }[]
      }
      review_payment: {
        Args: { p_approve: boolean; p_booking_id: string; p_note?: string }
        Returns: {
          status: Database["public"]["Enums"]["booking_status"]
        }[]
      }
    }
    Enums: {
      booking_source: "online" | "walk_in"
      booking_status:
        | "pending_payment"
        | "payment_submitted"
        | "confirmed"
        | "expired"
        | "rejected"
        | "cancelled"
      payment_method: "gcash" | "maya" | "bank_transfer" | "cash"
      payment_review_status: "pending" | "approved" | "rejected"
      sport: "badminton" | "pickleball" | "basketball" | "tennis"
      user_role: "player" | "admin"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      booking_source: ["online", "walk_in"],
      booking_status: [
        "pending_payment",
        "payment_submitted",
        "confirmed",
        "expired",
        "rejected",
        "cancelled",
      ],
      payment_method: ["gcash", "maya", "bank_transfer", "cash"],
      payment_review_status: ["pending", "approved", "rejected"],
      sport: ["badminton", "pickleball", "basketball", "tennis"],
      user_role: ["player", "admin"],
    },
  },
} as const
