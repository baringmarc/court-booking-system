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
      booking_changes: {
        Row: {
          booking_id: string
          changed_at: string
          changed_by: string | null
          continuation_id: string | null
          id: string
          new_court_id: string
          new_during: unknown
          old_court_id: string
          old_during: unknown
          reason: string
        }
        Insert: {
          booking_id: string
          changed_at?: string
          changed_by?: string | null
          continuation_id?: string | null
          id?: string
          new_court_id: string
          new_during: unknown
          old_court_id: string
          old_during: unknown
          reason: string
        }
        Update: {
          booking_id?: string
          changed_at?: string
          changed_by?: string | null
          continuation_id?: string | null
          id?: string
          new_court_id?: string
          new_during?: unknown
          old_court_id?: string
          old_during?: unknown
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_changes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_changes_continuation_id_fkey"
            columns: ["continuation_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_changes_new_court_id_fkey"
            columns: ["new_court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_changes_old_court_id_fkey"
            columns: ["old_court_id"]
            isOneToOne: false
            referencedRelation: "courts"
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
          parent_booking_id: string | null
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
          parent_booking_id?: string | null
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
          parent_booking_id?: string | null
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
            foreignKeyName: "bookings_parent_booking_id_fkey"
            columns: ["parent_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
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
      court_photos: {
        Row: {
          court_id: string
          created_at: string
          id: string
          path: string
          sort_order: number
        }
        Insert: {
          court_id: string
          created_at?: string
          id?: string
          path: string
          sort_order: number
        }
        Update: {
          court_id?: string
          created_at?: string
          id?: string
          path?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "court_photos_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
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
          sort_order?: number
          sport?: Database["public"]["Enums"]["sport"]
          updated_at?: string
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          attempts: number
          booking_id: string
          change_id: string | null
          created_at: string
          data: Json
          for_guest: boolean
          id: string
          kind: Database["public"]["Enums"]["email_kind"]
          last_error: string | null
          locked_until: string | null
          next_attempt_at: string
          payment_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["email_status"]
          to_email: string
        }
        Insert: {
          attempts?: number
          booking_id: string
          change_id?: string | null
          created_at?: string
          data: Json
          for_guest: boolean
          id?: string
          kind: Database["public"]["Enums"]["email_kind"]
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          payment_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          to_email: string
        }
        Update: {
          attempts?: number
          booking_id?: string
          change_id?: string | null
          created_at?: string
          data?: Json
          for_guest?: boolean
          id?: string
          kind?: Database["public"]["Enums"]["email_kind"]
          last_error?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          payment_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_status"]
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbox_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_change_id_fkey"
            columns: ["change_id"]
            isOneToOne: false
            referencedRelation: "booking_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbox_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      open_play_courts: {
        Row: {
          court_id: string
          during: unknown
          session_id: string
        }
        Insert: {
          court_id: string
          during: unknown
          session_id: string
        }
        Update: {
          court_id?: string
          during?: unknown
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_play_courts_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_play_courts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "open_play_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      open_play_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          details: string
          ends_at: string
          id: string
          links: Json
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          details?: string
          ends_at: string
          id?: string
          links?: Json
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          details?: string
          ends_at?: string
          id?: string
          links?: Json
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_play_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          provider_checkout_id: string | null
          provider_event_id: string | null
          provider_payment_id: string | null
          provider_source: string | null
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
          provider_checkout_id?: string | null
          provider_event_id?: string | null
          provider_payment_id?: string | null
          provider_source?: string | null
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
          provider_checkout_id?: string | null
          provider_event_id?: string | null
          provider_payment_id?: string | null
          provider_source?: string | null
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
      paymongo_checkouts: {
        Row: {
          amount_centavos: number
          booking_id: string
          checkout_id: string
          checkout_url: string
          created_at: string
        }
        Insert: {
          amount_centavos: number
          booking_id: string
          checkout_id: string
          checkout_url: string
          created_at?: string
        }
        Update: {
          amount_centavos?: number
          booking_id?: string
          checkout_id?: string
          checkout_url?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paymongo_checkouts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
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
      venue_amenities: {
        Row: {
          builtin_key: string | null
          created_at: string
          custom_name: string | null
          id: string
        }
        Insert: {
          builtin_key?: string | null
          created_at?: string
          custom_name?: string | null
          id?: string
        }
        Update: {
          builtin_key?: string | null
          created_at?: string
          custom_name?: string | null
          id?: string
        }
        Relationships: []
      }
      venue_info_sections: {
        Row: {
          body: string
          created_at: string
          id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      venue_payment_accounts: {
        Row: {
          account_name: string
          account_number: string
          created_at: string
          id: string
          label: string
          position: number
          qr_path: string | null
          updated_at: string
        }
        Insert: {
          account_name?: string
          account_number?: string
          created_at?: string
          id?: string
          label: string
          position?: number
          qr_path?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_number?: string
          created_at?: string
          id?: string
          label?: string
          position?: number
          qr_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      venue_settings: {
        Row: {
          address: string
          banner_alt: string | null
          banner_path: string | null
          booking_window_days: number
          cancel_cutoff_hours: number
          currency: string
          id: boolean
          maps_query: string
          maps_url: string
          max_rejections: number
          name: string
          payment_hold_minutes: number
          payment_instructions: string
          slot_minutes: number
          sport_order: Database["public"]["Enums"]["sport"][]
          theme: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string
          banner_alt?: string | null
          banner_path?: string | null
          booking_window_days?: number
          cancel_cutoff_hours?: number
          currency?: string
          id?: boolean
          maps_query?: string
          maps_url?: string
          max_rejections?: number
          name: string
          payment_hold_minutes?: number
          payment_instructions?: string
          slot_minutes?: number
          sport_order?: Database["public"]["Enums"]["sport"][]
          theme?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string
          banner_alt?: string | null
          banner_path?: string | null
          booking_window_days?: number
          cancel_cutoff_hours?: number
          currency?: string
          id?: boolean
          maps_query?: string
          maps_url?: string
          max_rejections?: number
          name?: string
          payment_hold_minutes?: number
          payment_instructions?: string
          slot_minutes?: number
          sport_order?: Database["public"]["Enums"]["sport"][]
          theme?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      venue_social_links: {
        Row: {
          platform: Database["public"]["Enums"]["venue_social_platform"]
          updated_at: string
          url: string
        }
        Insert: {
          platform: Database["public"]["Enums"]["venue_social_platform"]
          updated_at?: string
          url: string
        }
        Update: {
          platform?: Database["public"]["Enums"]["venue_social_platform"]
          updated_at?: string
          url?: string
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
      claim_email_outbox: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          booking_id: string
          booking_status: Database["public"]["Enums"]["booking_status"]
          data: Json
          for_guest: boolean
          id: string
          kind: Database["public"]["Enums"]["email_kind"]
          to_email: string
        }[]
      }
      claim_guest_bookings: { Args: never; Returns: number }
      claim_guest_link_email: {
        Args: { p_reference_code: string; p_token: string }
        Returns: {
          attempts: number
          booking_id: string
          data: Json
          id: string
          reference_code: string
          to_email: string
        }[]
      }
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
      create_open_play: {
        Args: {
          p_court_ids: string[]
          p_details?: string
          p_end: string
          p_links?: Json
          p_start: string
          p_title: string
        }
        Returns: string
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
      delete_court: { Args: { p_court_id: string }; Returns: undefined }
      delete_open_play: { Args: { p_id: string }; Returns: undefined }
      finish_email: {
        Args: { p_error?: string; p_id: string; p_outcome: string }
        Returns: Database["public"]["Enums"]["email_status"]
      }
      get_availability: {
        Args: { p_court_id?: string; p_date: string }
        Returns: {
          block_key: string
          booker_first_name: string
          court_id: string
          open_play_session_id: string
          price: number
          slot_end: string
          slot_start: string
          status: string
        }[]
      }
      get_earnings: { Args: { p_from: string; p_to: string }; Returns: Json }
      get_guest_booking: {
        Args: { p_reference_code: string; p_token: string }
        Returns: {
          cancel_reason: string
          cancelled_at: string
          cancelled_by_venue: boolean
          changes: Json
          continuations: Json
          court_id: string
          court_name: string
          created_at: string
          expires_at: string
          guest_email: string
          guest_name: string
          id: string
          parent_reference_code: string
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
      move_court: {
        Args: { p_court_id: string; p_direction: number }
        Returns: undefined
      }
      move_info_section: {
        Args: { p_direction: number; p_id: string }
        Returns: undefined
      }
      paymongo_checkout_for: {
        Args: { p_booking_id: string }
        Returns: {
          checkout_id: string
          checkout_url: string
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
      record_paymongo_checkout: {
        Args: {
          p_amount_centavos: number
          p_booking_id: string
          p_checkout_id: string
          p_checkout_url: string
        }
        Returns: {
          checkout_id: string
          checkout_url: string
        }[]
      }
      record_paymongo_payment: {
        Args: {
          p_amount_centavos: number
          p_booking_id?: string
          p_checkout_id: string
          p_currency: string
          p_event_id: string
          p_payment_id: string
          p_source: string
        }
        Returns: {
          outcome: string
          payment_id: string
        }[]
      }
      reorder_court_photos: {
        Args: { p_court_id: string; p_ids: string[] }
        Returns: undefined
      }
      reorder_courts: {
        Args: { p_ids: string[]; p_sport: Database["public"]["Enums"]["sport"] }
        Returns: undefined
      }
      reorder_info_sections: { Args: { p_ids: string[] }; Returns: undefined }
      reorder_payment_accounts: {
        Args: { p_ids: string[] }
        Returns: undefined
      }
      reschedule_booking: {
        Args: {
          p_booking_id: string
          p_from_start: string
          p_new_court_id: string
          p_new_start: string
          p_reason: string
        }
        Returns: {
          change_id: string
          continuation_id: string
          continuation_reference: string
        }[]
      }
      review_payment: {
        Args: { p_approve: boolean; p_booking_id: string; p_note?: string }
        Returns: {
          status: Database["public"]["Enums"]["booking_status"]
        }[]
      }
      set_operating_hours: { Args: { p_hours: Json }; Returns: undefined }
      update_open_play: {
        Args: {
          p_court_ids: string[]
          p_details?: string
          p_end: string
          p_id: string
          p_links?: Json
          p_start: string
          p_title: string
        }
        Returns: string
      }
    }
    Enums: {
      booking_source: "online" | "walk_in" | "moved"
      booking_status:
        | "pending_payment"
        | "payment_submitted"
        | "confirmed"
        | "expired"
        | "rejected"
        | "cancelled"
      email_kind:
        | "booking_created"
        | "payment_confirmed"
        | "proof_rejected"
        | "booking_cancelled"
        | "booking_rescheduled"
      email_status: "pending" | "sending" | "sent" | "skipped" | "failed"
      payment_method: "gcash" | "maya" | "bank_transfer" | "cash" | "paymongo"
      payment_review_status: "pending" | "approved" | "rejected"
      sport: "badminton" | "pickleball" | "basketball" | "tennis"
      user_role: "player" | "admin"
      venue_social_platform:
        | "facebook"
        | "instagram"
        | "tiktok"
        | "youtube"
        | "x"
        | "messenger"
        | "website"
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
      booking_source: ["online", "walk_in", "moved"],
      booking_status: [
        "pending_payment",
        "payment_submitted",
        "confirmed",
        "expired",
        "rejected",
        "cancelled",
      ],
      email_kind: [
        "booking_created",
        "payment_confirmed",
        "proof_rejected",
        "booking_cancelled",
        "booking_rescheduled",
      ],
      email_status: ["pending", "sending", "sent", "skipped", "failed"],
      payment_method: ["gcash", "maya", "bank_transfer", "cash", "paymongo"],
      payment_review_status: ["pending", "approved", "rejected"],
      sport: ["badminton", "pickleball", "basketball", "tennis"],
      user_role: ["player", "admin"],
      venue_social_platform: [
        "facebook",
        "instagram",
        "tiktok",
        "youtube",
        "x",
        "messenger",
        "website",
      ],
    },
  },
} as const
