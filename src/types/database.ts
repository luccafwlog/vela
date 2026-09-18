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
      agency_departure_report_department_signoffs: {
        Row: {
          department: string
          id: string
          report_id: string
          signed_at: string | null
          signed_by: string | null
        }
        Insert: {
          department: string
          id?: string
          report_id: string
          signed_at?: string | null
          signed_by?: string | null
        }
        Update: {
          department?: string
          id?: string
          report_id?: string
          signed_at?: string | null
          signed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_report_department_signoffs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "agency_departure_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_departure_report_occurrences: {
        Row: {
          author_id: string
          body: string
          created_at: string
          department: string
          id: string
          report_id: string
          section: string | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          department: string
          id?: string
          report_id: string
          section?: string | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          department?: string
          id?: string
          report_id?: string
          section?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_report_occurrences_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "agency_departure_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_departure_report_signoffs: {
        Row: {
          department: string
          id: string
          observation: string | null
          report_id: string
          section: string
          signed_at: string | null
          signed_by: string | null
          state: string
        }
        Insert: {
          department: string
          id?: string
          observation?: string | null
          report_id: string
          section: string
          signed_at?: string | null
          signed_by?: string | null
          state?: string
        }
        Update: {
          department?: string
          id?: string
          observation?: string | null
          report_id?: string
          section?: string
          signed_at?: string | null
          signed_by?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_report_signoffs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "agency_departure_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_departure_reports: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closed_snapshot: Json | null
          created_at: string
          id: string
          port: string
          status: string
          terminal: string | null
          terminal_id: string | null
          terminal_port_id: number | null
          voyage_id: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closed_snapshot?: Json | null
          created_at?: string
          id?: string
          port: string
          status?: string
          terminal?: string | null
          terminal_id?: string | null
          terminal_port_id?: number | null
          voyage_id: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closed_snapshot?: Json | null
          created_at?: string
          id?: string
          port?: string
          status?: string
          terminal?: string | null
          terminal_id?: string | null
          terminal_port_id?: number | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "agency_departure_reports_terminal_port_fk"
            columns: ["terminal_id", "terminal_port_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id", "port_id"]
          },
          {
            foreignKeyName: "agency_departure_reports_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      agency_report_pending_baselines: {
        Row: {
          baseline_key: string
          captured_at: string
        }
        Insert: {
          baseline_key: string
          captured_at: string
        }
        Update: {
          baseline_key?: string
          captured_at?: string
        }
        Relationships: []
      }
      alert_item_dismissals: {
        Row: {
          alert_item_id: number
          dismissed_at: string
          dismissed_by: string
          id: number
          occurrence_id: string
          reason: string
          review_at: string
        }
        Insert: {
          alert_item_id: number
          dismissed_at?: string
          dismissed_by: string
          id?: number
          occurrence_id: string
          reason: string
          review_at: string
        }
        Update: {
          alert_item_id?: number
          dismissed_at?: string
          dismissed_by?: string
          id?: number
          occurrence_id?: string
          reason?: string
          review_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_item_dismissals_alert_item_id_fkey"
            columns: ["alert_item_id"]
            isOneToOne: false
            referencedRelation: "alert_items"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_item_events: {
        Row: {
          actor_id: string | null
          alert_item_id: number
          created_at: string
          event_type: string
          id: number
          metadata: Json
          new_status: string
          occurrence_id: string
          previous_status: string | null
        }
        Insert: {
          actor_id?: string | null
          alert_item_id: number
          created_at?: string
          event_type: string
          id?: number
          metadata?: Json
          new_status: string
          occurrence_id: string
          previous_status?: string | null
        }
        Update: {
          actor_id?: string | null
          alert_item_id?: number
          created_at?: string
          event_type?: string
          id?: number
          metadata?: Json
          new_status?: string
          occurrence_id?: string
          previous_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_item_events_alert_item_id_fkey"
            columns: ["alert_item_id"]
            isOneToOne: false
            referencedRelation: "alert_items"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_items: {
        Row: {
          alert_id: number
          created_at: string
          department: string | null
          destination: string | null
          id: number
          item_type: string
          message: string
          metadata: Json
          occurrence_id: string
          resolved_at: string | null
          severity: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          alert_id: number
          created_at?: string
          department?: string | null
          destination?: string | null
          id?: number
          item_type: string
          message: string
          metadata?: Json
          occurrence_id?: string
          resolved_at?: string | null
          severity: string
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          alert_id?: number
          created_at?: string
          department?: string | null
          destination?: string | null
          id?: number
          item_type?: string
          message?: string
          metadata?: Json
          occurrence_id?: string
          resolved_at?: string | null
          severity?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_items_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_items_item_type_fkey"
            columns: ["item_type"]
            isOneToOne: false
            referencedRelation: "alert_type_catalog"
            referencedColumns: ["type"]
          },
        ]
      }
      alert_notification_failures: {
        Row: {
          alert_id: number | null
          alert_item_id: number | null
          created_at: string
          department: string
          event_id: number | null
          id: number
          item_type: string
          reason: string
        }
        Insert: {
          alert_id?: number | null
          alert_item_id?: number | null
          created_at?: string
          department: string
          event_id?: number | null
          id?: number
          item_type: string
          reason: string
        }
        Update: {
          alert_id?: number | null
          alert_item_id?: number | null
          created_at?: string
          department?: string
          event_id?: number | null
          id?: number
          item_type?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_notification_failures_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_notification_failures_alert_item_id_fkey"
            columns: ["alert_item_id"]
            isOneToOne: false
            referencedRelation: "alert_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_notification_failures_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "alert_item_events"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_type_catalog: {
        Row: {
          active: boolean
          audience_departments: string[]
          created_at: string
          default_destination: string | null
          responsible_department: string | null
          severity: string
          type: string
        }
        Insert: {
          active?: boolean
          audience_departments?: string[]
          created_at?: string
          default_destination?: string | null
          responsible_department?: string | null
          severity: string
          type: string
        }
        Update: {
          active?: boolean
          audience_departments?: string[]
          created_at?: string
          default_destination?: string | null
          responsible_department?: string | null
          severity?: string
          type?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: number
          message: string
          notified_at: string | null
          status: string
          type: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          message: string
          notified_at?: string | null
          status?: string
          type: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          message?: string
          notified_at?: string | null
          status?: string
          type?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          communications_enabled: boolean
          created_at: string
          demurrage_dunning_interval_days: number
          id: number
        }
        Insert: {
          communications_enabled?: boolean
          created_at?: string
          demurrage_dunning_interval_days?: number
          id?: number
        }
        Update: {
          communications_enabled?: boolean
          created_at?: string
          demurrage_dunning_interval_days?: number
          id?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          actor_department: string | null
          actor_role: string | null
          changed_at: string | null
          changed_by: string | null
          entity_id: string
          entity_type: string
          field_name: string
          id: number
          justification: string | null
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          actor_department?: string | null
          actor_role?: string | null
          changed_at?: string | null
          changed_by?: string | null
          entity_id: string
          entity_type: string
          field_name: string
          id?: number
          justification?: string | null
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          actor_department?: string | null
          actor_role?: string | null
          changed_at?: string | null
          changed_by?: string | null
          entity_id?: string
          entity_type?: string
          field_name?: string
          id?: number
          justification?: string | null
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      baplie_containers: {
        Row: {
          bl_ref: string | null
          container_number: string
          final_dest: string | null
          id: number
          imo_class: string | null
          imported_at: string
          imported_by: string | null
          is_imo: boolean
          is_oog: boolean
          pod: string | null
          pol: string | null
          size_type: string | null
          slot: string | null
          status: string | null
          un_number: string | null
          voyage_id: number
          weight_kg: number | null
        }
        Insert: {
          bl_ref?: string | null
          container_number: string
          final_dest?: string | null
          id?: never
          imo_class?: string | null
          imported_at?: string
          imported_by?: string | null
          is_imo?: boolean
          is_oog?: boolean
          pod?: string | null
          pol?: string | null
          size_type?: string | null
          slot?: string | null
          status?: string | null
          un_number?: string | null
          voyage_id: number
          weight_kg?: number | null
        }
        Update: {
          bl_ref?: string | null
          container_number?: string
          final_dest?: string | null
          id?: never
          imo_class?: string | null
          imported_at?: string
          imported_by?: string | null
          is_imo?: boolean
          is_oog?: boolean
          pod?: string | null
          pol?: string | null
          size_type?: string | null
          slot?: string | null
          status?: string | null
          un_number?: string | null
          voyage_id?: number
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "baplie_containers_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      baplie_reconciliation_resolutions: {
        Row: {
          baplie_value: string
          bl_container_id: number
          field_name: string
          id: number
          manifest_value: string
          resolution: string
          resolved_at: string
          resolved_by: string | null
          voyage_id: number
        }
        Insert: {
          baplie_value: string
          bl_container_id: number
          field_name: string
          id?: never
          manifest_value: string
          resolution?: string
          resolved_at?: string
          resolved_by?: string | null
          voyage_id: number
        }
        Update: {
          baplie_value?: string
          bl_container_id?: number
          field_name?: string
          id?: never
          manifest_value?: string
          resolution?: string
          resolved_at?: string
          resolved_by?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "baplie_reconciliation_resolutions_bl_container_id_fkey"
            columns: ["bl_container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "baplie_reconciliation_resolutions_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_batches: {
        Row: {
          created_at: string
          customer_id: number
          id: number
          invoice_id: number | null
          notes: string | null
          origin: string
          portal_account_id: number | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: number
          id?: number
          invoice_id?: number | null
          notes?: string | null
          origin?: string
          portal_account_id?: number | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: number
          id?: number
          invoice_id?: number | null
          notes?: string | null
          origin?: string
          portal_account_id?: number | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_batches_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_batches_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_batches_portal_account_id_fkey"
            columns: ["portal_account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_run_logs: {
        Row: {
          billing_run_id: number
          bl_id: string | null
          code: string
          created_at: string
          details: Json
          id: number
          level: string
          manifest_id: number
          message: string
        }
        Insert: {
          billing_run_id: number
          bl_id?: string | null
          code: string
          created_at?: string
          details?: Json
          id?: number
          level?: string
          manifest_id: number
          message: string
        }
        Update: {
          billing_run_id?: number
          bl_id?: string | null
          code?: string
          created_at?: string
          details?: Json
          id?: number
          level?: string
          manifest_id?: number
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_run_logs_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_run_logs_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_run_logs_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_runs: {
        Row: {
          blocked_bls: number
          calculated_bls: number
          completed_at: string | null
          created_at: string
          eligible_bls: number
          id: number
          input_hash: string | null
          manifest_id: number
          requested_by: string | null
          started_at: string
          status: string
          summary: Json
          total_bls: number
          total_brl: number
          total_usd: number
          trigger_source: string
        }
        Insert: {
          blocked_bls?: number
          calculated_bls?: number
          completed_at?: string | null
          created_at?: string
          eligible_bls?: number
          id?: number
          input_hash?: string | null
          manifest_id: number
          requested_by?: string | null
          started_at?: string
          status?: string
          summary?: Json
          total_bls?: number
          total_brl?: number
          total_usd?: number
          trigger_source?: string
        }
        Update: {
          blocked_bls?: number
          calculated_bls?: number
          completed_at?: string | null
          created_at?: string
          eligible_bls?: number
          id?: number
          input_hash?: string | null
          manifest_id?: number
          requested_by?: string | null
          started_at?: string
          status?: string
          summary?: Json
          total_bls?: number
          total_brl?: number
          total_usd?: number
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_runs_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_breakbulk_items: {
        Row: {
          bl_id: string
          cbm: number | null
          created_at: string | null
          gross_weight_kg: number | null
          id: number
          item_description: string
          marks: string | null
          package_qty: number | null
          package_unit: string | null
        }
        Insert: {
          bl_id: string
          cbm?: number | null
          created_at?: string | null
          gross_weight_kg?: number | null
          id?: number
          item_description: string
          marks?: string | null
          package_qty?: number | null
          package_unit?: string | null
        }
        Update: {
          bl_id?: string
          cbm?: number | null
          created_at?: string | null
          gross_weight_kg?: number | null
          id?: number
          item_description?: string
          marks?: string | null
          package_qty?: number | null
          package_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_breakbulk_items_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_containers: {
        Row: {
          bl_id: string
          cbm: number | null
          container_number: string
          created_at: string | null
          demurrage_status: string | null
          discharge_date: string | null
          gross_weight_kg: number | null
          id: number
          imo_class: string | null
          is_imo: boolean | null
          is_oog: boolean | null
          return_date: string | null
          seal_number: string | null
          tare_weight_kg: number | null
          type: string | null
          un_number: string | null
          unpacking_location: string | null
        }
        Insert: {
          bl_id: string
          cbm?: number | null
          container_number: string
          created_at?: string | null
          demurrage_status?: string | null
          discharge_date?: string | null
          gross_weight_kg?: number | null
          id?: number
          imo_class?: string | null
          is_imo?: boolean | null
          is_oog?: boolean | null
          return_date?: string | null
          seal_number?: string | null
          tare_weight_kg?: number | null
          type?: string | null
          un_number?: string | null
          unpacking_location?: string | null
        }
        Update: {
          bl_id?: string
          cbm?: number | null
          container_number?: string
          created_at?: string | null
          demurrage_status?: string | null
          discharge_date?: string | null
          gross_weight_kg?: number | null
          id?: number
          imo_class?: string | null
          is_imo?: boolean | null
          is_oog?: boolean | null
          return_date?: string | null
          seal_number?: string | null
          tare_weight_kg?: number | null
          type?: string | null
          un_number?: string | null
          unpacking_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_containers_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_freight_lines: {
        Row: {
          amount: number | null
          bl_id: string
          category: string | null
          currency: string | null
          description: string | null
          mercante_code: string | null
          payment: string | null
          seq: number
        }
        Insert: {
          amount?: number | null
          bl_id: string
          category?: string | null
          currency?: string | null
          description?: string | null
          mercante_code?: string | null
          payment?: string | null
          seq: number
        }
        Update: {
          amount?: number | null
          bl_id?: string
          category?: string | null
          currency?: string | null
          description?: string | null
          mercante_code?: string | null
          payment?: string | null
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "bl_freight_lines_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_receivables: {
        Row: {
          balance_brl: number
          bl_id: string
          cargo_mode: string | null
          created_at: string
          customer_id: number
          id: number
          original_amount_brl: number
          pod: string | null
          pol: string | null
          roe_effective_date_frozen: string | null
          roe_frozen: number | null
          settled_amount_brl: number
          source: string
          status: string
          updated_at: string
          voyage_id: number | null
        }
        Insert: {
          balance_brl?: number
          bl_id: string
          cargo_mode?: string | null
          created_at?: string
          customer_id: number
          id?: number
          original_amount_brl?: number
          pod?: string | null
          pol?: string | null
          roe_effective_date_frozen?: string | null
          roe_frozen?: number | null
          settled_amount_brl?: number
          source?: string
          status?: string
          updated_at?: string
          voyage_id?: number | null
        }
        Update: {
          balance_brl?: number
          bl_id?: string
          cargo_mode?: string | null
          created_at?: string
          customer_id?: number
          id?: number
          original_amount_brl?: number
          pod?: string | null
          pol?: string | null
          roe_effective_date_frozen?: string | null
          roe_frozen?: number | null
          settled_amount_brl?: number
          source?: string
          status?: string
          updated_at?: string
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bl_receivables_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_receivables_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_receivables_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      bl_transshipments: {
        Row: {
          bl_id: string
          created_at: string
          created_by: string | null
          disposition: string
          id: number
          omission_id: number
          updated_at: string
        }
        Insert: {
          bl_id: string
          created_at?: string
          created_by?: string | null
          disposition?: string
          id?: number
          omission_id: number
          updated_at?: string
        }
        Update: {
          bl_id?: string
          created_at?: string
          created_by?: string | null
          disposition?: string
          id?: number
          omission_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bl_transshipments_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bl_transshipments_omission_id_fkey"
            columns: ["omission_id"]
            isOneToOne: false
            referencedRelation: "voyage_omissions"
            referencedColumns: ["id"]
          },
        ]
      }
      bls: {
        Row: {
          batch_id: number | null
          bb_cbm: number | null
          bb_machine_qty: number | null
          bb_packages_qty: number | null
          bb_packages_total: number | null
          bb_weight_ton: number | null
          billing_hold_reason: string | null
          bl_emission_date: string | null
          cargo_description: string | null
          cargo_mode: string
          ce_mercante: string | null
          charge_exemption_reason: string | null
          charge_status: string | null
          charges_calculated_at: string | null
          charges_reviewed_at: string | null
          consignee: string | null
          consignee_address: string | null
          consignee_block: string | null
          consignee_phone: string | null
          container_load_type: string | null
          created_at: string | null
          customer_id: number | null
          customer_reconciliation_notes: string | null
          customer_reconciliation_status: string | null
          demurrage_rate_override_p1_usd: number | null
          demurrage_rate_override_p2_usd: number | null
          demurrage_roe: number | null
          demurrage_roe_manual: boolean | null
          financial_status: string | null
          free_time_override: number | null
          id: string
          incoterm: string | null
          issue_place: string | null
          last_billing_run_id: number | null
          manifest_customer_cnpj_cpf: string | null
          manifest_customer_email: string | null
          manifest_customer_name: string | null
          manifesto_mercante_id: string | null
          movement_from: string | null
          movement_to: string | null
          ncm_codes: string[]
          notes: string | null
          notify_block: string | null
          notify_cnpj_cpf: string | null
          notify_party: string | null
          notify2_block: string | null
          packages_unit: string | null
          payment_type: string | null
          place_of_delivery: string | null
          place_of_receipt: string | null
          pod: string | null
          pod_port_id: number | null
          pol: string | null
          review_status: string | null
          shipper: string | null
          shipper_block: string | null
          suggested_customer_id: number | null
          terminal_id: string | null
          total_cbm: number | null
          total_packages: number | null
          total_weight_kg: number | null
          updated_at: string | null
          voyage_id: number
        }
        Insert: {
          batch_id?: number | null
          bb_cbm?: number | null
          bb_machine_qty?: number | null
          bb_packages_qty?: number | null
          bb_packages_total?: number | null
          bb_weight_ton?: number | null
          billing_hold_reason?: string | null
          bl_emission_date?: string | null
          cargo_description?: string | null
          cargo_mode?: string
          ce_mercante?: string | null
          charge_exemption_reason?: string | null
          charge_status?: string | null
          charges_calculated_at?: string | null
          charges_reviewed_at?: string | null
          consignee?: string | null
          consignee_address?: string | null
          consignee_block?: string | null
          consignee_phone?: string | null
          container_load_type?: string | null
          created_at?: string | null
          customer_id?: number | null
          customer_reconciliation_notes?: string | null
          customer_reconciliation_status?: string | null
          demurrage_rate_override_p1_usd?: number | null
          demurrage_rate_override_p2_usd?: number | null
          demurrage_roe?: number | null
          demurrage_roe_manual?: boolean | null
          financial_status?: string | null
          free_time_override?: number | null
          id: string
          incoterm?: string | null
          issue_place?: string | null
          last_billing_run_id?: number | null
          manifest_customer_cnpj_cpf?: string | null
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          manifesto_mercante_id?: string | null
          movement_from?: string | null
          movement_to?: string | null
          ncm_codes?: string[]
          notes?: string | null
          notify_block?: string | null
          notify_cnpj_cpf?: string | null
          notify_party?: string | null
          notify2_block?: string | null
          packages_unit?: string | null
          payment_type?: string | null
          place_of_delivery?: string | null
          place_of_receipt?: string | null
          pod?: string | null
          pod_port_id?: number | null
          pol?: string | null
          review_status?: string | null
          shipper?: string | null
          shipper_block?: string | null
          suggested_customer_id?: number | null
          terminal_id?: string | null
          total_cbm?: number | null
          total_packages?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
          voyage_id: number
        }
        Update: {
          batch_id?: number | null
          bb_cbm?: number | null
          bb_machine_qty?: number | null
          bb_packages_qty?: number | null
          bb_packages_total?: number | null
          bb_weight_ton?: number | null
          billing_hold_reason?: string | null
          bl_emission_date?: string | null
          cargo_description?: string | null
          cargo_mode?: string
          ce_mercante?: string | null
          charge_exemption_reason?: string | null
          charge_status?: string | null
          charges_calculated_at?: string | null
          charges_reviewed_at?: string | null
          consignee?: string | null
          consignee_address?: string | null
          consignee_block?: string | null
          consignee_phone?: string | null
          container_load_type?: string | null
          created_at?: string | null
          customer_id?: number | null
          customer_reconciliation_notes?: string | null
          customer_reconciliation_status?: string | null
          demurrage_rate_override_p1_usd?: number | null
          demurrage_rate_override_p2_usd?: number | null
          demurrage_roe?: number | null
          demurrage_roe_manual?: boolean | null
          financial_status?: string | null
          free_time_override?: number | null
          id?: string
          incoterm?: string | null
          issue_place?: string | null
          last_billing_run_id?: number | null
          manifest_customer_cnpj_cpf?: string | null
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          manifesto_mercante_id?: string | null
          movement_from?: string | null
          movement_to?: string | null
          ncm_codes?: string[]
          notes?: string | null
          notify_block?: string | null
          notify_cnpj_cpf?: string | null
          notify_party?: string | null
          notify2_block?: string | null
          packages_unit?: string | null
          payment_type?: string | null
          place_of_delivery?: string | null
          place_of_receipt?: string | null
          pod?: string | null
          pod_port_id?: number | null
          pol?: string | null
          review_status?: string | null
          shipper?: string | null
          shipper_block?: string | null
          suggested_customer_id?: number | null
          terminal_id?: string | null
          total_cbm?: number | null
          total_packages?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bls_manifesto_mercante_id_fkey"
            columns: ["manifesto_mercante_id"]
            isOneToOne: false
            referencedRelation: "manifestos_mercante"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_last_billing_run_id_fkey"
            columns: ["last_billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_suggested_customer_id_fkey"
            columns: ["suggested_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bls_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          created_at: string | null
          id: number
          name: string
          scac: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
          scac?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
          scac?: string | null
        }
        Relationships: []
      }
      charge_calculations: {
        Row: {
          billing_run_id: number | null
          bl_id: string | null
          calculated_at: string | null
          calculation_key: string | null
          charge_item_id: number | null
          charge_table_id: number | null
          container_id: number | null
          created_by: string | null
          id: number
          manifest_id: number | null
          manual_reason: string | null
          notes: string | null
          override_applied: boolean | null
          pricing_rule_version_id: number | null
          quantity: number | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string | null
          status: string | null
          total_value_brl: number | null
          total_value_usd: number | null
          unit_value_brl: number | null
          unit_value_usd: number | null
        }
        Insert: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculated_at?: string | null
          calculation_key?: string | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          container_id?: number | null
          created_by?: string | null
          id?: number
          manifest_id?: number | null
          manual_reason?: string | null
          notes?: string | null
          override_applied?: boolean | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string | null
          status?: string | null
          total_value_brl?: number | null
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Update: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculated_at?: string | null
          calculation_key?: string | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          container_id?: number | null
          created_by?: string | null
          id?: number
          manifest_id?: number | null
          manual_reason?: string | null
          notes?: string | null
          override_applied?: boolean | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string | null
          status?: string | null
          total_value_brl?: number | null
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charge_calculations_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_calculations_pricing_rule_version_id_fkey"
            columns: ["pricing_rule_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_table_items: {
        Row: {
          active: boolean | null
          application_basis: string | null
          applies_to: string
          cargo_profile: string | null
          category: string | null
          charge_table_id: number | null
          container_type: string | null
          created_at: string | null
          currency: string | null
          id: number
          manual_only: boolean | null
          name: string
          sort_order: number | null
          unit_value_brl: number | null
          unit_value_usd: number | null
          value_brl: number
        }
        Insert: {
          active?: boolean | null
          application_basis?: string | null
          applies_to: string
          cargo_profile?: string | null
          category?: string | null
          charge_table_id?: number | null
          container_type?: string | null
          created_at?: string | null
          currency?: string | null
          id?: number
          manual_only?: boolean | null
          name: string
          sort_order?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
          value_brl: number
        }
        Update: {
          active?: boolean | null
          application_basis?: string | null
          applies_to?: string
          cargo_profile?: string | null
          category?: string | null
          charge_table_id?: number | null
          container_type?: string | null
          created_at?: string | null
          currency?: string | null
          id?: number
          manual_only?: boolean | null
          name?: string
          sort_order?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
          value_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "charge_table_items_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_tables: {
        Row: {
          active: boolean | null
          cargo_mode: string | null
          carrier_id: number | null
          created_at: string | null
          id: number
          name: string
          notes: string | null
          pod: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          active?: boolean | null
          cargo_mode?: string | null
          carrier_id?: number | null
          created_at?: string | null
          id?: number
          name: string
          notes?: string | null
          pod?: string | null
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          active?: boolean | null
          cargo_mode?: string | null
          carrier_id?: number | null
          created_at?: string | null
          id?: number
          name?: string
          notes?: string | null
          pod?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "charge_tables_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      cod_adjustments: {
        Row: {
          action: string
          bl_id: string
          created_at: string
          created_by: string | null
          difference_brl: number
          id: number
          manual_review_required: boolean
          new_destination_value_brl: number
          offset_amount_brl: number
          omission_id: number
          original_value_brl: number
          outstanding_balance_brl: number
          paid_amount_brl: number
          refund_amount_brl: number
          resulting_document_id: number | null
          resulting_document_type: string | null
          status: string
        }
        Insert: {
          action: string
          bl_id: string
          created_at?: string
          created_by?: string | null
          difference_brl?: number
          id?: number
          manual_review_required?: boolean
          new_destination_value_brl?: number
          offset_amount_brl?: number
          omission_id: number
          original_value_brl?: number
          outstanding_balance_brl?: number
          paid_amount_brl?: number
          refund_amount_brl?: number
          resulting_document_id?: number | null
          resulting_document_type?: string | null
          status?: string
        }
        Update: {
          action?: string
          bl_id?: string
          created_at?: string
          created_by?: string | null
          difference_brl?: number
          id?: number
          manual_review_required?: boolean
          new_destination_value_brl?: number
          offset_amount_brl?: number
          omission_id?: number
          original_value_brl?: number
          outstanding_balance_brl?: number
          paid_amount_brl?: number
          refund_amount_brl?: number
          resulting_document_id?: number | null
          resulting_document_type?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cod_adjustments_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cod_adjustments_omission_id_fkey"
            columns: ["omission_id"]
            isOneToOne: false
            referencedRelation: "voyage_omissions"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communication_attachments: {
        Row: {
          communication_id: number
          created_at: string
          file_name: string
          id: number
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          communication_id: number
          created_at?: string
          file_name: string
          id?: number
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          communication_id?: number
          created_at?: string
          file_name?: string
          id?: number
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_communication_attachments_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "customer_communications"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communication_attempts: {
        Row: {
          communication_id: number
          created_at: string
          dispatch_mode: string
          id: number
          idempotency_key: string
          last_error: string | null
          provider_message_id: string | null
          recipient_key: string | null
          recipient_masked: string
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          communication_id: number
          created_at?: string
          dispatch_mode?: string
          id?: number
          idempotency_key: string
          last_error?: string | null
          provider_message_id?: string | null
          recipient_key?: string | null
          recipient_masked: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          communication_id?: number
          created_at?: string
          dispatch_mode?: string
          id?: number
          idempotency_key?: string
          last_error?: string | null
          provider_message_id?: string | null
          recipient_key?: string | null
          recipient_masked?: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_communication_attempts_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "customer_communications"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communication_automation_claims: {
        Row: {
          claim_key: string
          claimed_at: string
          released_at: string | null
        }
        Insert: {
          claim_key: string
          claimed_at?: string
          released_at?: string | null
        }
        Update: {
          claim_key?: string
          claimed_at?: string
          released_at?: string | null
        }
        Relationships: []
      }
      customer_communication_bls: {
        Row: {
          bl_id: string
          communication_id: number
        }
        Insert: {
          bl_id: string
          communication_id: number
        }
        Update: {
          bl_id?: string
          communication_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_communication_bls_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_communication_bls_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "customer_communications"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communication_box_kinds: {
        Row: {
          box_code: string
          kind: string
        }
        Insert: {
          box_code: string
          kind: string
        }
        Update: {
          box_code?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_communication_box_kinds_box_code_fkey"
            columns: ["box_code"]
            isOneToOne: false
            referencedRelation: "customer_communication_boxes"
            referencedColumns: ["code"]
          },
        ]
      }
      customer_communication_boxes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      customer_communication_dunning_groups: {
        Row: {
          attempt_discriminator: number
          communication_id: number
          created_at: string
          customer_id: number
          group_key: string
        }
        Insert: {
          attempt_discriminator: number
          communication_id: number
          created_at?: string
          customer_id: number
          group_key: string
        }
        Update: {
          attempt_discriminator?: number
          communication_id?: number
          created_at?: string
          customer_id?: number
          group_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_communication_dunning_groups_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: true
            referencedRelation: "customer_communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_communication_dunning_groups_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communication_dunning_invoices: {
        Row: {
          attempt_discriminator: number
          communication_id: number
          created_at: string
          customer_id: number
          demurrage_invoice_id: number
        }
        Insert: {
          attempt_discriminator: number
          communication_id: number
          created_at?: string
          customer_id: number
          demurrage_invoice_id: number
        }
        Update: {
          attempt_discriminator?: number
          communication_id?: number
          created_at?: string
          customer_id?: number
          demurrage_invoice_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_communication_dunning_invoic_demurrage_invoice_id_fkey"
            columns: ["demurrage_invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_communication_dunning_invoices_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "customer_communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_communication_dunning_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communication_kinds: {
        Row: {
          kind: string
          nature: string
        }
        Insert: {
          kind: string
          nature: string
        }
        Update: {
          kind?: string
          nature?: string
        }
        Relationships: []
      }
      customer_communication_saved_templates: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: number
          name: string
          subject: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: number
          name: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: number
          name?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_communication_suppressions: {
        Row: {
          email: string
          id: number
          reason: string
          suppressed_at: string
        }
        Insert: {
          email: string
          id?: number
          reason?: string
          suppressed_at?: string
        }
        Update: {
          email?: string
          id?: number
          reason?: string
          suppressed_at?: string
        }
        Relationships: []
      }
      customer_communication_templates: {
        Row: {
          body_html_template: string
          body_text_template: string
          created_at: string
          id: number
          kind: string
          subject_template: string
          updated_at: string
        }
        Insert: {
          body_html_template: string
          body_text_template: string
          created_at?: string
          id?: number
          kind: string
          subject_template: string
          updated_at?: string
        }
        Update: {
          body_html_template?: string
          body_text_template?: string
          created_at?: string
          id?: number
          kind?: string
          subject_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_communications: {
        Row: {
          anchor_atracacao_id: string | null
          anchor_invoice_id: number | null
          anchor_port: string | null
          anchor_voyage_id: number | null
          attempt_discriminator: number
          created_at: string
          created_by: string | null
          customer_id: number
          dispatch_id: string | null
          id: number
          kind: string
          nature: string
          origin: string
          status: string
          terminal_name: string | null
          vessel_name: string | null
          voyage_number: string | null
        }
        Insert: {
          anchor_atracacao_id?: string | null
          anchor_invoice_id?: number | null
          anchor_port?: string | null
          anchor_voyage_id?: number | null
          attempt_discriminator?: number
          created_at?: string
          created_by?: string | null
          customer_id: number
          dispatch_id?: string | null
          id?: number
          kind: string
          nature: string
          origin?: string
          status?: string
          terminal_name?: string | null
          vessel_name?: string | null
          voyage_number?: string | null
        }
        Update: {
          anchor_atracacao_id?: string | null
          anchor_invoice_id?: number | null
          anchor_port?: string | null
          anchor_voyage_id?: number | null
          attempt_discriminator?: number
          created_at?: string
          created_by?: string | null
          customer_id?: number
          dispatch_id?: string | null
          id?: number
          kind?: string
          nature?: string
          origin?: string
          status?: string
          terminal_name?: string | null
          vessel_name?: string | null
          voyage_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_communications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_communications_kind_nature_fkey"
            columns: ["kind", "nature"]
            isOneToOne: false
            referencedRelation: "customer_communication_kinds"
            referencedColumns: ["kind", "nature"]
          },
        ]
      }
      customer_contact_box_links: {
        Row: {
          box_code: string
          contact_id: number
          created_at: string
        }
        Insert: {
          box_code: string
          contact_id: number
          created_at?: string
        }
        Update: {
          box_code?: string
          contact_id?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contact_box_links_box_code_fkey"
            columns: ["box_code"]
            isOneToOne: false
            referencedRelation: "customer_communication_boxes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "customer_contact_box_links_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contact_change_events: {
        Row: {
          action_id: string
          actor_id: string | null
          after_snapshot: Json
          before_snapshot: Json
          change_summary: Json
          created_at: string
          customer_id: number
          id: number
          portal_account_id: number | null
          related_bl_id: string | null
          source: string
        }
        Insert: {
          action_id?: string
          actor_id?: string | null
          after_snapshot?: Json
          before_snapshot?: Json
          change_summary?: Json
          created_at?: string
          customer_id: number
          id?: number
          portal_account_id?: number | null
          related_bl_id?: string | null
          source: string
        }
        Update: {
          action_id?: string
          actor_id?: string | null
          after_snapshot?: Json
          before_snapshot?: Json
          change_summary?: Json
          created_at?: string
          customer_id?: number
          id?: number
          portal_account_id?: number | null
          related_bl_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contact_change_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contact_preferences: {
        Row: {
          contact_id: number
          created_at: string
          enabled: boolean
          nature: string
          source: string
        }
        Insert: {
          contact_id: number
          created_at?: string
          enabled?: boolean
          nature: string
          source?: string
        }
        Update: {
          contact_id?: number
          created_at?: string
          enabled?: boolean
          nature?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contact_preferences_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          created_at: string | null
          customer_id: number | null
          deactivated_at: string | null
          email: string | null
          email_normalized: string | null
          id: number
          is_primary: boolean | null
          name: string | null
          origin: string
          phone: string | null
          purpose: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string | null
          customer_id?: number | null
          deactivated_at?: string | null
          email?: string | null
          email_normalized?: string | null
          id?: number
          is_primary?: boolean | null
          name?: string | null
          origin?: string
          phone?: string | null
          purpose?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string | null
          customer_id?: number | null
          deactivated_at?: string | null
          email?: string | null
          email_normalized?: string | null
          id?: number
          is_primary?: boolean | null
          name?: string | null
          origin?: string
          phone?: string | null
          purpose?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_demurrage_agreements: {
        Row: {
          active: boolean
          created_at: string
          customer_id: number
          free_days: number
          id: number
          notes: string | null
          p1_usd: number | null
          p2_usd: number | null
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          customer_id: number
          free_days: number
          id?: number
          notes?: string | null
          p1_usd?: number | null
          p2_usd?: number | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          customer_id?: number
          free_days?: number
          id?: number
          notes?: string | null
          p1_usd?: number | null
          p2_usd?: number | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_demurrage_agreements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_portal_accounts: {
        Row: {
          account_situation: string
          active: boolean
          auth_user_id: string | null
          contact_email: string | null
          created_at: string
          created_by: string | null
          credentials_revoked_at: string | null
          customer_id: number
          id: number
          last_login_at: string | null
          login_cnpj: string | null
          password_hash: string | null
          pending_recovery_email: string | null
          portal_email: string | null
          provisioning_decision: string
          recovery_email: string | null
          recovery_email_source: string | null
          recovery_email_status: string
          updated_at: string
        }
        Insert: {
          account_situation?: string
          active?: boolean
          auth_user_id?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          credentials_revoked_at?: string | null
          customer_id: number
          id?: number
          last_login_at?: string | null
          login_cnpj?: string | null
          password_hash?: string | null
          pending_recovery_email?: string | null
          portal_email?: string | null
          provisioning_decision?: string
          recovery_email?: string | null
          recovery_email_source?: string | null
          recovery_email_status?: string
          updated_at?: string
        }
        Update: {
          account_situation?: string
          active?: boolean
          auth_user_id?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          credentials_revoked_at?: string | null
          customer_id?: number
          id?: number
          last_login_at?: string | null
          login_cnpj?: string | null
          password_hash?: string | null
          pending_recovery_email?: string | null
          portal_email?: string | null
          provisioning_decision?: string
          recovery_email?: string | null
          recovery_email_source?: string | null
          recovery_email_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_portal_sessions: {
        Row: {
          account_id: number
          created_at: string
          customer_id: number
          expires_at: string
          id: number
          last_seen_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          account_id: number
          created_at?: string
          customer_id: number
          expires_at: string
          id?: number
          last_seen_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          account_id?: number
          created_at?: string
          customer_id?: number
          expires_at?: string
          id?: number
          last_seen_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_portal_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_portal_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_rate_overrides: {
        Row: {
          charge_item_id: number | null
          created_at: string | null
          customer_id: number | null
          id: number
          notes: string | null
          override_value: number
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          charge_item_id?: number | null
          created_at?: string | null
          customer_id?: number | null
          id?: number
          notes?: string | null
          override_value: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          charge_item_id?: number | null
          created_at?: string | null
          customer_id?: number | null
          id?: number
          notes?: string | null
          override_value?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_rate_overrides_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_rate_overrides_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_reconciliation_queue: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bl_id: string
          cnpj_cpf: string | null
          created_at: string
          customer_id: number | null
          detection_type: string
          id: number
          manifest_customer_email: string | null
          manifest_customer_name: string | null
          manifest_id: number | null
          notes: string | null
          rejected_at: string | null
          rejected_by: string | null
          resolution_notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bl_id: string
          cnpj_cpf?: string | null
          created_at?: string
          customer_id?: number | null
          detection_type: string
          id?: number
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          manifest_id?: number | null
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bl_id?: string
          cnpj_cpf?: string | null
          created_at?: string
          customer_id?: number | null
          detection_type?: string
          id?: number
          manifest_customer_email?: string | null
          manifest_customer_name?: string | null
          manifest_id?: number | null
          notes?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          resolution_notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_reconciliation_queue_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: true
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reconciliation_queue_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reconciliation_queue_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          cnpj_cpf: string
          created_at: string | null
          id: number
          name: string
          notes: string | null
          pending_balance: number
          state: string | null
          trade_name: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          cnpj_cpf: string
          created_at?: string | null
          id?: number
          name: string
          notes?: string | null
          pending_balance?: number
          state?: string | null
          trade_name?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          cnpj_cpf?: string
          created_at?: string | null
          id?: number
          name?: string
          notes?: string | null
          pending_balance?: number
          state?: string | null
          trade_name?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      demurrage_calculation_snapshots: {
        Row: {
          calculation_version: number
          created_at: string
          created_by: string | null
          demurrage_invoice_id: number
          event_kind: string
          id: number
          input_hash: string
          input_snapshot: Json
          result_snapshot: Json
        }
        Insert: {
          calculation_version?: number
          created_at?: string
          created_by?: string | null
          demurrage_invoice_id: number
          event_kind: string
          id?: never
          input_hash: string
          input_snapshot: Json
          result_snapshot: Json
        }
        Update: {
          calculation_version?: number
          created_at?: string
          created_by?: string | null
          demurrage_invoice_id?: number
          event_kind?: string
          id?: never
          input_hash?: string
          input_snapshot?: Json
          result_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_calculation_snapshots_demurrage_invoice_id_fkey"
            columns: ["demurrage_invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_dispute_attachments: {
        Row: {
          created_at: string
          customer_id: number
          dispute_id: number
          file_name: string
          id: number
          message_id: number
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          customer_id: number
          dispute_id: number
          file_name: string
          id?: number
          message_id: number
          mime_type: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: number
          dispute_id?: number
          file_name?: string
          id?: number
          message_id?: number
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_dispute_attachments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demurrage_dispute_attachments_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "demurrage_disputes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demurrage_dispute_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "demurrage_dispute_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_dispute_messages: {
        Row: {
          author_id: string | null
          author_type: string
          body: string
          created_at: string
          dispute_id: number
          id: number
          metadata: Json
          next_responder: string
        }
        Insert: {
          author_id?: string | null
          author_type: string
          body: string
          created_at?: string
          dispute_id: number
          id?: number
          metadata?: Json
          next_responder: string
        }
        Update: {
          author_id?: string | null
          author_type?: string
          body?: string
          created_at?: string
          dispute_id?: number
          id?: number
          metadata?: Json
          next_responder?: string
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_dispute_messages_dispute_id_fkey"
            columns: ["dispute_id"]
            isOneToOne: false
            referencedRelation: "demurrage_disputes"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_disputes: {
        Row: {
          cancelled_at: string | null
          created_at: string
          customer_id: number
          demurrage_invoice_id: number
          id: number
          next_responder: string
          opened_by: string
          resolved_at: string | null
          state: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          customer_id: number
          demurrage_invoice_id: number
          id?: number
          next_responder?: string
          opened_by: string
          resolved_at?: string | null
          state?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          customer_id?: number
          demurrage_invoice_id?: number
          id?: number
          next_responder?: string
          opened_by?: string
          resolved_at?: string | null
          state?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_disputes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demurrage_disputes_demurrage_invoice_id_fkey"
            columns: ["demurrage_invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_dunning_claims: {
        Row: {
          attempt_discriminator: number
          claimed_at: string
          demurrage_invoice_id: number
          released_at: string | null
        }
        Insert: {
          attempt_discriminator: number
          claimed_at?: string
          demurrage_invoice_id: number
          released_at?: string | null
        }
        Update: {
          attempt_discriminator?: number
          claimed_at?: string
          demurrage_invoice_id?: number
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_dunning_claims_demurrage_invoice_id_fkey"
            columns: ["demurrage_invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_invoice_history: {
        Row: {
          created_at: string
          discount_usd: number
          event_date: string
          id: number
          invoice_id: number
          ptax_used: number | null
          roe_used: number
          source: string
          total_brl: number
          total_usd: number
        }
        Insert: {
          created_at?: string
          discount_usd?: number
          event_date: string
          id?: number
          invoice_id: number
          ptax_used?: number | null
          roe_used: number
          source?: string
          total_brl: number
          total_usd: number
        }
        Update: {
          created_at?: string
          discount_usd?: number
          event_date?: string
          id?: number
          invoice_id?: number
          ptax_used?: number | null
          roe_used?: number
          source?: string
          total_brl?: number
          total_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_invoice_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_invoice_items: {
        Row: {
          container_id: number
          container_number: string
          container_type: string
          created_at: string | null
          days_p1: number
          days_p2: number
          discharge_date: string
          free_days: number
          id: number
          invoice_id: number
          rate_p1_usd: number
          rate_p2_usd: number
          return_date: string
          subtotal_brl: number | null
          subtotal_usd: number
          total_days: number
        }
        Insert: {
          container_id: number
          container_number: string
          container_type: string
          created_at?: string | null
          days_p1?: number
          days_p2?: number
          discharge_date: string
          free_days: number
          id?: number
          invoice_id: number
          rate_p1_usd?: number
          rate_p2_usd?: number
          return_date: string
          subtotal_brl?: number | null
          subtotal_usd: number
          total_days: number
        }
        Update: {
          container_id?: number
          container_number?: string
          container_type?: string
          created_at?: string | null
          days_p1?: number
          days_p2?: number
          discharge_date?: string
          free_days?: number
          id?: number
          invoice_id?: number
          rate_p1_usd?: number
          rate_p2_usd?: number
          return_date?: string
          subtotal_brl?: number | null
          subtotal_usd?: number
          total_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_invoice_items_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demurrage_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_invoices: {
        Row: {
          billed_at: string | null
          bl_id: string
          conciliated_by_extract: boolean | null
          created_at: string | null
          current_roe: number | null
          current_total_brl: number | null
          customer_id: number
          discount_approver: string | null
          discount_justification: string | null
          discount_mode: string | null
          discount_type: string | null
          discount_value: number | null
          dispute_notes: string | null
          dispute_open: boolean | null
          dispute_reason: string | null
          dispute_status: string | null
          dispute_subject: string | null
          doc_date: string | null
          doc_number: string
          due_date: string | null
          first_billed_at: string | null
          id: number
          notes: string | null
          paid_at: string | null
          pix_payload: string | null
          pix_txid: string | null
          ready_at: string | null
          roe: number | null
          roe_manual: boolean | null
          roe_source: string | null
          status: string | null
          total_usd: number
          updated_at: string | null
        }
        Insert: {
          billed_at?: string | null
          bl_id: string
          conciliated_by_extract?: boolean | null
          created_at?: string | null
          current_roe?: number | null
          current_total_brl?: number | null
          customer_id: number
          discount_approver?: string | null
          discount_justification?: string | null
          discount_mode?: string | null
          discount_type?: string | null
          discount_value?: number | null
          dispute_notes?: string | null
          dispute_open?: boolean | null
          dispute_reason?: string | null
          dispute_status?: string | null
          dispute_subject?: string | null
          doc_date?: string | null
          doc_number: string
          due_date?: string | null
          first_billed_at?: string | null
          id?: number
          notes?: string | null
          paid_at?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          ready_at?: string | null
          roe?: number | null
          roe_manual?: boolean | null
          roe_source?: string | null
          status?: string | null
          total_usd?: number
          updated_at?: string | null
        }
        Update: {
          billed_at?: string | null
          bl_id?: string
          conciliated_by_extract?: boolean | null
          created_at?: string | null
          current_roe?: number | null
          current_total_brl?: number | null
          customer_id?: number
          discount_approver?: string | null
          discount_justification?: string | null
          discount_mode?: string | null
          discount_type?: string | null
          discount_value?: number | null
          dispute_notes?: string | null
          dispute_open?: boolean | null
          dispute_reason?: string | null
          dispute_status?: string | null
          dispute_subject?: string | null
          doc_date?: string | null
          doc_number?: string
          due_date?: string | null
          first_billed_at?: string | null
          id?: number
          notes?: string | null
          paid_at?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          ready_at?: string | null
          roe?: number | null
          roe_manual?: boolean | null
          roe_source?: string | null
          status?: string | null
          total_usd?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_invoices_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demurrage_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_mutation_requests: {
        Row: {
          created_at: string
          created_by: string | null
          invoice_id: number
          operation: string
          request_id: string
          request_payload: Json
          result: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          invoice_id: number
          operation: string
          request_id: string
          request_payload: Json
          result: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          invoice_id?: number
          operation?: string
          request_id?: string
          request_payload?: Json
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_mutation_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "demurrage_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_rates: {
        Row: {
          active: boolean
          container_type: string
          created_at: string
          free_days: number
          id: number
          notes: string | null
          p1_day_from: number
          p1_day_to: number
          p1_usd: number
          p2_day_from: number
          p2_usd: number
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          container_type: string
          created_at?: string
          free_days?: number
          id?: number
          notes?: string | null
          p1_day_from: number
          p1_day_to: number
          p1_usd: number
          p2_day_from: number
          p2_usd: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          container_type?: string
          created_at?: string
          free_days?: number
          id?: number
          notes?: string | null
          p1_day_from?: number
          p1_day_to?: number
          p1_usd?: number
          p2_day_from?: number
          p2_usd?: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: []
      }
      depot_services: {
        Row: {
          active: boolean
          condition: string | null
          container_type: string | null
          created_at: string
          depot_id: string
          id: string
          name: string
          natureza: string
          rate_brl: number
          route_destino_id: string | null
        }
        Insert: {
          active?: boolean
          condition?: string | null
          container_type?: string | null
          created_at?: string
          depot_id: string
          id?: string
          name: string
          natureza?: string
          rate_brl?: number
          route_destino_id?: string | null
        }
        Update: {
          active?: boolean
          condition?: string | null
          container_type?: string | null
          created_at?: string
          depot_id?: string
          id?: string
          name?: string
          natureza?: string
          rate_brl?: number
          route_destino_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "depot_services_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depot_services_route_destino_id_fkey"
            columns: ["route_destino_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
        ]
      }
      depots: {
        Row: {
          active: boolean
          code: string
          created_at: string
          free_time_material_days: number
          free_time_vazio_days: number
          id: string
          name: string | null
          port_id: number | null
          tipo: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          free_time_material_days?: number
          free_time_vazio_days?: number
          id?: string
          name?: string | null
          port_id?: number | null
          tipo?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          free_time_material_days?: number
          free_time_vazio_days?: number
          id?: string
          name?: string | null
          port_id?: number | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "depots_port_id_fkey"
            columns: ["port_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
        ]
      }
      ended_vessels: {
        Row: {
          created_at: string
          ended_at: string
          id: string
          imo_number: string | null
          nansha_etd: string | null
          ningbo_etd: string | null
          original_id: string | null
          pecem_eta: string | null
          qingdao_etd: string | null
          salvador_eta: string | null
          shanghai_etd: string | null
          taicang_etd: string | null
          vessel_name: string
          vitoria_eta: string | null
          voyage: string
        }
        Insert: {
          created_at?: string
          ended_at?: string
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          original_id?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          vessel_name: string
          vitoria_eta?: string | null
          voyage: string
        }
        Update: {
          created_at?: string
          ended_at?: string
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          original_id?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          vessel_name?: string
          vitoria_eta?: string | null
          voyage?: string
        }
        Relationships: []
      }
      exchange_rate_reference: {
        Row: {
          effective_date: string
          id: number
          ptax: number | null
          quote_date: string | null
          roe: number
          source: string
          spread_version: number
          updated_at: string
        }
        Insert: {
          effective_date: string
          id?: number
          ptax?: number | null
          quote_date?: string | null
          roe: number
          source?: string
          spread_version?: number
          updated_at?: string
        }
        Update: {
          effective_date?: string
          id?: number
          ptax?: number | null
          quote_date?: string | null
          roe?: number
          source?: string
          spread_version?: number
          updated_at?: string
        }
        Relationships: []
      }
      exchange_rate_reference_history: {
        Row: {
          effective_date: string
          id: number
          metadata: Json
          ptax: number | null
          quote_date: string | null
          recorded_at: string
          recorded_by: string | null
          roe: number
          source: string
          spread_version: number
        }
        Insert: {
          effective_date: string
          id?: never
          metadata?: Json
          ptax?: number | null
          quote_date?: string | null
          recorded_at?: string
          recorded_by?: string | null
          roe: number
          source: string
          spread_version?: number
        }
        Update: {
          effective_date?: string
          id?: never
          metadata?: Json
          ptax?: number | null
          quote_date?: string | null
          recorded_at?: string
          recorded_by?: string | null
          roe?: number
          source?: string
          spread_version?: number
        }
        Relationships: []
      }
      granite_bl_charges: {
        Row: {
          bl_id: string
          calculated_at: string | null
          charge_type: string | null
          currency: string | null
          description: string | null
          id: string
          quantity: number | null
          rate_id: string | null
          subtotal: number | null
          unit_value: number | null
        }
        Insert: {
          bl_id: string
          calculated_at?: string | null
          charge_type?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          quantity?: number | null
          rate_id?: string | null
          subtotal?: number | null
          unit_value?: number | null
        }
        Update: {
          bl_id?: string
          calculated_at?: string | null
          charge_type?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          quantity?: number | null
          rate_id?: string | null
          subtotal?: number | null
          unit_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "granite_bl_charges_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "granite_bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granite_bl_charges_rate_id_fkey"
            columns: ["rate_id"]
            isOneToOne: false
            referencedRelation: "granite_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      granite_bls: {
        Row: {
          bl_number: string
          blocks_qty: number | null
          booking_number: string | null
          cargo_readiness_date: string | null
          ce_mercante: string | null
          charge_status: string
          charter: string | null
          client_id: number | null
          consignee_name: string | null
          cosco_transport: string | null
          created_at: string | null
          cssc_selection: string | null
          discharge_port: string | null
          final_m3: number | null
          fragile_blocks: number | null
          id: string
          loading_port: string | null
          manifest_id: string
          partial_restriction: boolean | null
          phase: string | null
          real_weight_kg: number | null
          received_blocks_qty: number | null
          remarks: string | null
          sequence: number | null
          shipper_cnpj: string | null
          shipper_m3: number | null
          shipper_name: string | null
          shipper_ref: string | null
          shipper_weight_kg: number | null
          stockyard: string | null
          suggested_client_id: number | null
          vessel_voyage: string | null
        }
        Insert: {
          bl_number: string
          blocks_qty?: number | null
          booking_number?: string | null
          cargo_readiness_date?: string | null
          ce_mercante?: string | null
          charge_status?: string
          charter?: string | null
          client_id?: number | null
          consignee_name?: string | null
          cosco_transport?: string | null
          created_at?: string | null
          cssc_selection?: string | null
          discharge_port?: string | null
          final_m3?: number | null
          fragile_blocks?: number | null
          id?: string
          loading_port?: string | null
          manifest_id: string
          partial_restriction?: boolean | null
          phase?: string | null
          real_weight_kg?: number | null
          received_blocks_qty?: number | null
          remarks?: string | null
          sequence?: number | null
          shipper_cnpj?: string | null
          shipper_m3?: number | null
          shipper_name?: string | null
          shipper_ref?: string | null
          shipper_weight_kg?: number | null
          stockyard?: string | null
          suggested_client_id?: number | null
          vessel_voyage?: string | null
        }
        Update: {
          bl_number?: string
          blocks_qty?: number | null
          booking_number?: string | null
          cargo_readiness_date?: string | null
          ce_mercante?: string | null
          charge_status?: string
          charter?: string | null
          client_id?: number | null
          consignee_name?: string | null
          cosco_transport?: string | null
          created_at?: string | null
          cssc_selection?: string | null
          discharge_port?: string | null
          final_m3?: number | null
          fragile_blocks?: number | null
          id?: string
          loading_port?: string | null
          manifest_id?: string
          partial_restriction?: boolean | null
          phase?: string | null
          real_weight_kg?: number | null
          received_blocks_qty?: number | null
          remarks?: string | null
          sequence?: number | null
          shipper_cnpj?: string | null
          shipper_m3?: number | null
          shipper_name?: string | null
          shipper_ref?: string | null
          shipper_weight_kg?: number | null
          stockyard?: string | null
          suggested_client_id?: number | null
          vessel_voyage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "granite_bls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granite_bls_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "granite_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granite_bls_suggested_client_id_fkey"
            columns: ["suggested_client_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      granite_manifests: {
        Row: {
          discharge_port: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          loading_port: string | null
          total_bls: number | null
          total_weight_kg: number | null
          vessel_voyage: string
          voyage_id: number | null
        }
        Insert: {
          discharge_port?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          loading_port?: string | null
          total_bls?: number | null
          total_weight_kg?: number | null
          vessel_voyage: string
          voyage_id?: number | null
        }
        Update: {
          discharge_port?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          loading_port?: string | null
          total_bls?: number | null
          total_weight_kg?: number | null
          vessel_voyage?: string
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "granite_manifests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      granite_rates: {
        Row: {
          active: boolean
          charge_type: string
          created_at: string | null
          currency: string
          description: string
          id: string
          unit_value: number
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          charge_type: string
          created_at?: string | null
          currency?: string
          description: string
          id?: string
          unit_value: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          charge_type?: string
          created_at?: string | null
          currency?: string
          description?: string
          id?: string
          unit_value?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          cargo_mode: string
          ce_master: string | null
          created_at: string | null
          error_count: number | null
          file_hash: string | null
          filename: string
          id: number
          route_summary: string | null
          status: string | null
          total_bls: number | null
          total_containers: number | null
          uploaded_at: string | null
          uploaded_by: string | null
          voyage_id: number
        }
        Insert: {
          cargo_mode?: string
          ce_master?: string | null
          created_at?: string | null
          error_count?: number | null
          file_hash?: string | null
          filename: string
          id?: number
          route_summary?: string | null
          status?: string | null
          total_bls?: number | null
          total_containers?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          voyage_id: number
        }
        Update: {
          cargo_mode?: string
          ce_master?: string | null
          created_at?: string | null
          error_count?: number | null
          file_hash?: string | null
          filename?: string
          id?: number
          route_summary?: string | null
          status?: string | null
          total_bls?: number | null
          total_containers?: number | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      import_effect_attempts: {
        Row: {
          attempt_no: number
          effect_id: number
          error_code: string | null
          error_message: string | null
          event_kind: string
          id: number
          occurred_at: string
          result: Json | null
          status: string
          worker_id: string
        }
        Insert: {
          attempt_no: number
          effect_id: number
          error_code?: string | null
          error_message?: string | null
          event_kind: string
          id?: never
          occurred_at?: string
          result?: Json | null
          status: string
          worker_id: string
        }
        Update: {
          attempt_no?: number
          effect_id?: number
          error_code?: string | null
          error_message?: string | null
          event_kind?: string
          id?: never
          occurred_at?: string
          result?: Json | null
          status?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_effect_attempts_effect_id_fkey"
            columns: ["effect_id"]
            isOneToOne: false
            referencedRelation: "import_pending_effects"
            referencedColumns: ["id"]
          },
        ]
      }
      import_errors: {
        Row: {
          batch_id: number
          bl_number: string | null
          error_message: string | null
          error_type: string
          id: number
          raw_data: Json | null
          row_number: number | null
        }
        Insert: {
          batch_id: number
          bl_number?: string | null
          error_message?: string | null
          error_type: string
          id?: number
          raw_data?: Json | null
          row_number?: number | null
        }
        Update: {
          batch_id?: number
          bl_number?: string | null
          error_message?: string | null
          error_type?: string
          id?: number
          raw_data?: Json | null
          row_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_errors_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_pending_effects: {
        Row: {
          attempts: number
          created_at: string
          created_by: string | null
          depends_on_effect_id: number | null
          effect_kind: string
          entity_id: string
          id: number
          last_error_code: string | null
          last_error_message: string | null
          lease_until: string | null
          leased_by: string | null
          next_attempt_at: string
          result: Json | null
          source_action_id: string
          source_revision: number
          source_snapshot: Json
          status: string
          superseded_by_effect_id: number | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          depends_on_effect_id?: number | null
          effect_kind: string
          entity_id: string
          id?: never
          last_error_code?: string | null
          last_error_message?: string | null
          lease_until?: string | null
          leased_by?: string | null
          next_attempt_at?: string
          result?: Json | null
          source_action_id: string
          source_revision?: number
          source_snapshot?: Json
          status?: string
          superseded_by_effect_id?: number | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          created_by?: string | null
          depends_on_effect_id?: number | null
          effect_kind?: string
          entity_id?: string
          id?: never
          last_error_code?: string | null
          last_error_message?: string | null
          lease_until?: string | null
          leased_by?: string | null
          next_attempt_at?: string
          result?: Json | null
          source_action_id?: string
          source_revision?: number
          source_snapshot?: Json
          status?: string
          superseded_by_effect_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_pending_effects_depends_fk"
            columns: ["depends_on_effect_id"]
            isOneToOne: false
            referencedRelation: "import_pending_effects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_pending_effects_superseded_by_fk"
            columns: ["superseded_by_effect_id"]
            isOneToOne: false
            referencedRelation: "import_pending_effects"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notifications: {
        Row: {
          alert_id: number
          alert_item_id: number
          created_at: string
          destination: string | null
          entity_id: string | null
          entity_type: string | null
          event_id: number
          id: number
          is_fallback: boolean
          item_type: string
          message: string
          payload: Json
          read_at: string | null
          recipient_department: string
          recipient_id: string
          severity: string
          title: string
        }
        Insert: {
          alert_id: number
          alert_item_id: number
          created_at?: string
          destination?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_id: number
          id?: number
          is_fallback?: boolean
          item_type: string
          message: string
          payload?: Json
          read_at?: string | null
          recipient_department: string
          recipient_id: string
          severity: string
          title: string
        }
        Update: {
          alert_id?: number
          alert_item_id?: number
          created_at?: string
          destination?: string | null
          entity_id?: string | null
          entity_type?: string | null
          event_id?: number
          id?: number
          is_fallback?: boolean
          item_type?: string
          message?: string
          payload?: Json
          read_at?: string | null
          recipient_department?: string
          recipient_id?: string
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notifications_alert_item_id_fkey"
            columns: ["alert_item_id"]
            isOneToOne: false
            referencedRelation: "alert_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "alert_item_events"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_bls: {
        Row: {
          bl_id: string
          charge_status_snapshot: string | null
          created_at: string
          financial_status_snapshot: string | null
          id: number
          invoice_id: number
          subtotal_brl: number
          subtotal_usd: number
        }
        Insert: {
          bl_id: string
          charge_status_snapshot?: string | null
          created_at?: string
          financial_status_snapshot?: string | null
          id?: number
          invoice_id: number
          subtotal_brl?: number
          subtotal_usd?: number
        }
        Update: {
          bl_id?: string
          charge_status_snapshot?: string | null
          created_at?: string
          financial_status_snapshot?: string | null
          id?: number
          invoice_id?: number
          subtotal_brl?: number
          subtotal_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_bls_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_bls_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          last_number: number
          year: number
        }
        Insert: {
          last_number?: number
          year: number
        }
        Update: {
          last_number?: number
          year?: number
        }
        Relationships: []
      }
      invoice_granite_bls: {
        Row: {
          created_at: string
          granite_bl_id: string
          id: number
          invoice_id: number
          subtotal_brl: number
        }
        Insert: {
          created_at?: string
          granite_bl_id: string
          id?: number
          invoice_id: number
          subtotal_brl?: number
        }
        Update: {
          created_at?: string
          granite_bl_id?: string
          id?: number
          invoice_id?: number
          subtotal_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_granite_bls_granite_bl_id_fkey"
            columns: ["granite_bl_id"]
            isOneToOne: false
            referencedRelation: "granite_bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_granite_bls_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          billing_run_id: number | null
          bl_id: string | null
          calculation_key: string | null
          charge_calculation_id: number | null
          charge_item_id: number | null
          charge_table_id: number | null
          currency: string | null
          description: string
          id: number
          invoice_id: number | null
          manifest_id: number | null
          pricing_rule_version_id: number | null
          quantity: number | null
          snapshot_payload: Json
          source: string | null
          total_value_brl: number
          total_value_usd: number | null
          unit_value_brl: number | null
          unit_value_usd: number | null
        }
        Insert: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculation_key?: string | null
          charge_calculation_id?: number | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          currency?: string | null
          description: string
          id?: number
          invoice_id?: number | null
          manifest_id?: number | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          snapshot_payload?: Json
          source?: string | null
          total_value_brl: number
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Update: {
          billing_run_id?: number | null
          bl_id?: string | null
          calculation_key?: string | null
          charge_calculation_id?: number | null
          charge_item_id?: number | null
          charge_table_id?: number | null
          currency?: string | null
          description?: string
          id?: number
          invoice_id?: number | null
          manifest_id?: number | null
          pricing_rule_version_id?: number | null
          quantity?: number | null
          snapshot_payload?: Json
          source?: string | null
          total_value_brl?: number
          total_value_usd?: number | null
          unit_value_brl?: number | null
          unit_value_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_billing_run_id_fkey"
            columns: ["billing_run_id"]
            isOneToOne: false
            referencedRelation: "billing_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_charge_calculation_id_fkey"
            columns: ["charge_calculation_id"]
            isOneToOne: false
            referencedRelation: "charge_calculations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_pricing_rule_version_id_fkey"
            columns: ["pricing_rule_version_id"]
            isOneToOne: false
            referencedRelation: "pricing_rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lifecycle_events: {
        Row: {
          actor: string | null
          created_at: string
          event_type: string
          id: number
          invoice_id: number
          payload: Json
          receivable_id: number | null
          related_invoice_id: number | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          event_type: string
          id?: number
          invoice_id: number
          payload?: Json
          receivable_id?: number | null
          related_invoice_id?: number | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          event_type?: string
          id?: number
          invoice_id?: number
          payload?: Json
          receivable_id?: number | null
          related_invoice_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lifecycle_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lifecycle_events_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "bl_receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lifecycle_events_related_invoice_id_fkey"
            columns: ["related_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_receivable_links: {
        Row: {
          bl_id: string
          bl_snapshot: Json
          created_at: string
          id: number
          invoice_id: number
          receivable_id: number
          status: string
          subtotal_brl: number
        }
        Insert: {
          bl_id: string
          bl_snapshot?: Json
          created_at?: string
          id?: number
          invoice_id: number
          receivable_id: number
          status?: string
          subtotal_brl?: number
        }
        Update: {
          bl_id?: string
          bl_snapshot?: Json
          created_at?: string
          id?: number
          invoice_id?: number
          receivable_id?: number
          status?: string
          subtotal_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_receivable_links_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_receivable_links_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_receivable_links_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "bl_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_refunds: {
        Row: {
          amount_brl: number
          cod_adjustment_id: number | null
          created_at: string
          id: number
          invoice_id: number
          notes: string | null
          payment_id: number | null
          registered_by: string | null
          settled_at: string | null
          status: string
        }
        Insert: {
          amount_brl: number
          cod_adjustment_id?: number | null
          created_at?: string
          id?: number
          invoice_id: number
          notes?: string | null
          payment_id?: number | null
          registered_by?: string | null
          settled_at?: string | null
          status?: string
        }
        Update: {
          amount_brl?: number
          cod_adjustment_id?: number | null
          created_at?: string
          id?: number
          invoice_id?: number
          notes?: string | null
          payment_id?: number | null
          registered_by?: string | null
          settled_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_refunds_cod_adjustment_id_fkey"
            columns: ["cod_adjustment_id"]
            isOneToOne: false
            referencedRelation: "cod_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          balance_brl: number
          bl_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          conciliated_by_extract: boolean | null
          covered_by_invoice_id: number | null
          created_at: string | null
          customer_id: number
          id: number
          invoice_number: string
          invoice_type: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          obsolete_reason: string | null
          pix_payload: string | null
          pix_txid: string | null
          replaced_by_invoice_id: number | null
          status: string | null
          total_brl: number
          total_paid_brl: number
          updated_at: string | null
        }
        Insert: {
          balance_brl?: number
          bl_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          conciliated_by_extract?: boolean | null
          covered_by_invoice_id?: number | null
          created_at?: string | null
          customer_id: number
          id?: number
          invoice_number: string
          invoice_type?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          obsolete_reason?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          replaced_by_invoice_id?: number | null
          status?: string | null
          total_brl: number
          total_paid_brl?: number
          updated_at?: string | null
        }
        Update: {
          balance_brl?: number
          bl_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          conciliated_by_extract?: boolean | null
          covered_by_invoice_id?: number | null
          created_at?: string | null
          customer_id?: number
          id?: number
          invoice_number?: string
          invoice_type?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          obsolete_reason?: string | null
          pix_payload?: string | null
          pix_txid?: string | null
          replaced_by_invoice_id?: number | null
          status?: string | null
          total_brl?: number
          total_paid_brl?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_covered_by_invoice_id_fkey"
            columns: ["covered_by_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_replaced_by_invoice_id_fkey"
            columns: ["replaced_by_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_settlements: {
        Row: {
          amount_brl: number
          created_at: string
          id: number
          invoice_id: number | null
          method: string | null
          payment_id: number | null
          pix_txid: string | null
          receivable_id: number
          settled_at: string
          source: string
        }
        Insert: {
          amount_brl: number
          created_at?: string
          id?: number
          invoice_id?: number | null
          method?: string | null
          payment_id?: number | null
          pix_txid?: string | null
          receivable_id: number
          settled_at?: string
          source?: string
        }
        Update: {
          amount_brl?: number
          created_at?: string
          id?: number
          invoice_id?: number | null
          method?: string | null
          payment_id?: number | null
          pix_txid?: string | null
          receivable_id?: number
          settled_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_settlements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_settlements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_settlements_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "bl_receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      manifestos_mercante: {
        Row: {
          created_at: string
          id: string
          natureza: string
          numero: string
          pod: string
          pol: string
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          natureza: string
          numero: string
          pod: string
          pol: string
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          id?: string
          natureza?: string
          numero?: string
          pod?: string
          pol?: string
          updated_at?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "manifestos_mercante_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_brl: number
          created_at: string | null
          id: number
          invoice_id: number
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          registered_by: string | null
        }
        Insert: {
          amount_brl: number
          created_at?: string | null
          id?: number
          invoice_id: number
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          registered_by?: string | null
        }
        Update: {
          amount_brl?: number
          created_at?: string | null
          id?: number
          invoice_id?: number
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          registered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pix_reconciliation_exceptions: {
        Row: {
          amount_brl: number
          candidate_count: number
          cnpj: string
          created_at: string
          id: number
          import_key: string
          line_number: number
          metadata: Json
          normalized_txid: string
          paid_at: string | null
          reason: string
          resolution_source: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_demurrage_invoice_id: number | null
          resolved_invoice_id: number | null
          status: string
          txid: string
          updated_at: string
        }
        Insert: {
          amount_brl: number
          candidate_count?: number
          cnpj?: string
          created_at?: string
          id?: number
          import_key: string
          line_number: number
          metadata?: Json
          normalized_txid?: string
          paid_at?: string | null
          reason: string
          resolution_source?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_demurrage_invoice_id?: number | null
          resolved_invoice_id?: number | null
          status?: string
          txid?: string
          updated_at?: string
        }
        Update: {
          amount_brl?: number
          candidate_count?: number
          cnpj?: string
          created_at?: string
          id?: number
          import_key?: string
          line_number?: number
          metadata?: Json
          normalized_txid?: string
          paid_at?: string | null
          reason?: string
          resolution_source?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_demurrage_invoice_id?: number | null
          resolved_invoice_id?: number | null
          status?: string
          txid?: string
          updated_at?: string
        }
        Relationships: []
      }
      portal_email_attempts: {
        Row: {
          account_id: number | null
          created_at: string
          id: number
          idempotency_key: string
          invite_id: number | null
          kind: string
          last_error: string | null
          provider_message_id: string | null
          recipient_masked: string
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          account_id?: number | null
          created_at?: string
          id?: number
          idempotency_key: string
          invite_id?: number | null
          kind: string
          last_error?: string | null
          provider_message_id?: string | null
          recipient_masked: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: number | null
          created_at?: string
          id?: number
          idempotency_key?: string
          invite_id?: number | null
          kind?: string
          last_error?: string | null
          provider_message_id?: string | null
          recipient_masked?: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_email_attempts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_email_attempts_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "portal_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_email_event_attempts: {
        Row: {
          attempt_no: number
          error_code: string | null
          error_message: string | null
          event_id: number
          id: number
          occurred_at: string
          result: Json
          status: string
          worker_id: string
        }
        Insert: {
          attempt_no: number
          error_code?: string | null
          error_message?: string | null
          event_id: number
          id?: number
          occurred_at?: string
          result?: Json
          status: string
          worker_id: string
        }
        Update: {
          attempt_no?: number
          error_code?: string | null
          error_message?: string | null
          event_id?: number
          id?: number
          occurred_at?: string
          result?: Json
          status?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_email_event_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "portal_email_events"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_email_events: {
        Row: {
          attempt_count: number
          attempt_id: number | null
          communication_attempt_id: number | null
          event_type: string
          id: number
          last_error_code: string | null
          last_error_message: string | null
          lease_until: string | null
          leased_by: string | null
          payload: Json
          process_after: string | null
          processed_at: string | null
          processing_result: Json
          provider_event_id: string
          provider_message_id: string | null
          received_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          attempt_id?: number | null
          communication_attempt_id?: number | null
          event_type: string
          id?: number
          last_error_code?: string | null
          last_error_message?: string | null
          lease_until?: string | null
          leased_by?: string | null
          payload?: Json
          process_after?: string | null
          processed_at?: string | null
          processing_result?: Json
          provider_event_id: string
          provider_message_id?: string | null
          received_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          attempt_id?: number | null
          communication_attempt_id?: number | null
          event_type?: string
          id?: number
          last_error_code?: string | null
          last_error_message?: string | null
          lease_until?: string | null
          leased_by?: string | null
          payload?: Json
          process_after?: string | null
          processed_at?: string | null
          processing_result?: Json
          provider_event_id?: string
          provider_message_id?: string | null
          received_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_email_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "portal_email_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_inspection_events: {
        Row: {
          created_at: string
          customer_id: number
          id: number
          inspector_id: string
          origin: string
        }
        Insert: {
          created_at?: string
          customer_id: number
          id?: number
          inspector_id: string
          origin: string
        }
        Update: {
          created_at?: string
          customer_id?: number
          id?: number
          inspector_id?: string
          origin?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_inspection_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_invites: {
        Row: {
          account_id: number
          cancelled_reason: string | null
          consumed_at: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: number
          purpose: string
          sent_to_email: string
          status: string
          token_hash: string
        }
        Insert: {
          account_id: number
          cancelled_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: number
          purpose: string
          sent_to_email: string
          status?: string
          token_hash: string
        }
        Update: {
          account_id?: number
          cancelled_reason?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: number
          purpose?: string
          sent_to_email?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_invites_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_login_attempts: {
        Row: {
          attempted_at: string
          cnpj_hash: string
          id: number
          source: string
          succeeded: boolean
        }
        Insert: {
          attempted_at?: string
          cnpj_hash: string
          id?: number
          source?: string
          succeeded?: boolean
        }
        Update: {
          attempted_at?: string
          cnpj_hash?: string
          id?: number
          source?: string
          succeeded?: boolean
        }
        Relationships: []
      }
      portal_login_resolution_attempts: {
        Row: {
          attempted_at: string
          id: number
          login_hash: string
        }
        Insert: {
          attempted_at?: string
          id?: number
          login_hash: string
        }
        Update: {
          attempted_at?: string
          id?: number
          login_hash?: string
        }
        Relationships: []
      }
      portal_notifications: {
        Row: {
          bl_id: string | null
          created_at: string
          customer_id: number
          id: number
          link: string | null
          message: string
          read_at: string | null
          title: string
          type: string
        }
        Insert: {
          bl_id?: string | null
          created_at?: string
          customer_id: number
          id?: number
          link?: string | null
          message: string
          read_at?: string | null
          title: string
          type: string
        }
        Update: {
          bl_id?: string | null
          created_at?: string
          customer_id?: number
          id?: number
          link?: string | null
          message?: string
          read_at?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_notifications_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_notifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_provisioning_events: {
        Row: {
          account_id: number | null
          actor_id: string | null
          actor_type: string
          created_at: string
          customer_id: number
          id: number
          invite_id: number | null
          new_decision: string | null
          new_situation: string | null
          previous_decision: string | null
          previous_situation: string | null
          reason: string | null
          request_id: string | null
        }
        Insert: {
          account_id?: number | null
          actor_id?: string | null
          actor_type: string
          created_at?: string
          customer_id: number
          id?: number
          invite_id?: number | null
          new_decision?: string | null
          new_situation?: string | null
          previous_decision?: string | null
          previous_situation?: string | null
          reason?: string | null
          request_id?: string | null
        }
        Update: {
          account_id?: number | null
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          customer_id?: number
          id?: number
          invite_id?: number | null
          new_decision?: string | null
          new_situation?: string | null
          previous_decision?: string | null
          previous_situation?: string | null
          reason?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_provisioning_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "customer_portal_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_provisioning_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_provisioning_events_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "portal_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_rate_limits: {
        Row: {
          action_name: string
          attempted_at: string
          customer_id: number
          id: number
        }
        Insert: {
          action_name: string
          attempted_at?: string
          customer_id: number
          id?: number
        }
        Update: {
          action_name?: string
          attempted_at?: string
          customer_id?: number
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "portal_rate_limits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_suppressed_emails: {
        Row: {
          email: string
          id: number
          reason: string
          suppressed_at: string
        }
        Insert: {
          email: string
          id?: number
          reason: string
          suppressed_at?: string
        }
        Update: {
          email?: string
          id?: number
          reason?: string
          suppressed_at?: string
        }
        Relationships: []
      }
      ports: {
        Row: {
          country: string | null
          created_at: string | null
          id: number
          locode: string | null
          name: string
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          id?: number
          locode?: string | null
          name: string
        }
        Update: {
          country?: string | null
          created_at?: string | null
          id?: number
          locode?: string | null
          name?: string
        }
        Relationships: []
      }
      pricing_rule_versions: {
        Row: {
          charge_item_id: number | null
          charge_table_id: number | null
          created_at: string
          customer_id: number | null
          customer_rate_override_id: number | null
          id: number
          metadata: Json
          reference_date: string | null
          version_key: string
        }
        Insert: {
          charge_item_id?: number | null
          charge_table_id?: number | null
          created_at?: string
          customer_id?: number | null
          customer_rate_override_id?: number | null
          id?: number
          metadata?: Json
          reference_date?: string | null
          version_key: string
        }
        Update: {
          charge_item_id?: number | null
          charge_table_id?: number | null
          created_at?: string
          customer_id?: number | null
          customer_rate_override_id?: number | null
          id?: number
          metadata?: Json
          reference_date?: string | null
          version_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rule_versions_charge_item_id_fkey"
            columns: ["charge_item_id"]
            isOneToOne: false
            referencedRelation: "charge_table_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rule_versions_charge_table_id_fkey"
            columns: ["charge_table_id"]
            isOneToOne: false
            referencedRelation: "charge_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rule_versions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_rule_versions_customer_rate_override_id_fkey"
            columns: ["customer_rate_override_id"]
            isOneToOne: false
            referencedRelation: "customer_rate_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      provision_rate_limit_log: {
        Row: {
          called_at: string
          id: number
          user_id: string
        }
        Insert: {
          called_at?: string
          id?: number
          user_id: string
        }
        Update: {
          called_at?: string
          id?: number
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          active: boolean
          created_at: string | null
          full_name: string
          id: string
          role: string
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          full_name: string
          id: string
          role?: string
        }
        Update: {
          active?: boolean
          created_at?: string | null
          full_name?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      vazios_bookings: {
        Row: {
          condition: string
          container_number: string
          container_type: string | null
          created_at: string | null
          hand_in_date: string | null
          hand_out_date: string | null
          id: string
          local_id: string
          manifest_id: string
          movement_date: string | null
          operation_id: string
          voyage_id: number
        }
        Insert: {
          condition: string
          container_number: string
          container_type?: string | null
          created_at?: string | null
          hand_in_date?: string | null
          hand_out_date?: string | null
          id?: string
          local_id: string
          manifest_id: string
          movement_date?: string | null
          operation_id: string
          voyage_id: number
        }
        Update: {
          condition?: string
          container_number?: string
          container_type?: string | null
          created_at?: string | null
          hand_in_date?: string | null
          hand_out_date?: string | null
          id?: string
          local_id?: string
          manifest_id?: string
          movement_date?: string | null
          operation_id?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vazios_bookings_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_bookings_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "vazios_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_bookings_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "vazios_export_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_bookings_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_export_operations: {
        Row: {
          created_at: string
          embark_port: string
          id: string
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          embark_port: string
          id?: string
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          embark_port?: string
          id?: string
          updated_at?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vazios_export_operations_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_export_service_lines: {
        Row: {
          condition: string | null
          container_type: string | null
          created_at: string
          destino_id: string | null
          id: string
          local_id: string
          observation: string | null
          operation_id: string
          percentual: number | null
          quantidade: number
          quantidade_manual: boolean
          service_id: string
          updated_at: string
          valor_sugerido: number | null
          valor_unitario: number
        }
        Insert: {
          condition?: string | null
          container_type?: string | null
          created_at?: string
          destino_id?: string | null
          id?: string
          local_id: string
          observation?: string | null
          operation_id: string
          percentual?: number | null
          quantidade?: number
          quantidade_manual?: boolean
          service_id: string
          updated_at?: string
          valor_sugerido?: number | null
          valor_unitario?: number
        }
        Update: {
          condition?: string | null
          container_type?: string | null
          created_at?: string
          destino_id?: string | null
          id?: string
          local_id?: string
          observation?: string | null
          operation_id?: string
          percentual?: number | null
          quantidade?: number
          quantidade_manual?: boolean
          service_id?: string
          updated_at?: string
          valor_sugerido?: number | null
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "vazios_export_service_lines_destino_id_fkey"
            columns: ["destino_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_export_service_lines_local_id_fkey"
            columns: ["local_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_export_service_lines_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "vazios_export_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vazios_export_service_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "depot_services"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_importacao_containers: {
        Row: {
          container_number: string
          container_type: string | null
          created_at: string | null
          id: string
          manifest_id: string
          natureza: string | null
          pod: string | null
          pol: string | null
          tare_kg: number | null
        }
        Insert: {
          container_number: string
          container_type?: string | null
          created_at?: string | null
          id?: string
          manifest_id: string
          natureza?: string | null
          pod?: string | null
          pol?: string | null
          tare_kg?: number | null
        }
        Update: {
          container_number?: string
          container_type?: string | null
          created_at?: string | null
          id?: string
          manifest_id?: string
          natureza?: string | null
          pod?: string | null
          pol?: string | null
          tare_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vazios_importacao_containers_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "vazios_importacao_manifests"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_importacao_manifests: {
        Row: {
          description: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          source: string
          total_containers: number | null
          voyage_id: number | null
        }
        Insert: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          source?: string
          total_containers?: number | null
          voyage_id?: number | null
        }
        Update: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          source?: string
          total_containers?: number | null
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vazios_importacao_manifests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vazios_manifests: {
        Row: {
          description: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          total_bookings: number | null
          voyage_id: number | null
        }
        Insert: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          total_bookings?: number | null
          voyage_id?: number | null
        }
        Update: {
          description?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          total_bookings?: number | null
          voyage_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vazios_manifests_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          bl_id: string
          brand: string
          cbm: number
          chassis: string
          container_id: number
          created_at: string | null
          id: number
          model: string
          voyage_id: number
          weight_kg: number
        }
        Insert: {
          bl_id: string
          brand: string
          cbm: number
          chassis: string
          container_id: number
          created_at?: string | null
          id?: number
          model: string
          voyage_id: number
          weight_kg: number
        }
        Update: {
          bl_id?: string
          brand?: string
          cbm?: number
          chassis?: string
          container_id?: number
          created_at?: string | null
          id?: number
          model?: string
          voyage_id?: number
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_bl_id_fkey"
            columns: ["bl_id"]
            isOneToOne: false
            referencedRelation: "bls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "bl_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      vessel_schedules: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          imo_number: string | null
          nansha_etd: string | null
          ningbo_etd: string | null
          pecem_eta: string | null
          qingdao_etd: string | null
          salvador_eta: string | null
          shanghai_etd: string | null
          taicang_etd: string | null
          updated_at: string
          vessel_name: string
          vitoria_eta: string | null
          voyage: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          updated_at?: string
          vessel_name: string
          vitoria_eta?: string | null
          voyage: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          imo_number?: string | null
          nansha_etd?: string | null
          ningbo_etd?: string | null
          pecem_eta?: string | null
          qingdao_etd?: string | null
          salvador_eta?: string | null
          shanghai_etd?: string | null
          taicang_etd?: string | null
          updated_at?: string
          vessel_name?: string
          vitoria_eta?: string | null
          voyage?: string
        }
        Relationships: []
      }
      vessels: {
        Row: {
          carrier_id: number
          created_at: string | null
          id: number
          imo: string | null
          name: string
        }
        Insert: {
          carrier_id: number
          created_at?: string | null
          id?: number
          imo?: string | null
          name: string
        }
        Update: {
          carrier_id?: number
          created_at?: string | null
          id?: number
          imo?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vessels_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_escala_operation_fronts: {
        Row: {
          created_at: string
          id: string
          last_changed_at: string
          last_changed_by: string | null
          modalidade: string
          port: string
          port_id: number
          revision: number
          sentido: string
          source: string
          terminal_id: string | null
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_changed_at?: string
          last_changed_by?: string | null
          modalidade: string
          port: string
          port_id: number
          revision?: number
          sentido: string
          source: string
          terminal_id?: string | null
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          id?: string
          last_changed_at?: string
          last_changed_by?: string | null
          modalidade?: string
          port?: string
          port_id?: number
          revision?: number
          sentido?: string
          source?: string
          terminal_id?: string | null
          updated_at?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_escala_operation_fronts_port_id_fkey"
            columns: ["port_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_escala_operation_fronts_terminal_id_port_id_fkey"
            columns: ["terminal_id", "port_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id", "port_id"]
          },
          {
            foreignKeyName: "voyage_escala_operation_fronts_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_escala_revision_state: {
        Row: {
          created_at: string
          port: string
          port_id: number
          revision: number
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          port: string
          port_id: number
          revision?: number
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          port?: string
          port_id?: number
          revision?: number
          updated_at?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_escala_revision_state_port_id_fkey"
            columns: ["port_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_escala_revision_state_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_escala_terminal_state: {
        Row: {
          created_at: string
          id: string
          port: string
          port_id: number
          revision: number
          terminal_atb: string | null
          terminal_atd: string | null
          terminal_etb: string | null
          terminal_etd: string | null
          terminal_id: string | null
          terminal_rtw: number | null
          updated_at: string
          voyage_id: number
        }
        Insert: {
          created_at?: string
          id?: string
          port: string
          port_id: number
          revision?: number
          terminal_atb?: string | null
          terminal_atd?: string | null
          terminal_etb?: string | null
          terminal_etd?: string | null
          terminal_id?: string | null
          terminal_rtw?: number | null
          updated_at?: string
          voyage_id: number
        }
        Update: {
          created_at?: string
          id?: string
          port?: string
          port_id?: number
          revision?: number
          terminal_atb?: string | null
          terminal_atd?: string | null
          terminal_etb?: string | null
          terminal_etd?: string | null
          terminal_id?: string | null
          terminal_rtw?: number | null
          updated_at?: string
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_escala_terminal_state_port_id_fkey"
            columns: ["port_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyage_escala_terminal_state_terminal_id_port_id_fkey"
            columns: ["terminal_id", "port_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id", "port_id"]
          },
          {
            foreignKeyName: "voyage_escala_terminal_state_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_export_schedules: {
        Row: {
          ce_status: string | null
          containers_qty: number | null
          created_at: string | null
          discharge_ports: string[]
          has_empty: boolean
          has_granite: boolean
          id: string
          linked: boolean
          movements_qty: number | null
          pol: string
          tem_exportacao: boolean
          updated_at: string | null
          voyage_id: number
        }
        Insert: {
          ce_status?: string | null
          containers_qty?: number | null
          created_at?: string | null
          discharge_ports?: string[]
          has_empty?: boolean
          has_granite?: boolean
          id?: string
          linked?: boolean
          movements_qty?: number | null
          pol: string
          tem_exportacao?: boolean
          updated_at?: string | null
          voyage_id: number
        }
        Update: {
          ce_status?: string | null
          containers_qty?: number | null
          created_at?: string | null
          discharge_ports?: string[]
          has_empty?: boolean
          has_granite?: boolean
          id?: string
          linked?: boolean
          movements_qty?: number | null
          pol?: string
          tem_exportacao?: boolean
          updated_at?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_export_schedules_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_omissions: {
        Row: {
          discharge_pod: string
          id: number
          omitted_at: string
          omitted_by: string | null
          omitted_pod: string
          onward_carrier: string | null
          onward_eta: string | null
          onward_etd: string | null
          onward_vessel_name: string | null
          onward_voyage_number: string | null
          reason: string | null
          revert_justification: string | null
          reverted_at: string | null
          reverted_by: string | null
          voyage_id: number
        }
        Insert: {
          discharge_pod: string
          id?: number
          omitted_at?: string
          omitted_by?: string | null
          omitted_pod: string
          onward_carrier?: string | null
          onward_eta?: string | null
          onward_etd?: string | null
          onward_vessel_name?: string | null
          onward_voyage_number?: string | null
          reason?: string | null
          revert_justification?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          voyage_id: number
        }
        Update: {
          discharge_pod?: string
          id?: number
          omitted_at?: string
          omitted_by?: string | null
          omitted_pod?: string
          onward_carrier?: string | null
          onward_eta?: string | null
          onward_etd?: string | null
          onward_vessel_name?: string | null
          onward_voyage_number?: string | null
          reason?: string | null
          revert_justification?: string | null
          reverted_at?: string | null
          reverted_by?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_omissions_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyage_route_ce_master: {
        Row: {
          cargo_mode: string
          ce_master: string | null
          id: string
          pod: string
          pol: string
          updated_at: string | null
          updated_by: string | null
          voyage_id: number
        }
        Insert: {
          cargo_mode?: string
          ce_master?: string | null
          id?: string
          pod: string
          pol: string
          updated_at?: string | null
          updated_by?: string | null
          voyage_id: number
        }
        Update: {
          cargo_mode?: string
          ce_master?: string | null
          id?: string
          pod?: string
          pol?: string
          updated_at?: string | null
          updated_by?: string | null
          voyage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voyage_route_ce_master_voyage_id_fkey"
            columns: ["voyage_id"]
            isOneToOne: false
            referencedRelation: "voyages"
            referencedColumns: ["id"]
          },
        ]
      }
      voyages: {
        Row: {
          ata: string | null
          created_at: string | null
          eta: string | null
          etd: string | null
          id: number
          pod_id: number | null
          pod_schedule_snapshot: Json
          pol_id: number | null
          pol_schedule_snapshot: Json
          show_on_portal: boolean
          status: string | null
          vessel_id: number
          voyage_number: string
        }
        Insert: {
          ata?: string | null
          created_at?: string | null
          eta?: string | null
          etd?: string | null
          id?: number
          pod_id?: number | null
          pod_schedule_snapshot?: Json
          pol_id?: number | null
          pol_schedule_snapshot?: Json
          show_on_portal?: boolean
          status?: string | null
          vessel_id: number
          voyage_number: string
        }
        Update: {
          ata?: string | null
          created_at?: string | null
          eta?: string | null
          etd?: string | null
          id?: number
          pod_id?: number | null
          pod_schedule_snapshot?: Json
          pol_id?: number | null
          pol_schedule_snapshot?: Json
          show_on_portal?: boolean
          status?: string | null
          vessel_id?: number
          voyage_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "voyages_pod_id_fkey"
            columns: ["pod_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyages_pol_id_fkey"
            columns: ["pol_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voyages_vessel_id_fkey"
            columns: ["vessel_id"]
            isOneToOne: false
            referencedRelation: "vessels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _apply_customer_contact_configuration: {
        Args: {
          p_actor_id?: string
          p_contacts: Json
          p_customer_id: number
          p_justification?: string
          p_portal_account_id?: number
          p_related_bl_id?: string
          p_source: string
        }
        Returns: Json
      }
      _build_customer_contact_configuration: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      _calculate_demurrage_invoice_authoritative: {
        Args: {
          p_bl_id: string
          p_calculation_date: string
          p_container_ids: number[]
        }
        Returns: Json
      }
      _demurrage_mutation_request: {
        Args: {
          p_invoice_id: number
          p_operation: string
          p_payload: Json
          p_request_id: string
        }
        Returns: Json
      }
      _demurrage_roe_from_ptax: { Args: { p_ptax: number }; Returns: number }
      _demurrage_spread_version: { Args: never; Returns: number }
      _import_effect_priority: {
        Args: { p_effect_kind: string }
        Returns: number
      }
      _portal_actor_role: { Args: never; Returns: string }
      _portal_get_current_roe_core: {
        Args: { p_customer_id: number }
        Returns: {
          roe: number
          updated_at: string
        }[]
      }
      _portal_get_demurrage_invoice_detail_core: {
        Args: { p_customer_id: number; p_invoice_id: number }
        Returns: Json
      }
      _portal_get_profile_core: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      _portal_inspect_guard: {
        Args: { p_customer_id: number }
        Returns: number
      }
      _portal_invoice_details_core: {
        Args: { p_customer_id: number; p_invoice_id: number }
        Returns: Json
      }
      _portal_list_consolidatable_receivables_core: {
        Args: { p_customer_id: number }
        Returns: {
          balance_brl: number
          bl_id: string
          customer_cnpj_cpf: string
          customer_id: number
          customer_name: string
          eligibility_reason: string
          eligibility_status: string
          individual_invoice_id: number
          individual_invoice_number: string
          original_amount_brl: number
          receivable_id: number
          receivable_status: string
          vessel_name: string
          voyage_id: number
          voyage_number: string
        }[]
      }
      _portal_list_demurrage_invoices_core: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      _portal_list_demurrage_invoices_page_core: {
        Args: {
          p_bl?: string
          p_customer_id: number
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_pod?: string
          p_status?: string
          p_vessel?: string
        }
        Returns: Json
      }
      _portal_list_disputes_core: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      _portal_list_invoices_core: {
        Args: { p_customer_id: number }
        Returns: {
          balance_brl: number
          bls: string[]
          id: number
          invoice_number: string
          invoice_type: string
          issued_at: string
          pods: string[]
          status: string
          total_brl: number
          total_paid_brl: number
          vessel_voyages: string[]
          vessels: string[]
          voyages: string[]
        }[]
      }
      _portal_list_invoices_page_core: {
        Args: {
          p_bl?: string
          p_customer_id: number
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_pod?: string
          p_status?: string
          p_vessel?: string
        }
        Returns: Json
      }
      _portal_list_notifications_core: {
        Args: { p_customer_id: number; p_limit: number }
        Returns: Json
      }
      _portal_list_operation_bls_core: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      _portal_list_operation_bls_without_transshipment_core: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      _portal_log_event: {
        Args: {
          p_account_id: number
          p_actor_type: string
          p_customer_id: number
          p_invite_id: number
          p_new_decision: string
          p_new_situation: string
          p_prev_decision: string
          p_prev_situation: string
          p_reason: string
          p_request_id: string
        }
        Returns: undefined
      }
      _portal_notification_unread_count_core: {
        Args: { p_customer_id: number }
        Returns: number
      }
      _record_import_effect_blocked_alert: {
        Args: {
          p_effect_id: number
          p_effect_kind: string
          p_entity_id: string
          p_error_code: string
          p_error_message: string
        }
        Returns: undefined
      }
      _run_import_effect_demurrage: {
        Args: { p_actor: string; p_bl_id: string; p_effect_id: number }
        Returns: Json
      }
      _run_import_effect_local_charges: {
        Args: { p_actor: string; p_entity_id: string }
        Returns: Json
      }
      add_agency_report_occurrence: {
        Args: {
          p_body: string
          p_port: string
          p_section?: string
          p_voyage_id: number
        }
        Returns: Json
      }
      add_demurrage_dispute_attachment: {
        Args: {
          p_file_name: string
          p_message_id: number
          p_mime_type: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: number
      }
      add_demurrage_dispute_message: {
        Args: {
          p_body: string
          p_dispute_id: number
          p_next_responder?: string
        }
        Returns: Json
      }
      add_manual_bl_charge: {
        Args: {
          p_actor?: string
          p_bl_id: string
          p_charge_item_id: number
          p_notes?: string
          p_quantity?: number
        }
        Returns: Json
      }
      add_manual_invoice_charge: {
        Args: {
          p_actor?: string
          p_description: string
          p_invoice_id: number
          p_notes?: string
          p_quantity: number
          p_unit_value_brl: number
        }
        Returns: Json
      }
      admin_list_users: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          last_sign_in_at: string
          role: string
        }[]
      }
      agency_report_alert_entity_id: {
        Args: {
          p_port: string
          p_subject: string
          p_terminal_code: string
          p_voyage_id: number
        }
        Returns: string
      }
      agency_report_alert_entity_key: {
        Args: { p_port: string; p_terminal_code?: string; p_voyage_id: number }
        Returns: string
      }
      agency_report_alert_entity_prefix: {
        Args: { p_port: string; p_terminal_code?: string; p_voyage_id: number }
        Returns: string
      }
      agency_report_deadline_date: { Args: { p_atd: string }; Returns: string }
      agency_report_department_label: {
        Args: { p_department: string }
        Returns: string
      }
      agency_report_section_label: {
        Args: { p_section: string }
        Returns: string
      }
      agency_report_section_owner: {
        Args: { p_section: string }
        Returns: string
      }
      alert_actor_is_authorized: { Args: never; Returns: boolean }
      apply_baplie_physical_flags_atomic: {
        Args: { p_changed_by: string; p_changes: Json; p_voyage_id: number }
        Returns: Json
      }
      apply_bl_review_gate_after_import: {
        Args: { p_bl_ids: string[]; p_changed_by: string }
        Returns: number
      }
      apply_ce_mercante_manifest: {
        Args: { p_changed_by: string; p_rows: Json }
        Returns: Json
      }
      apply_ce_mercante_update: {
        Args: { p_bl_id: string; p_changed_by: string; p_new_ce: string }
        Returns: string
      }
      apply_cod_financial_effect: {
        Args: { p_bl_id: string; p_omission_id: number; p_previous_pod: string }
        Returns: undefined
      }
      apply_cod_open_balance_offset: {
        Args: {
          p_actor: string
          p_amount: number
          p_bl_id: string
          p_invoice_id: number
        }
        Returns: number
      }
      apply_container_dates_atomic: {
        Args: {
          p_bl_id: string
          p_changed_by: string
          p_request_id: string
          p_rows: Json
        }
        Returns: Json
      }
      apply_customer_base_row_atomic: {
        Args: {
          p_address: string
          p_changed_by: string
          p_city: string
          p_cnpj: string
          p_emails: Json
          p_name: string
          p_state: string
          p_trade_name: string
          p_zip: string
        }
        Returns: Json
      }
      apply_demurrage_discount: {
        Args: {
          p_discount_approver?: string
          p_discount_justification?: string
          p_discount_mode: string
          p_discount_type?: string
          p_discount_value: number
          p_invoice_id: number
          p_request_id: string
        }
        Returns: Json
      }
      apply_granite_ce_mercante_update: {
        Args: { p_bl_id: string; p_changed_by: string; p_new_ce: string }
        Returns: string
      }
      approve_customer_reconciliation: {
        Args: {
          p_actor?: string
          p_customer_id?: number
          p_notes?: string
          p_queue_id: number
        }
        Returns: Json
      }
      archive_vessel_schedule: { Args: { p_vessel_id: string }; Returns: Json }
      assert_voyage_escala_ready_for_report_close: {
        Args: { p_port: string; p_report_id: string; p_voyage_id: number }
        Returns: undefined
      }
      backfill_invoice_receivable_links: {
        Args: { p_limit?: number }
        Returns: Json
      }
      backfill_local_charge_receivables: {
        Args: { p_limit?: number }
        Returns: Json
      }
      bl_has_portal_release: { Args: { p_bl_id: string }; Returns: boolean }
      bl_timeline: {
        Args: { p_bl_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          changed_at: string
          changed_by: string
          entity_type: string
          family: string
          field_name: string
          id: number
          justification: string
          new_value: string
          old_value: string
        }[]
      }
      block521_resolve_alert: {
        Args: {
          p_department: string
          p_entity_id: string
          p_entity_type: string
          p_source: string
          p_type: string
        }
        Returns: boolean
      }
      block521_upsert_alert: {
        Args: {
          p_department: string
          p_destination?: string
          p_entity_id: string
          p_entity_type: string
          p_message: string
          p_metadata?: Json
          p_source: string
          p_type: string
        }
        Returns: Json
      }
      build_transshipping_pix_payload: {
        Args: { p_amount_brl: number; p_txid: string }
        Returns: string
      }
      calculate_bl_local_charges: {
        Args: { p_actor?: string; p_bl_id: string; p_recalculate?: boolean }
        Returns: Json
      }
      cancel_demurrage_invoice: {
        Args: { p_invoice_id: number; p_reason: string; p_request_id: string }
        Returns: Json
      }
      cancel_invoice: {
        Args: { p_actor?: string; p_invoice_id: number; p_reason: string }
        Returns: Json
      }
      capture_manifest_financial_contact: {
        Args: { p_customer_id: number; p_email: string }
        Returns: boolean
      }
      check_portal_rate_limit: {
        Args: {
          p_action_name: string
          p_max_attempts?: number
          p_window_minutes?: number
        }
        Returns: boolean
      }
      check_provision_rate_limit: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      claim_demurrage_dunning_candidates: {
        Args: { p_as_of?: string; p_limit?: number }
        Returns: Json
      }
      claim_due_demurrage_dunning_invoices: {
        Args: { p_as_of?: string; p_limit?: number }
        Returns: Json
      }
      claim_import_effects: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          created_at: string
          created_by: string | null
          depends_on_effect_id: number | null
          effect_kind: string
          entity_id: string
          id: number
          last_error_code: string | null
          last_error_message: string | null
          lease_until: string | null
          leased_by: string | null
          next_attempt_at: string
          result: Json | null
          source_action_id: string
          source_revision: number
          source_snapshot: Json
          status: string
          superseded_by_effect_id: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "import_pending_effects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_portal_email_events: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempt_count: number
          attempt_id: number | null
          communication_attempt_id: number | null
          event_type: string
          id: number
          last_error_code: string | null
          last_error_message: string | null
          lease_until: string | null
          leased_by: string | null
          payload: Json
          process_after: string | null
          processed_at: string | null
          processing_result: Json
          provider_event_id: string
          provider_message_id: string | null
          received_at: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "portal_email_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      close_agency_departure_report: {
        Args: { p_port: string; p_snapshot: Json; p_voyage_id: number }
        Returns: Json
      }
      close_agency_departure_report_by_report_id: {
        Args: {
          p_port: string
          p_report_id: string
          p_snapshot: Json
          p_voyage_id: number
        }
        Returns: Json
      }
      close_legacy_agency_report_alerts_for_scale: {
        Args: { p_port: string; p_voyage_id: number }
        Returns: number
      }
      complete_import_effect: {
        Args: {
          p_effect_id: number
          p_error_code?: string
          p_error_message?: string
          p_result?: Json
          p_retry_at?: string
          p_status: string
          p_worker_id: string
        }
        Returns: Json
      }
      complete_portal_email_event: {
        Args: {
          p_error_code?: string
          p_error_message?: string
          p_event_id: number
          p_retry_at?: string
          p_status: string
          p_worker_id: string
        }
        Returns: Json
      }
      complete_review_customer_group: {
        Args: {
          p_bl_ids: string[]
          p_changed_by?: string
          p_cnpj_cpf?: string
          p_customer_id?: number
          p_email?: string
          p_name?: string
        }
        Returns: Json
      }
      compute_bl_review_pendencies:
        | { Args: { p_bl_id: string }; Returns: string[] }
        | {
            Args: {
              p_bb_weight_ton: number
              p_cargo_mode: string
              p_customer_id: number
            }
            Returns: string[]
          }
      confirm_demurrage_pix_matches: {
        Args: { p_matches: Json }
        Returns: number
      }
      confirm_unified_pix_matches: { Args: { p_matches: Json }; Returns: Json }
      count_alert_queue: { Args: { p_filter?: string }; Returns: number }
      count_distinct_containers: { Args: never; Returns: number }
      count_unread_internal_notifications: { Args: never; Returns: number }
      create_customer_communication_atomic: {
        Args: {
          p_anchor_atracacao_id?: string
          p_anchor_invoice_id?: number
          p_anchor_port?: string
          p_anchor_voyage_id?: number
          p_attempt_discriminator?: number
          p_bl_ids?: string[]
          p_created_by?: string
          p_customer_id: number
          p_dispatch_id?: string
          p_kind: string
          p_nature: string
          p_terminal_name?: string
          p_vessel_name?: string
          p_voyage_number?: string
        }
        Returns: number
      }
      create_customer_dunning_group_atomic: {
        Args: {
          p_anchor_port?: string
          p_anchor_voyage_id?: number
          p_attempt_discriminator: number
          p_customer_id: number
          p_invoice_ids: number[]
          p_terminal_name?: string
          p_vessel_name?: string
          p_voyage_number?: string
        }
        Returns: number
      }
      create_customer_with_contacts: {
        Args: { p_contacts?: Json; p_customer: Json }
        Returns: Json
      }
      create_demurrage_invoice_authoritative: {
        Args: {
          p_bl_id: string
          p_container_ids: number[]
          p_customer_id: number
          p_doc_number: string
          p_expected_updated_at?: string
        }
        Returns: Json
      }
      create_demurrage_invoice_with_items: {
        Args: {
          p_bl_id: string
          p_current_roe: number
          p_customer_id: number
          p_doc_number: string
          p_items: Json
          p_ready_at: string
          p_roe: number
          p_roe_manual: boolean
          p_roe_source: string
          p_total_usd: number
        }
        Returns: Json
      }
      create_invoice_from_bls: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id?: number
          p_issue_now?: boolean
          p_notes?: string
        }
        Returns: Json
      }
      create_invoice_from_bls_core: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id: number
          p_issue_now?: boolean
          p_notes?: string
          p_origin?: string
          p_portal_account_id?: number
        }
        Returns: Json
      }
      create_invoice_from_bls_with_ledger: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id?: number
          p_issue_now?: boolean
          p_notes?: string
        }
        Returns: Json
      }
      create_invoice_from_granite_bls: {
        Args: {
          p_actor?: string
          p_customer_id?: number
          p_granite_bl_ids: string[]
          p_issue_now?: boolean
          p_notes?: string
        }
        Returns: Json
      }
      create_local_consolidated_invoice: {
        Args: {
          p_actor?: string
          p_customer_id: number
          p_notes?: string
          p_receivable_ids: number[]
        }
        Returns: Json
      }
      create_local_consolidated_invoice_core: {
        Args: {
          p_actor?: string
          p_customer_id: number
          p_origin?: string
          p_receivable_ids: number[]
        }
        Returns: Json
      }
      create_manual_vazios_booking: {
        Args: {
          p_condition: string
          p_container_number: string
          p_container_type: string
          p_hand_in_date: string
          p_hand_out_date: string
          p_local_id: string
          p_movement_date: string
          p_operation_id: string
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: string
      }
      current_actor_role: { Args: never; Returns: string }
      current_portal_customer_id: { Args: never; Returns: number }
      current_user_role: { Args: never; Returns: string }
      customer_billing_access_ready: {
        Args: { p_customer_id: number }
        Returns: boolean
      }
      customer_communication_recipient_allowed: {
        Args: {
          p_audience_mode?: string
          p_contact_id: number
          p_customer_id: number
          p_kind?: string
          p_recipient_box_code?: string
        }
        Returns: boolean
      }
      customer_communication_safe_timestamptz: {
        Args: { p_value: string }
        Returns: string
      }
      customer_local_charges_communication_dispatch_ready: {
        Args: { p_customer_id: number; p_raise?: boolean; p_voyage_id: number }
        Returns: Json
      }
      customer_local_charges_communication_payload: {
        Args: { p_customer_id: number; p_voyage_id: number }
        Returns: Json
      }
      customer_local_charges_communication_readiness: {
        Args: { p_customer_id: number; p_voyage_id: number }
        Returns: Json
      }
      customer_portal_access_ready: {
        Args: { p_customer_id: number }
        Returns: boolean
      }
      delete_baplie_manifest_for_voyage: {
        Args: { p_voyage_id: number }
        Returns: number
      }
      delete_manual_bl_charge: {
        Args: { p_actor?: string; p_charge_calculation_id: number }
        Returns: Json
      }
      delete_manual_invoice_charge: {
        Args: { p_actor?: string; p_item_id: number }
        Returns: Json
      }
      delete_manual_vazios_booking: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      demurrage_dunning_candidate_sendable: {
        Args: { p_invoice_id: number }
        Returns: boolean
      }
      detect_agency_report_deadline_missed: { Args: never; Returns: number }
      detect_agency_report_department_pending: { Args: never; Returns: number }
      detect_agency_report_pending: { Args: never; Returns: number }
      detect_bl_review_pendencies: { Args: never; Returns: number }
      detect_customer_communication_alerts: { Args: never; Returns: Json }
      detect_granite_bl_review_pendencies: { Args: never; Returns: number }
      detect_voyage_operation_alerts: { Args: never; Returns: number }
      dismiss_alert_item: {
        Args: { p_item_id: number; p_reason: string; p_review_at: string }
        Returns: Json
      }
      enqueue_import_effect: {
        Args: {
          p_created_by: string
          p_depends_on_effect_id?: number
          p_effect_kind: string
          p_entity_id: string
          p_source_action_id: string
          p_source_revision?: number
          p_source_snapshot?: Json
        }
        Returns: Json
      }
      ensure_agency_departure_report: {
        Args: { p_port: string; p_voyage_id: number }
        Returns: string
      }
      ensure_customer_contact_email: {
        Args: {
          p_contact_name?: string
          p_customer_id: number
          p_email: string
          p_purpose?: string
          p_related_bl_id?: string
        }
        Returns: boolean
      }
      ensure_demurrage_dispute: {
        Args: {
          p_customer_id: number
          p_invoice_id: number
          p_opened_by: string
          p_subject?: string
        }
        Returns: number
      }
      ensure_pricing_rule_version: {
        Args: {
          p_charge_item_id: number
          p_charge_table_id: number
          p_customer_id: number
          p_metadata?: Json
          p_reference_date: string
        }
        Returns: number
      }
      evaluate_and_dispatch_automatic_communications: {
        Args: { p_as_of?: string }
        Returns: Json
      }
      extract_ncm_codes: { Args: { p_text: string }; Returns: string[] }
      extract_review_cnpjs_from_text: {
        Args: { p_text: string }
        Returns: string[]
      }
      fanout_alert_item: {
        Args: { p_alert_id: number; p_event_id: number; p_item_id: number }
        Returns: number
      }
      fanout_alert_item_for_department: {
        Args: {
          p_alert_id: number
          p_department: string
          p_event_id: number
          p_item_id: number
        }
        Returns: number
      }
      find_due_customer_communication_automations: {
        Args: { p_as_of?: string; p_voyage_id?: number }
        Returns: Json
      }
      get_agency_report_actor_names: {
        Args: { p_port: string; p_voyage_id: number }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      get_agency_report_actor_names_by_report_id: {
        Args: { p_report_id: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      get_agency_report_closer_name: {
        Args: { p_port: string; p_voyage_id: number }
        Returns: string
      }
      get_billing_run_details: {
        Args: { p_billing_run_id: number }
        Returns: Json
      }
      get_bl_portal_status: { Args: { p_bl_id: string }; Returns: Json }
      get_consolidated_invoice_item_breakdown: {
        Args: { p_invoice_id: number }
        Returns: {
          bl_id: string
          calculation_key: string
          charge_calculation_id: number
          charge_item_id: number
          charge_name: string
          charge_table_id: number
          currency: string
          quantity: number
          total_value_brl: number
          total_value_usd: number
          unit_value_brl: number
          unit_value_usd: number
        }[]
      }
      get_customer_portal_account: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      get_customer_receivables: {
        Args: { p_customer_id: number }
        Returns: {
          balance_brl: number
          bl_id: string
          id: number
          original_amount_brl: number
          settled_amount_brl: number
          status: string
        }[]
      }
      get_demurrage_recent_values: {
        Args: { p_date: string; p_invoice_id: number }
        Returns: {
          event_date: string
          ptax_used: number
          total_brl: number
        }[]
      }
      get_invoice_pending_refund: {
        Args: { p_invoice_id: number }
        Returns: number
      }
      get_voyage_eligible_pods: {
        Args: { p_voyage_id: number }
        Returns: {
          pod: string
        }[]
      }
      get_voyage_first_brazilian_eta: {
        Args: { p_voyage_id: number }
        Returns: string
      }
      import_baplie_staging_transactional: {
        Args: { p_rows: Json; p_voyage_id: number }
        Returns: number
      }
      import_bl_freight_transactional: {
        Args: { p_bls: Json; p_changed_by: string }
        Returns: Json
      }
      import_bl_freight_transactional_legacy_205: {
        Args: { p_bls: Json; p_changed_by: string }
        Returns: Json
      }
      import_bl_freight_transactional_legacy_284: {
        Args: { p_bls: Json; p_changed_by: string }
        Returns: Json
      }
      import_bl_freight_transactional_legacy_322: {
        Args: { p_bls: Json; p_changed_by: string }
        Returns: Json
      }
      import_bl_freight_transactional_legacy_357: {
        Args: { p_bls: Json; p_changed_by: string }
        Returns: Json
      }
      import_bl_freight_with_metadata: {
        Args: { p_batch?: Json; p_bls: Json; p_changed_by: string }
        Returns: Json
      }
      import_breakbulk_manifest_transactional: {
        Args: {
          p_bls: Json
          p_errors: Json
          p_filename: string
          p_items: Json
          p_total_bls: number
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_granite_manifest_transactional: {
        Args: {
          p_bls: Json
          p_discharge_port: string
          p_loading_port: string
          p_total_bls: number
          p_total_weight_kg: number
          p_uploaded_by: string
          p_vessel_voyage: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_granite_manifest_transactional_legacy_136: {
        Args: {
          p_bls: Json
          p_discharge_port: string
          p_loading_port: string
          p_total_bls: number
          p_total_weight_kg: number
          p_uploaded_by: string
          p_vessel_voyage: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_manifest_transactional: {
        Args: {
          p_apply_overwrites?: boolean
          p_bls: Json
          p_cargo_mode: string
          p_containers: Json
          p_errors: Json
          p_file_hash: string
          p_filename: string
          p_total_bls: number
          p_total_containers: number
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: number
      }
      import_manifest_transactional_legacy_165: {
        Args: {
          p_apply_overwrites?: boolean
          p_bls: Json
          p_cargo_mode: string
          p_containers: Json
          p_errors: Json
          p_file_hash: string
          p_filename: string
          p_total_bls: number
          p_total_containers: number
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: number
      }
      import_vazios_bookings_transactional: {
        Args: {
          p_bookings: Json
          p_port: string
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_vazios_importacao_transactional: {
        Args: {
          p_containers: Json
          p_description: string
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      import_vehicle_rows_transactional: {
        Args: { p_rows: Json }
        Returns: number
      }
      insert_billing_run_log: {
        Args: {
          p_billing_run_id: number
          p_bl_id: string
          p_code: string
          p_details?: Json
          p_level: string
          p_manifest_id: number
          p_message: string
        }
        Returns: undefined
      }
      internal_save_customer_contact_configuration: {
        Args: {
          p_contacts: Json
          p_customer_id: number
          p_justification?: string
        }
        Returns: Json
      }
      is_active_read_user: { Args: never; Returns: boolean }
      is_active_user: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_financeiro_user: { Args: never; Returns: boolean }
      is_valid_cnpj: { Args: { p_value: string }; Returns: boolean }
      link_invoice_to_ledger: {
        Args: { p_invoice_id: number }
        Returns: undefined
      }
      link_pix_reconciliation_candidate: {
        Args: {
          p_demurrage_invoice_id?: number
          p_exception_id: number
          p_invoice_id?: number
          p_resolution_source: string
        }
        Returns: Json
      }
      list_alert_queue: {
        Args: {
          p_department?: string
          p_entity_type?: string
          p_filter?: string
        }
        Returns: Json[]
      }
      list_alert_queue_page: {
        Args: {
          p_department?: string
          p_entity_type?: string
          p_filter?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json[]
      }
      list_billing_runs: {
        Args: { p_limit?: number }
        Returns: {
          blocked_bls: number
          calculated_bls: number
          completed_at: string
          eligible_bls: number
          filename: string
          id: number
          manifest_id: number
          started_at: string
          status: string
          total_bls: number
          total_brl: number
          total_usd: number
          trigger_source: string
        }[]
      }
      list_bl_local_charge_lines: {
        Args: { p_bl_id: string }
        Returns: {
          application_basis: string
          bl_id: string
          calculated_at: string
          calculation_key: string
          charge_item_id: number
          charge_name: string
          charge_table_id: number
          charge_table_name: string
          charge_table_pod: string
          currency: string
          id: number
          notes: string
          override_applied: boolean
          quantity: number
          review_reason: string
          source: string
          status: string
          total_value_brl: number
          total_value_usd: number
          unit_value_brl: number
          unit_value_usd: number
        }[]
      }
      list_consolidatable_receivables: {
        Args: { p_customer_id: number; p_search?: string; p_voyage_id?: number }
        Returns: {
          balance_brl: number
          bl_id: string
          customer_cnpj_cpf: string
          customer_id: number
          customer_name: string
          eligibility_reason: string
          eligibility_status: string
          individual_invoice_id: number
          individual_invoice_number: string
          original_amount_brl: number
          receivable_id: number
          receivable_status: string
          vessel_name: string
          voyage_id: number
          voyage_number: string
        }[]
      }
      list_customer_communication_saved_templates: {
        Args: never
        Returns: {
          body: string
          created_at: string
          created_by: string | null
          id: number
          name: string
          subject: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "customer_communication_saved_templates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_customer_reconciliation_queue: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          approved_at: string
          billing_hold_reason: string
          bl_id: string
          charge_status: string
          cnpj_cpf: string
          created_at: string
          current_customer_name: string
          customer_id: number
          detection_type: string
          financial_status: string
          id: number
          manifest_customer_email: string
          manifest_customer_name: string
          manifest_id: number
          notes: string
          rejected_at: string
          resolution_notes: string
          status: string
        }[]
      }
      list_demurrage_disputes_internal: {
        Args: { p_state?: string }
        Returns: Json
      }
      list_demurrage_dunning_claim_statuses: {
        Args: { p_invoice_ids: number[] }
        Returns: {
          attempt_count: number
          invoice_id: number
          last_attempt_at: string
        }[]
      }
      list_import_effects: {
        Args: { p_entity_id?: string; p_limit?: number; p_status?: string }
        Returns: {
          attempts: number
          created_at: string
          created_by: string | null
          depends_on_effect_id: number | null
          effect_kind: string
          entity_id: string
          id: number
          last_error_code: string | null
          last_error_message: string | null
          lease_until: string | null
          leased_by: string | null
          next_attempt_at: string
          result: Json | null
          source_action_id: string
          source_revision: number
          source_snapshot: Json
          status: string
          superseded_by_effect_id: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "import_pending_effects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_internal_notifications: {
        Args: {
          p_before_created_at?: string
          p_before_id?: number
          p_include_read?: boolean
          p_limit?: number
        }
        Returns: Json[]
      }
      list_invoice_details: { Args: { p_invoice_id: number }; Returns: Json }
      list_invoice_refunds: {
        Args: { p_invoice_id: number }
        Returns: {
          amount_brl: number
          cod_adjustment_id: number
          created_at: string
          id: number
          notes: string
          payment_id: number
          settled_at: string
          status: string
        }[]
      }
      list_manual_charge_items_for_bl: {
        Args: { p_bl_id: string }
        Returns: {
          cargo_mode: string
          charge_item_id: number
          charge_item_name: string
          charge_table_id: number
          charge_table_name: string
          currency: string
          default_unit_value_brl: number
          default_unit_value_usd: number
          effective_unit_value_brl: number
          effective_unit_value_usd: number
          pod: string
        }[]
      }
      list_pix_reconciliation_candidates: {
        Args: { p_exception_id: number }
        Returns: {
          amount_brl: number
          doc_number: string
          invoice_id: number
          source: string
        }[]
      }
      list_pix_reconciliation_exceptions: {
        Args: { p_status?: string }
        Returns: {
          amount_brl: number
          candidate_count: number
          cnpj: string
          created_at: string
          id: number
          import_key: string
          line_number: number
          metadata: Json
          normalized_txid: string
          paid_at: string | null
          reason: string
          resolution_source: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_demurrage_invoice_id: number | null
          resolved_invoice_id: number | null
          status: string
          txid: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pix_reconciliation_exceptions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mark_all_internal_notifications_read: { Args: never; Returns: number }
      mark_bl_charges_reviewed: {
        Args: { p_actor?: string; p_bl_id: string }
        Returns: Json
      }
      mark_bl_ready_and_create_invoice: {
        Args: {
          p_actor?: string
          p_bl_id: string
          p_customer_id?: number
          p_notes?: string
        }
        Returns: Json
      }
      mark_bl_ready_for_billing: {
        Args: { p_actor?: string; p_bl_id: string }
        Returns: Json
      }
      mark_bls_ready_and_create_invoice: {
        Args: {
          p_actor?: string
          p_bl_ids: string[]
          p_customer_id: number
          p_notes?: string
        }
        Returns: Json
      }
      mark_internal_notification_read: {
        Args: { p_notification_id: number }
        Returns: boolean
      }
      normalize_cnpj: { Args: { p_value: string }; Returns: string }
      normalize_document_text: { Args: { p_value: string }; Returns: string }
      normalize_ncm_codes: { Args: { p_codes: Json }; Returns: string[] }
      normalize_pix_txid: { Args: { p_txid: string }; Returns: string }
      normalize_port_code: { Args: { p_value: string }; Returns: string }
      obsolete_consolidated_invoice: {
        Args: { p_actor?: string; p_invoice_id: number; p_reason?: string }
        Returns: Json
      }
      omit_voyage_escala: {
        Args: {
          p_changed_by: string
          p_discharge_pod: string
          p_omitted_pod: string
          p_onward_carrier?: string
          p_onward_eta?: string
          p_onward_etd?: string
          p_onward_vessel_name?: string
          p_onward_voyage_number?: string
          p_reason: string
          p_voyage_id: number
        }
        Returns: number
      }
      operational_list_bl_summary: {
        Args: {
          p_cargo_mode?: string
          p_cargo_profile?: string
          p_charge_status?: string
          p_financial_status?: string
          p_pod?: string
          p_pol?: string
          p_review_status?: string
          p_search?: string
          p_voyage_id?: number
        }
        Returns: Json
      }
      operational_list_bls: {
        Args: {
          p_cargo_mode?: string
          p_cargo_profile?: string
          p_charge_status?: string
          p_financial_status?: string
          p_page?: number
          p_page_size?: number
          p_pod?: string
          p_pol?: string
          p_review_status?: string
          p_search?: string
          p_voyage_id?: number
        }
        Returns: Json
      }
      operational_list_containers: {
        Args: {
          p_cargo_mode?: string
          p_cargo_profile?: string
          p_charge_status?: string
          p_container_type?: string
          p_financial_status?: string
          p_page?: number
          p_page_size?: number
          p_pod?: string
          p_pol?: string
          p_review_status?: string
          p_search?: string
          p_vehicle_container?: boolean
          p_voyage_id?: number
        }
        Returns: Json
      }
      operational_list_voyage_summaries: {
        Args: {
          p_page?: number
          p_page_size?: number
        }
        Returns: Json
      }
      pix_crc16_ccitt: { Args: { p_payload: string }; Returns: string }
      pix_reconciliation_authority_holds: {
        Args: { p_exception_id: number }
        Returns: boolean
      }
      pix_tlv: { Args: { p_id: string; p_value: string }; Returns: string }
      portal_add_dispute_message: {
        Args: { p_body: string; p_demurrage_invoice_id: number }
        Returns: Json
      }
      portal_admin_change_cnpj: {
        Args: { p_customer_id: number; p_new_cnpj: string; p_reason: string }
        Returns: undefined
      }
      portal_assisted_email_change: {
        Args: {
          p_customer_id: number
          p_new_email: string
          p_reason: string
          p_request_id?: string
        }
        Returns: undefined
      }
      portal_billing_gate: { Args: { p_bl_id: string }; Returns: Json }
      portal_cancel_invite: {
        Args: { p_customer_id: number; p_reason: string; p_request_id?: string }
        Returns: undefined
      }
      portal_create_consolidation: {
        Args: { p_receivable_ids: number[] }
        Returns: Json
      }
      portal_current_role: { Args: never; Returns: string }
      portal_get_contact_configuration: { Args: never; Returns: Json }
      portal_get_current_roe: {
        Args: never
        Returns: {
          roe: number
          updated_at: string
        }[]
      }
      portal_get_current_roe_legacy: {
        Args: never
        Returns: {
          roe: number
          updated_at: string
        }[]
      }
      portal_get_demurrage_invoice_detail: {
        Args: { p_invoice_id: number }
        Returns: Json
      }
      portal_get_demurrage_invoice_detail_legacy: {
        Args: { p_invoice_id: number }
        Returns: Json
      }
      portal_get_profile: { Args: never; Returns: Json }
      portal_get_profile_legacy: { Args: never; Returns: Json }
      portal_get_session_overview_v2: { Args: never; Returns: Json }
      portal_inspect_get_contact_configuration: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      portal_inspect_get_current_roe: {
        Args: { p_customer_id: number }
        Returns: {
          roe: number
          updated_at: string
        }[]
      }
      portal_inspect_get_demurrage_invoice_detail: {
        Args: { p_customer_id: number; p_invoice_id: number }
        Returns: Json
      }
      portal_inspect_get_profile: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      portal_inspect_invoice_details: {
        Args: { p_customer_id: number; p_invoice_id: number }
        Returns: Json
      }
      portal_inspect_list_consolidatable_receivables: {
        Args: { p_customer_id: number }
        Returns: {
          balance_brl: number
          bl_id: string
          customer_cnpj_cpf: string
          customer_id: number
          customer_name: string
          eligibility_reason: string
          eligibility_status: string
          individual_invoice_id: number
          individual_invoice_number: string
          original_amount_brl: number
          receivable_id: number
          receivable_status: string
          vessel_name: string
          voyage_id: number
          voyage_number: string
        }[]
      }
      portal_inspect_list_demurrage_invoices: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      portal_inspect_list_demurrage_invoices_page: {
        Args: {
          p_bl?: string
          p_customer_id: number
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_pod?: string
          p_status?: string
          p_vessel?: string
        }
        Returns: Json
      }
      portal_inspect_list_disputes: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      portal_inspect_list_invoices: {
        Args: { p_customer_id: number }
        Returns: {
          balance_brl: number
          bls: string[]
          id: number
          invoice_number: string
          invoice_type: string
          issued_at: string
          pods: string[]
          status: string
          total_brl: number
          total_paid_brl: number
          vessel_voyages: string[]
          vessels: string[]
          voyages: string[]
        }[]
      }
      portal_inspect_list_invoices_page: {
        Args: {
          p_bl?: string
          p_customer_id: number
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_pod?: string
          p_status?: string
          p_vessel?: string
        }
        Returns: Json
      }
      portal_inspect_list_notifications: {
        Args: { p_customer_id: number; p_limit?: number }
        Returns: Json
      }
      portal_inspect_list_operation_bls: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      portal_inspect_notification_unread_count: {
        Args: { p_customer_id: number }
        Returns: number
      }
      portal_invoice_details: { Args: { p_invoice_id: number }; Returns: Json }
      portal_invoice_details_legacy: {
        Args: { p_invoice_id: number }
        Returns: Json
      }
      portal_list_consolidatable_receivables: {
        Args: never
        Returns: {
          balance_brl: number
          bl_id: string
          customer_cnpj_cpf: string
          customer_id: number
          customer_name: string
          eligibility_reason: string
          eligibility_status: string
          individual_invoice_id: number
          individual_invoice_number: string
          original_amount_brl: number
          receivable_id: number
          receivable_status: string
          vessel_name: string
          voyage_id: number
          voyage_number: string
        }[]
      }
      portal_list_consolidatable_receivables_legacy: {
        Args: never
        Returns: {
          balance_brl: number
          bl_id: string
          customer_cnpj_cpf: string
          customer_id: number
          customer_name: string
          eligibility_reason: string
          eligibility_status: string
          individual_invoice_id: number
          individual_invoice_number: string
          original_amount_brl: number
          receivable_id: number
          receivable_status: string
          vessel_name: string
          voyage_id: number
          voyage_number: string
        }[]
      }
      portal_list_demurrage_invoices: { Args: never; Returns: Json }
      portal_list_demurrage_invoices_legacy: { Args: never; Returns: Json }
      portal_list_demurrage_invoices_page: {
        Args: {
          p_bl?: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_pod?: string
          p_status?: string
          p_vessel?: string
        }
        Returns: Json
      }
      portal_list_disputes: { Args: never; Returns: Json }
      portal_list_invoices: {
        Args: never
        Returns: {
          balance_brl: number
          bls: string[]
          id: number
          invoice_number: string
          invoice_type: string
          issued_at: string
          pods: string[]
          status: string
          total_brl: number
          total_paid_brl: number
          vessel_voyages: string[]
          vessels: string[]
          voyages: string[]
        }[]
      }
      portal_list_invoices_page: {
        Args: {
          p_bl?: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_pod?: string
          p_status?: string
          p_vessel?: string
        }
        Returns: Json
      }
      portal_list_notifications: { Args: { p_limit?: number }; Returns: Json }
      portal_list_notifications_legacy: {
        Args: { p_limit?: number }
        Returns: Json
      }
      portal_list_operation_bls: { Args: never; Returns: Json }
      portal_list_operation_bls_legacy: { Args: never; Returns: Json }
      portal_list_operation_bls_without_transshipment_legacy: {
        Args: never
        Returns: Json
      }
      portal_list_provisioning_console: {
        Args: { p_customer_id?: number }
        Returns: Json[]
      }
      portal_list_provisioning_console_legacy: {
        Args: { p_customer_id?: number }
        Returns: Json[]
      }
      portal_list_provisioning_events: {
        Args: { p_customer_id: number; p_limit?: number }
        Returns: {
          account_id: number | null
          actor_id: string | null
          actor_type: string
          created_at: string
          customer_id: number
          id: number
          invite_id: number | null
          new_decision: string | null
          new_situation: string | null
          previous_decision: string | null
          previous_situation: string | null
          reason: string | null
          request_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "portal_provisioning_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      portal_list_provisioning_events_legacy: {
        Args: { p_customer_id: number; p_limit?: number }
        Returns: {
          account_id: number | null
          actor_id: string | null
          actor_type: string
          created_at: string
          customer_id: number
          id: number
          invite_id: number | null
          new_decision: string | null
          new_situation: string | null
          previous_decision: string | null
          previous_situation: string | null
          reason: string | null
          request_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "portal_provisioning_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      portal_login_check_rate_limit: {
        Args: { p_login: string }
        Returns: boolean
      }
      portal_login_register_failure: {
        Args: { p_login: string }
        Returns: undefined
      }
      portal_login_register_success: {
        Args: { p_login: string }
        Returns: undefined
      }
      portal_mark_all_notifications_read: { Args: never; Returns: undefined }
      portal_mark_expired_invites: {
        Args: never
        Returns: {
          expired_count: number
        }[]
      }
      portal_mark_notification_read: {
        Args: { p_notification_id: number }
        Returns: undefined
      }
      portal_notification_unread_count: { Args: never; Returns: number }
      portal_notification_unread_count_legacy: { Args: never; Returns: number }
      portal_obsolete_consolidation: {
        Args: { p_invoice_id: number }
        Returns: Json
      }
      portal_open_demurrage_dispute: {
        Args: { p_demurrage_invoice_id: number; p_reason: string }
        Returns: Json
      }
      portal_open_inspection: {
        Args: { p_customer_id: number; p_origin?: string }
        Returns: Json
      }
      portal_provisioning_backfill: {
        Args: { p_request_id?: string }
        Returns: {
          created_records: number
        }[]
      }
      portal_recovery_check_rate_limit: {
        Args: { p_login: string }
        Returns: boolean
      }
      portal_recovery_register_failure: {
        Args: { p_login: string }
        Returns: undefined
      }
      portal_refresh_general_pendencies: { Args: never; Returns: undefined }
      portal_release_suppressed_email: {
        Args: { p_customer_id: number; p_email: string; p_reason: string }
        Returns: undefined
      }
      portal_repair_missing_accounts: { Args: never; Returns: number }
      portal_request_dispute_reopen: {
        Args: { p_body: string; p_dispute_id: number }
        Returns: undefined
      }
      portal_resolve_login: { Args: { p_login: string }; Returns: string }
      portal_return_to_analysis: {
        Args: {
          p_actor_type?: string
          p_customer_id: number
          p_reason: string
          p_request_id?: string
        }
        Returns: undefined
      }
      portal_revoke_sessions: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      portal_save_contact_configuration: {
        Args: { p_contacts: Json }
        Returns: Json
      }
      portal_set_exception: {
        Args: { p_customer_id: number; p_reason: string; p_request_id?: string }
        Returns: undefined
      }
      portal_ship_schedule: {
        Args: never
        Returns: {
          actual_value: string
          date_value: string
          imo_number: string
          kind: string
          omitted: boolean
          port_code: string
          vessel_name: string
          voyage: string
          voyage_id: number
        }[]
      }
      portal_update_profile: {
        Args: {
          p_address?: string
          p_city?: string
          p_contact_email?: string
          p_phone?: string
          p_state?: string
          p_zip?: string
        }
        Returns: Json
      }
      preflight_depots_terminal_port_mapping: { Args: never; Returns: Json }
      process_import_effect: {
        Args: { p_effect_id: number; p_worker_id: string }
        Returns: Json
      }
      process_portal_email_event: {
        Args: { p_event_id: number; p_worker_id: string }
        Returns: Json
      }
      recalculate_demurrage_invoices: {
        Args: { p_ptax: number; p_quote_date: string; p_source?: string }
        Returns: Json
      }
      recalculate_demurrage_invoices_manual: {
        Args: { p_ptax: number }
        Returns: Json
      }
      recompute_bl_review_status: { Args: { p_bl_id: string }; Returns: string }
      reconcile_agency_report_alerts: {
        Args: { p_deadline?: boolean; p_pending?: boolean; p_report_id: string }
        Returns: Json
      }
      reconcile_agency_report_alerts_for_scale: {
        Args: {
          p_atd: string
          p_deadline_eligible: boolean
          p_deleted?: boolean
          p_omitted?: boolean
          p_pending_eligible: boolean
          p_port: string
          p_voyage_id: number
        }
        Returns: Json
      }
      reconcile_bl_review_alerts: {
        Args: { p_bl_id: string; p_source?: string }
        Returns: undefined
      }
      reconcile_bl_review_alerts_item: {
        Args: {
          p_bl_id: string
          p_message: string
          p_reason: string
          p_reasons: string[]
          p_source: string
          p_type: string
        }
        Returns: undefined
      }
      reconcile_client_portal_alerts: { Args: never; Returns: Json }
      reconcile_customer_bl_review_alerts: {
        Args: { p_consignee: string; p_customer_id: number; p_source?: string }
        Returns: undefined
      }
      reconcile_granite_bl_review_alerts: {
        Args: { p_granite_bl_id: number; p_source?: string }
        Returns: undefined
      }
      reconcile_invoice_payment_by_txid: {
        Args: { p_amount_brl: number; p_paid_at?: string; p_txid: string }
        Returns: Json
      }
      reconcile_voyage_baplie_coverage_alerts: {
        Args: { p_source?: string; p_voyage_id: number }
        Returns: undefined
      }
      reconcile_voyage_baplie_missing_alerts: {
        Args: { p_source?: string; p_voyage_id: number }
        Returns: undefined
      }
      reconcile_voyage_bl_expected_alerts: {
        Args: { p_source?: string; p_voyage_id: number }
        Returns: undefined
      }
      reconcile_voyage_ce_mercante_missing_alerts: {
        Args: { p_source?: string; p_voyage_id: number }
        Returns: undefined
      }
      reconcile_voyage_export_after_atd_alerts: {
        Args: {
          p_port: string
          p_source?: string
          p_terminal_id: string
          p_voyage_id: number
        }
        Returns: undefined
      }
      reconcile_voyage_operation_alerts: {
        Args: { p_source?: string; p_voyage_id: number }
        Returns: undefined
      }
      reconcile_voyage_schedule_date_alerts: {
        Args: { p_port: string; p_source?: string; p_voyage_id: number }
        Returns: undefined
      }
      refresh_alert_aggregate: {
        Args: { p_alert_id: number }
        Returns: undefined
      }
      refresh_customer_communication_status: {
        Args: { p_communication_id: number }
        Returns: string
      }
      refresh_customer_reconciliation_queue_for_bl: {
        Args: { p_bl_id: string }
        Returns: undefined
      }
      refresh_demurrage_invoice_item_brl: {
        Args: { p_invoice_id: number }
        Returns: undefined
      }
      refresh_voyage_status_from_terminal_scales: {
        Args: { p_voyage_id: number }
        Returns: undefined
      }
      register_demurrage_payment: {
        Args: {
          p_invoice_id: number
          p_paid_at: string
          p_pix_txid?: string
          p_ptax_used?: number
          p_request_id: string
          p_total_brl?: number
        }
        Returns: Json
      }
      register_invoice_payment: {
        Args: {
          p_actor?: string
          p_amount_brl: number
          p_invoice_id: number
          p_notes?: string
          p_paid_at?: string
          p_payment_method?: string
        }
        Returns: Json
      }
      register_ledger_invoice_payment: {
        Args: {
          p_actor?: string
          p_amount_brl: number
          p_invoice_id: number
          p_method?: string
          p_notes?: string
          p_paid_at?: string
          p_pix_txid?: string
          p_source?: string
        }
        Returns: Json
      }
      register_portal_login_abuse: {
        Args: { p_customer_id: number; p_evidence: Json }
        Returns: Json
      }
      reject_customer_reconciliation: {
        Args: { p_actor?: string; p_notes?: string; p_queue_id: number }
        Returns: Json
      }
      release_customer_communication_automation_claim: {
        Args: { p_claim_key: string }
        Returns: boolean
      }
      release_demurrage_dunning_claim: {
        Args: {
          p_attempt_discriminator: number
          p_demurrage_invoice_id: number
        }
        Returns: boolean
      }
      relink_bl_customer: {
        Args: {
          p_bl_id: string
          p_changed_by: string
          p_customer_id: number
          p_reason?: string
        }
        Returns: Json
      }
      reopen_agency_departure_report: {
        Args: { p_justification: string; p_port: string; p_voyage_id: number }
        Returns: Json
      }
      reopen_agency_departure_report_by_report_id: {
        Args: {
          p_justification: string
          p_port: string
          p_report_id: string
          p_voyage_id: number
        }
        Returns: Json
      }
      reopen_demurrage_dispute: {
        Args: { p_dispute_id: number; p_reason: string }
        Returns: undefined
      }
      reopen_demurrage_invoice: {
        Args: { p_invoice_id: number; p_reason: string; p_request_id: string }
        Returns: Json
      }
      reopen_pix_reconciliation_exception: {
        Args: { p_exception_id: number; p_reason: string }
        Returns: undefined
      }
      reorder_vessel_schedules: { Args: { p_order: Json }; Returns: number }
      repair_customer_contact_box_fallbacks: {
        Args: { p_box_code?: string; p_customer_id: number; p_kind?: string }
        Returns: Json
      }
      replace_vazios_from_baplie_transactional: {
        Args: {
          p_description: string
          p_replace_existing?: boolean
          p_uploaded_by: string
          p_voyage_id: number
        }
        Returns: Json
      }
      reprocess_customer_billing_after_portal_activation: {
        Args: { p_customer_id: number }
        Returns: Json
      }
      resolve_alert_item: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_source?: string
          p_type: string
        }
        Returns: boolean
      }
      resolve_alert_item_for_department: {
        Args: {
          p_department: string
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_source?: string
          p_type: string
        }
        Returns: boolean
      }
      resolve_billing_alert: {
        Args: { p_bl_id: string; p_metadata?: Json; p_type: string }
        Returns: boolean
      }
      resolve_bl_local_charge_items: {
        Args: { p_bl_id: string; p_pod: string }
        Returns: {
          calculation_key: string
          charge_item_id: number
          charge_table_id: number
          notes: string
          override_applied: boolean
          quantity: number
          review_reason: string
          source: string
          status: string
          total_value_brl: number
          total_value_usd: number
          unit_value_brl: number
          unit_value_usd: number
        }[]
      }
      resolve_local_charge_table_id: {
        Args: { p_cargo_mode: string; p_pod: string; p_reference_date?: string }
        Returns: number
      }
      resolve_pix_reconciliation_exception: {
        Args: {
          p_demurrage_invoice_id?: number
          p_exception_id: number
          p_invoice_id?: number
          p_resolution_source: string
          p_txid?: string
        }
        Returns: Json
      }
      retry_import_effect: {
        Args: { p_effect_id: number; p_justification: string }
        Returns: Json
      }
      reverse_demurrage_payment: {
        Args: { p_actor?: string; p_invoice_id: number; p_reason?: string }
        Returns: Json
      }
      reverse_invoice_payment: {
        Args: { p_actor?: string; p_payment_id: number; p_reason?: string }
        Returns: Json
      }
      revert_voyage_omission: {
        Args: {
          p_changed_by: string
          p_justification: string
          p_omission_id: number
        }
        Returns: undefined
      }
      review_bl_document_candidates: {
        Args: {
          p_cargo_description: string
          p_consignee_block: string
          p_manifest_cnpj: string
        }
        Returns: string[]
      }
      run_alert_detectors: { Args: never; Returns: Json }
      run_billing_for_import_batch: {
        Args: { p_actor?: string; p_batch_id: number; p_recalculate?: boolean }
        Returns: Json
      }
      save_bl_demurrage_config: {
        Args: {
          p_bl_id: string
          p_changed_by: string
          p_expected_updated_at: string
          p_free_time_override: number
          p_rate_p1_usd: number
          p_rate_p2_usd: number
        }
        Returns: undefined
      }
      save_bl_review: {
        Args: {
          p_audit_rows: Json
          p_bl_id: string
          p_changed_by: string
          p_expected_updated_at: string
          p_update_payload: Json
        }
        Returns: Json
      }
      save_customer_communication_saved_template: {
        Args: { p_body: string; p_name: string; p_subject: string }
        Returns: number
      }
      save_exchange_rate_reference: {
        Args: { p_effective_date: string; p_ptax: number; p_roe: number }
        Returns: undefined
      }
      save_exchange_rate_reference_v2: {
        Args: {
          p_effective_date: string
          p_ptax: number
          p_quote_date?: string
          p_roe: number
          p_source: string
        }
        Returns: Json
      }
      save_granite_bl_review: {
        Args: {
          p_changed_by: string
          p_client_id: number
          p_granite_bl_id: string
        }
        Returns: undefined
      }
      save_granite_bl_review_legacy_148: {
        Args: {
          p_changed_by: string
          p_client_id: number
          p_granite_bl_id: string
        }
        Returns: undefined
      }
      save_voyage_escala_terminal_state: {
        Args: {
          p_expected_revision: number
          p_export_expectation: Json
          p_fronts: Json
          p_justification: string
          p_port: string
          p_terminals: Json
          p_voyage_id: number
        }
        Returns: Json
      }
      save_voyage_escala_terminal_state_v2: {
        Args: {
          p_expected_revision: number
          p_export_expectation: Json
          p_fronts: Json
          p_justification: string
          p_port: string
          p_terminals: Json
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_department_signoff: {
        Args: {
          p_department: string
          p_justification?: string
          p_port: string
          p_signed: boolean
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_department_signoff_by_report_id: {
        Args: {
          p_department: string
          p_justification?: string
          p_port: string
          p_report_id: string
          p_signed: boolean
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_section_observation: {
        Args: {
          p_observation: string
          p_port: string
          p_section: string
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_section_observation_by_report_id: {
        Args: {
          p_observation: string
          p_port: string
          p_report_id: string
          p_section: string
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_signoff: {
        Args: {
          p_justification?: string
          p_port: string
          p_section: string
          p_state: string
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_signoff_by_report_id: {
        Args: {
          p_justification?: string
          p_port: string
          p_report_id: string
          p_section: string
          p_state: string
          p_voyage_id: number
        }
        Returns: Json
      }
      set_agency_report_terminal: {
        Args: { p_port: string; p_terminal: string; p_voyage_id: number }
        Returns: undefined
      }
      set_bl_cod: {
        Args: {
          p_bl_id: string
          p_changed_by: string
          p_justification: string
          p_omission_id: number
        }
        Returns: undefined
      }
      set_bl_transshipment: {
        Args: {
          p_bl_id: string
          p_changed_by: string
          p_justification: string
          p_omission_id: number
        }
        Returns: undefined
      }
      set_communications_enabled: {
        Args: { p_enabled: boolean }
        Returns: boolean
      }
      set_customer_portal_account_active: {
        Args: { p_active: boolean; p_actor?: string; p_customer_id: number }
        Returns: Json
      }
      set_demurrage_dunning_interval_days: {
        Args: { p_days: number }
        Returns: number
      }
      set_import_batch_ce_master: {
        Args: { p_batch_id: number; p_ce_master: string; p_changed_by: string }
        Returns: undefined
      }
      set_voyage_route_ce_master:
        | {
            Args: {
              p_ce_master: string
              p_changed_by: string
              p_pod: string
              p_pol: string
              p_voyage_id: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_cargo_mode?: string
              p_ce_master: string
              p_changed_by: string
              p_pod: string
              p_pol: string
              p_voyage_id: number
            }
            Returns: undefined
          }
      settle_cod_adjustment: {
        Args: {
          p_actor?: string
          p_adjustment_id: number
          p_resulting_document_id?: number
          p_resulting_document_type?: string
        }
        Returns: Json
      }
      settle_invoice_refund: {
        Args: { p_actor?: string; p_refund_id: number }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      summarize_alert_queue_by_department: {
        Args: never
        Returns: {
          active_count: number
          department: string
          dismissed_count: number
          is_legacy: boolean
        }[]
      }
      sync_customer_reconciliation_queue_for_bl: {
        Args: { p_bl_id: string }
        Returns: undefined
      }
      sync_demurrage_dispute_alert_for_invoice: {
        Args: { p_demurrage_invoice_id: number; p_next_responder: string }
        Returns: undefined
      }
      sync_local_charge_receivable: {
        Args: { p_bl_id: string }
        Returns: number
      }
      update_container_demurrage_dates: {
        Args: {
          p_container_id: number
          p_demurrage_status: string
          p_discharge_date: string
          p_justification?: string
          p_return_date: string
        }
        Returns: undefined
      }
      update_customer_with_audit: {
        Args: {
          p_changed_by: string
          p_customer_id: number
          p_justification: string
          p_updates: Json
        }
        Returns: boolean
      }
      update_manual_bl_charge: {
        Args: {
          p_actor?: string
          p_charge_calculation_id: number
          p_notes?: string
          p_quantity: number
        }
        Returns: Json
      }
      update_manual_vazios_booking: {
        Args: {
          p_booking_id: string
          p_condition: string
          p_container_number: string
          p_container_type: string
          p_hand_in_date: string
          p_hand_out_date: string
          p_local_id: string
          p_movement_date: string
        }
        Returns: undefined
      }
      update_voyage_omission: {
        Args: {
          p_changed_by: string
          p_omission_id: number
          p_onward_carrier: string
          p_onward_eta: string
          p_onward_etd: string
          p_onward_vessel_name: string
          p_onward_voyage_number: string
          p_reason: string
        }
        Returns: undefined
      }
      upsert_alert_item:
        | {
            Args: {
              p_department: string
              p_destination?: string
              p_entity_id: string
              p_entity_type: string
              p_message: string
              p_metadata?: Json
              p_source: string
              p_type: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_destination?: string
              p_entity_id: string
              p_entity_type: string
              p_message: string
              p_metadata?: Json
              p_source: string
              p_type: string
            }
            Returns: Json
          }
      upsert_alert_item_before_milestone_hardening: {
        Args: {
          p_department: string
          p_destination?: string
          p_entity_id: string
          p_entity_type: string
          p_message: string
          p_metadata?: Json
          p_source: string
          p_type: string
        }
        Returns: Json
      }
      upsert_billing_alert: {
        Args: {
          p_bl_id: string
          p_message: string
          p_metadata?: Json
          p_type: string
        }
        Returns: Json
      }
      upsert_customer_portal_account: {
        Args: {
          p_active?: boolean
          p_actor?: string
          p_contact_email?: string
          p_customer_id: number
          p_login_cnpj?: string
          p_password: string
        }
        Returns: Json
      }
      upsert_pix_reconciliation_exceptions: {
        Args: { p_import_key: string; p_rows: Json }
        Returns: Json
      }
      upsert_portal_invoice_exception: {
        Args: { p_bl_id: string; p_invoice_id: number }
        Returns: undefined
      }
      voyage_terminal_code: { Args: { p_terminal_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

// O gerador oficial preserva a nulabilidade do catálogo com exatidão. O
// cliente da aplicação, porém, envia `null` explicitamente para parâmetros
// opcionais e omite colunas nullable em inserts de formulários. Mantemos o
// output oficial em `Database` e aplicamos esta camada somente ao client
// usado pelo frontend, sem adulterar a representação do schema.
type NullableKeys<T> = {
  [K in keyof T]-?: null extends T[K] ? K : never
}[keyof T]

type RelaxedNullableInput<T> = Omit<T, NullableKeys<T>> & Partial<Pick<T, NullableKeys<T>>>

type NullableFunctionArgs<T> = {
  [K in keyof T]: T[K] | null
}

type AppTables = {
  [Name in keyof Database['public']['Tables']]: Omit<Database['public']['Tables'][Name], 'Insert' | 'Update'> & {
    Insert: RelaxedNullableInput<Database['public']['Tables'][Name]['Insert']>
    Update: Database['public']['Tables'][Name]['Update']
  }
}

type AppFunctions = {
  [Name in keyof Database['public']['Functions']]: Omit<Database['public']['Functions'][Name], 'Args'> & {
    Args: NullableFunctionArgs<Database['public']['Functions'][Name]['Args']>
  }
}

// ---------------------------------------------------------------------------
// Complementos de domínio e read-models
// ---------------------------------------------------------------------------
// O bloco acima é o output integral de @supabase/postgres-meta. Os aliases de
// linha abaixo derivam diretamente dele; tipos adicionais descrevem apenas
// regras de domínio, payloads externos e projeções compostas do frontend.

type FunctionWithArgs<
  Name extends keyof Database['public']['Functions'],
  Args,
> = Omit<Database['public']['Functions'][Name], 'Args'> & { Args: Args }

type AppFunctionOverrides = {
  apply_ce_mercante_manifest: FunctionWithArgs<
    'apply_ce_mercante_manifest',
    Omit<Database['public']['Functions']['apply_ce_mercante_manifest']['Args'], 'p_changed_by'> & {
      p_changed_by: string | null
    }
  >
  apply_ce_mercante_update: FunctionWithArgs<
    'apply_ce_mercante_update',
    Omit<Database['public']['Functions']['apply_ce_mercante_update']['Args'], 'p_changed_by'> & {
      p_changed_by: string | null
    }
  >
  apply_granite_ce_mercante_update: FunctionWithArgs<
    'apply_granite_ce_mercante_update',
    Omit<Database['public']['Functions']['apply_granite_ce_mercante_update']['Args'], 'p_changed_by'> & {
      p_changed_by: string | null
    }
  >
  create_demurrage_invoice_with_items: FunctionWithArgs<
    'create_demurrage_invoice_with_items',
    Omit<
      Database['public']['Functions']['create_demurrage_invoice_with_items']['Args'],
      'p_ready_at' | 'p_roe'
    > & {
      p_ready_at: string | null
      p_roe: number | null
    }
  >
  import_vazios_importacao_transactional: FunctionWithArgs<
    'import_vazios_importacao_transactional',
    Omit<Database['public']['Functions']['import_vazios_importacao_transactional']['Args'], 'p_description'> & {
      p_description: string | null
    }
  >
  omit_voyage_escala: FunctionWithArgs<
    'omit_voyage_escala',
    Omit<
      Database['public']['Functions']['omit_voyage_escala']['Args'],
      | 'p_reason'
      | 'p_onward_vessel_name'
      | 'p_onward_carrier'
      | 'p_onward_voyage_number'
      | 'p_onward_etd'
      | 'p_onward_eta'
    > & {
      p_reason: string | null
      p_onward_vessel_name?: string | null
      p_onward_carrier?: string | null
      p_onward_voyage_number?: string | null
      p_onward_etd?: string | null
      p_onward_eta?: string | null
    }
  >
  import_granite_manifest_transactional: FunctionWithArgs<
    'import_granite_manifest_transactional',
    Omit<
      Database['public']['Functions']['import_granite_manifest_transactional']['Args'],
      'p_loading_port' | 'p_discharge_port'
    > & {
      p_loading_port: string | null
      p_discharge_port: string | null
    }
  >
  replace_vazios_from_baplie_transactional: FunctionWithArgs<
    'replace_vazios_from_baplie_transactional',
    Omit<Database['public']['Functions']['replace_vazios_from_baplie_transactional']['Args'], 'p_description'> & {
      p_description: string | null
    }
  >
  save_bl_demurrage_config: FunctionWithArgs<
    'save_bl_demurrage_config',
    Omit<
      Database['public']['Functions']['save_bl_demurrage_config']['Args'],
      'p_expected_updated_at' | 'p_free_time_override' | 'p_rate_p1_usd' | 'p_rate_p2_usd'
    > & {
      p_expected_updated_at: string | null
      p_free_time_override: number | null
      p_rate_p1_usd: number | null
      p_rate_p2_usd: number | null
    }
  >
  save_bl_review: FunctionWithArgs<
    'save_bl_review',
    Omit<Database['public']['Functions']['save_bl_review']['Args'], 'p_expected_updated_at'> & {
      p_expected_updated_at: string | null
    }
  >
  update_voyage_omission: FunctionWithArgs<
    'update_voyage_omission',
    Omit<
      Database['public']['Functions']['update_voyage_omission']['Args'],
      'p_onward_vessel_name' | 'p_onward_carrier' | 'p_onward_voyage_number' | 'p_onward_etd' | 'p_onward_eta' | 'p_reason'
    > & {
      p_onward_vessel_name: string | null
      p_onward_carrier: string | null
      p_onward_voyage_number: string | null
      p_onward_etd: string | null
      p_onward_eta: string | null
      p_reason: string | null
    }
  >
}

// postgres-meta não infere nullability dos parâmetros de função. O cliente da
// aplicação usa estes overrides estritos, que refletem os parâmetros nullable
// declarados nas migrations sem alterar o output oficial acima.
export type AppDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables' | 'Functions'> & {
    Tables: AppTables
    Functions: Omit<AppFunctions, keyof AppFunctionOverrides> & AppFunctionOverrides
  }
}

export type UserProfileRole =
  | 'admin'
  | 'operator'
  | 'administrativo'
  | 'financeiro'
  | 'operacoes'
  | 'documentacao'
  | 'equipamentos'

export type UserProfile = Omit<Tables<'user_profiles'>, 'role'> & {
  role: UserProfileRole
}
export type AuditLog = Tables<'audit_logs'>
export type Alert = Tables<'alerts'>
export type Customer = Tables<'customers'>
export type CustomerContact = Tables<'customer_contacts'>
export type CustomerCommunicationNature =
  | 'avisos_gerais'
  | 'avisos_operacionais'
  | 'documentacao'
  | 'demurrage'
export type CustomerCommunicationKind =
  | 'aviso_chegada_noa'
  | 'aviso_prontidao_nor'
  | 'aviso_atracacao_nob'
  | 'ce_mercante_taxas'
  | 'cobranca_demurrage'
  | 'institucional'
  | 'livre'
export type CustomerCommunicationStatus = 'enviado' | 'simulado' | 'parcial' | 'falha'
export type CustomerCommunicationDispatchMode = 'real' | 'simulado'
export type CustomerCommunicationAttemptStatus =
  | 'aceito'
  | 'entregue'
  | 'bounce'
  | 'complaint'
  | 'falha_transitoria'
  | 'falha_permanente'
export type CustomerCommunicationKindMapping = Tables<'customer_communication_kinds'>
export type CustomerCommunicationBox = Tables<'customer_communication_boxes'>
export type CustomerCommunicationBoxKind = Tables<'customer_communication_box_kinds'>
export type CustomerCommunication = Tables<'customer_communications'>
export type CustomerCommunicationBl = Tables<'customer_communication_bls'>
export type CustomerCommunicationAttempt = Tables<'customer_communication_attempts'>
export type CustomerCommunicationSuppression = Tables<'customer_communication_suppressions'>
export type CustomerCommunicationAutomationClaim = Tables<'customer_communication_automation_claims'>
export type CustomerContactPreference = Tables<'customer_contact_preferences'>
export type CustomerContactBoxLinkTable = Tables<'customer_contact_box_links'>
export type CustomerContactChangeEvent = Tables<'customer_contact_change_events'>
export type AppSettings = Tables<'app_settings'>
export type CustomerPortalAccount = Tables<'customer_portal_accounts'>
export type PortalInvite = Tables<'portal_invites'>
export type PortalProvisioningEvent = Tables<'portal_provisioning_events'>
export type CustomerRateOverride = Tables<'customer_rate_overrides'>
export type ChargeTable = Tables<'charge_tables'>
export type ChargeTableItem = Tables<'charge_table_items'>
export type ChargeCalculation = Tables<'charge_calculations'>
export type Carrier = Tables<'carriers'>
export type Vessel = Tables<'vessels'>
export type Voyage = Tables<'voyages'>
export type Port = Tables<'ports'>
export type BL = Tables<'bls'>
export type BLContainer = Tables<'bl_containers'>
export type BlFreightLine = Tables<'bl_freight_lines'>
export type BLBreakbulkItem = Tables<'bl_breakbulk_items'>
export type Vehicle = Tables<'vehicles'>
export type ImportBatch = Tables<'import_batches'>
export type ImportError = Tables<'import_errors'>
export type Invoice = Tables<'invoices'>
export type InvoiceItem = Tables<'invoice_items'>
export type InvoicePayment = Tables<'payments'>
export type InvoiceBlLink = Tables<'invoice_bls'>
export type BlReceivable = Tables<'bl_receivables'>
export type InvoiceReceivableLink = Tables<'invoice_receivable_links'>
export type LedgerSettlement = Tables<'ledger_settlements'>
export type InvoiceLifecycleEvent = Tables<'invoice_lifecycle_events'>
export type InvoiceGraniteBlLink = Tables<'invoice_granite_bls'>
export type DemurrageInvoice = Omit<Tables<'demurrage_invoices'>, 'roe_source'> & {
  roe_source: RoeSource | null
}
export type DemurrageDunningClaim = Tables<'demurrage_dunning_claims'>
export type DemurrageInvoiceItem = Tables<'demurrage_invoice_items'>
export type DemurrageInvoiceHistory = Tables<'demurrage_invoice_history'>
export type DemurrageRate = Tables<'demurrage_rates'>
export type GraniteManifest = Tables<'granite_manifests'>
export type GraniteBl = Tables<'granite_bls'>
export type GraniteRate = Tables<'granite_rates'>
export type GraniteBlCharge = Tables<'granite_bl_charges'>
export type VaziosManifest = Tables<'vazios_manifests'>
export type VaziosBooking = Tables<'vazios_bookings'>
export type VaziosExportOperation = Tables<'vazios_export_operations'>
export type VaziosExportServiceLine = Tables<'vazios_export_service_lines'>
export type Depot = Tables<'depots'>
export type DepotService = Tables<'depot_services'>
export type AgencyDepartureReport = Tables<'agency_departure_reports'>
export type AgencyReportOccurrence = Tables<'agency_departure_report_occurrences'>
export type VaziosImportacaoManifest = Tables<'vazios_importacao_manifests'>
export type BaplieContainer = Tables<'baplie_containers'>
export type VesselSchedule = Tables<'vessel_schedules'>
export type EndedVessel = Tables<'ended_vessels'>

export type BlReceivableStatus = 'open' | 'partially_settled' | 'settled' | 'void'
export type InvoiceDocumentType = 'individual' | 'consolidated' | 'granite'
export type InvoiceDocumentStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'covered'
  | 'obsolete'
  | 'overdue'
  | 'cancelled'

type GeneratedConsolidatableReceivable =
  Database['public']['Functions']['list_consolidatable_receivables']['Returns'][number]

// PostgreSQL RETURNS TABLE não expõe nullability por coluna ao gerador. Esta
// projeção contém LEFT JOINs para viagem/navio/fatura individual; portanto os
// campos abaixo são nullable mesmo que o contrato oficial os marque como text.
export type ConsolidatableReceivable = Omit<
  GeneratedConsolidatableReceivable,
  | 'voyage_id'
  | 'vessel_name'
  | 'voyage_number'
  | 'individual_invoice_id'
  | 'individual_invoice_number'
  | 'receivable_status'
  | 'eligibility_status'
> & {
  voyage_id: number | null
  vessel_name: string | null
  voyage_number: string | null
  individual_invoice_id: number | null
  individual_invoice_number: string | null
  receivable_status: BlReceivableStatus
  eligibility_status: 'eligible' | 'paid' | 'no_balance' | 'open_consolidated'
}

export type LedgerPaymentResult = {
  invoice_id: number
          payment_id: number | null
  status: 'paid' | 'partially_paid'
  amount_brl: number
  balance_brl: number
  refund_due_brl: number
  receivables_settled: number
  individuals_covered: number
  consolidated_obsoleted: number
}

export type ConsolidatedInvoiceResult = {
  invoice_id: number
  invoice_number: string | null
  status: 'issued'
  invoice_type: 'consolidated'
  receivable_count: number
  total_brl: number
}

export type IndividualInvoiceResult = {
  invoice_id: number
  invoice_number: string
  status: string
  invoice_type: 'individual'
  receivable_id: number
  customer_id: number
  bl_count: number
  total_brl: number
  balance_brl: number
  existing: boolean
}

export type ReconcileByTxidResult =
  | { matched: false; reason: string }
  | { matched: true; invoice_id: number; settled: false; reason: string }
  | { matched: true; invoice_id: number; settled: true; payment: LedgerPaymentResult }

export type InvoiceSummary = Invoice & {
  customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
  invoice_bls?: Pick<InvoiceBlLink, 'id' | 'bl_id' | 'subtotal_brl' | 'subtotal_usd'>[] | null
}

export type DemurrageCalcResult = {
  total_days: number
  free_days: number
  days_p1: number
  rate_p1_usd: number
  days_p2: number
  rate_p2_usd: number
  total_usd: number
  status: 'within_free_time' | 'overdue'
}

export type RoeSource = 'bcb_live' | 'cached' | 'manual'

export type DemurrageInvoiceDetail = DemurrageInvoice & {
  items: DemurrageInvoiceItem[]
  customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
  bl?: (Pick<BL, 'id' | 'pol' | 'pod'> & {
    voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    }) | null
  }) | null
}

export type DemurrageContainerListItem = Pick<
  BLContainer,
  'id' | 'bl_id' | 'container_number' | 'type' | 'discharge_date' | 'return_date' | 'demurrage_status'
> & {
  bl?: (Pick<
    BL,
    | 'id'
    | 'pol'
    | 'pod'
    | 'free_time_override'
    | 'demurrage_rate_override_p1_usd'
    | 'demurrage_rate_override_p2_usd'
    | 'demurrage_roe_manual'
    | 'demurrage_roe'
  > & {
    customer?: Pick<Customer, 'id' | 'name' | 'cnpj_cpf'> | null
    voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    }) | null
  }) | null
}

export type PixTransaction = {
  txid: string
  cnpj: string
  date: string
  amount: number
  lineNumber?: number
}

export type BLListItem = BL & {
  customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
  voyage?: (Pick<Voyage, 'id' | 'voyage_number' | 'eta' | 'ata' | 'status'> & {
    vessel?: (Pick<Vessel, 'id' | 'name' | 'imo'> & {
      carrier?: Pick<Carrier, 'id' | 'name' | 'scac'> | null
    }) | null
  }) | null
  bl_containers?: Pick<
    BLContainer,
    | 'id'
    | 'bl_id'
    | 'container_number'
    | 'seal_number'
    | 'type'
    | 'tare_weight_kg'
    | 'gross_weight_kg'
    | 'cbm'
    | 'is_oog'
    | 'is_imo'
    | 'imo_class'
    | 'un_number'
    | 'created_at'
    // A linha expansivel de /bls mostra a data de descarga. A RPC
    // operational_list_bls ja projetava a coluna (to_jsonb(bc) devolve a linha
    // inteira); quem nao a trazia era o select de export, corrigido junto.
    | 'discharge_date'
  >[]
  bl_freight_lines?: BlFreightLine[] | null
  bl_breakbulk_items?: Pick<
    BLBreakbulkItem,
    'id' | 'bl_id' | 'item_description' | 'package_qty' | 'package_unit' | 'gross_weight_kg' | 'cbm' | 'marks' | 'created_at'
  >[]
}

export type BLDetail = BL & {
  customer?: Customer | null
  voyage?: (Voyage & {
    vessel?: (Vessel & {
      carrier?: Carrier | null
    }) | null
  }) | null
  terminal?: { id?: string; name?: string | null } | null
  bl_containers?: BLContainer[]
  bl_freight_lines?: BlFreightLine[] | null
  bl_breakbulk_items?: BLBreakbulkItem[]
  vehicles?: VehicleListItem[] | null
}

export type ContainerListItem = Pick<
  BLContainer,
  | 'id'
  | 'bl_id'
  | 'container_number'
  | 'seal_number'
  | 'type'
  | 'tare_weight_kg'
  | 'gross_weight_kg'
  | 'cbm'
  | 'is_oog'
  | 'is_imo'
  | 'imo_class'
  | 'un_number'
  | 'created_at'
> & {
  bl?: (Pick<BL, 'id' | 'pol' | 'pod' | 'review_status' | 'financial_status' | 'charge_status' | 'consignee'> & {
    customer?: Pick<Customer, 'id' | 'cnpj_cpf' | 'name'> | null
    voyage?: (Pick<Voyage, 'id' | 'voyage_number' | 'eta' | 'ata' | 'status'> & {
      vessel?: (Pick<Vessel, 'id' | 'name' | 'imo'> & {
        carrier?: Pick<Carrier, 'id' | 'name' | 'scac'> | null
      }) | null
    }) | null
  }) | null
}

export type CustomerListItem = Customer & {
  bls?: Pick<BL, 'id' | 'charge_status'>[] | null
  customer_contacts?: Array<Pick<CustomerContact, 'id' | 'email' | 'purpose' | 'is_primary'> & {
    deactivated_at?: string | null
    origin?: string | null
    customer_contact_box_links?: Array<{ box_code: string }> | null
  }> | null
}

export type CustomerDetail = Customer & {
  customer_contacts?: Array<CustomerContact & {
    deactivated_at?: string | null
    origin?: string | null
    customer_contact_box_links?: Array<{ box_code: string }> | null
    customer_contact_preferences?: CustomerContactPreference[] | null
  }> | null
  bls?: Pick<BL, 'id' | 'consignee' | 'financial_status' | 'review_status' | 'created_at'>[] | null
  invoices?: Pick<Invoice, 'id' | 'invoice_number' | 'issued_at' | 'total_brl' | 'balance_brl' | 'status'>[] | null
  invoices_access_denied?: boolean
}

export type VehicleListItem = Vehicle & {
  container?: Pick<BLContainer, 'id' | 'container_number' | 'type' | 'seal_number'> | null
  bl?: (Pick<BL, 'id' | 'voyage_id'> & {
    voyage?: (Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    }) | null
  }) | null
}

export type GraniteBlListItem = GraniteBl & {
  manifest?: Pick<GraniteManifest, 'id' | 'vessel_voyage' | 'voyage_id'> | null
  customer?: Pick<Customer, 'id' | 'name'> | null
}

export type VaziosBookingListItem = VaziosBooking & {
  manifest?: Pick<VaziosManifest, 'id' | 'voyage_id'> & {
    voyage?: Pick<Voyage, 'id' | 'voyage_number'> & {
      vessel?: Pick<Vessel, 'id' | 'name'> | null
    } | null
  } | null
}

// Seis seções vivas — espelha o CHECK de agency_departure_report_signoffs.section
// (migration 253). 'ocorrencias' saiu na ADR 0030 e 'operacao_patio' na 0036;
// as duas seguem em audit_logs e snapshots fechados, e são lidas por
// agencyReportSectionLabel, não por este tipo.
export type AgencyReportSectionKey =
  | 'datas'
  | 'carga_descarregada'
  | 'carga_carregada'
  | 'veiculos'
  | 'vazios_embarcados'
  | 'vazios_descarregados'

export type AgencyReportDepartmentKey = 'operacoes' | 'documentacao' | 'equipamentos'

export type AgencyReportSignoff = Omit<
  Tables<'agency_departure_report_signoffs'>,
  'section' | 'state'
> & {
  section: AgencyReportSectionKey
  state: 'pending' | 'confirmed' | 'nothing_to_declare'
}

export type AgencyReportDepartmentSignoff = Omit<
  Tables<'agency_departure_report_department_signoffs'>,
  'department'
> & {
  department: AgencyReportDepartmentKey
}

export type VaziosImportacaoContainer = Omit<
  Tables<'vazios_importacao_containers'>,
  'natureza'
> & {
  natureza: 'cama' | 'cover_plate' | null
}

export type VaziosImportacaoContainerListItem = VaziosImportacaoContainer & {
  manifest?: (Pick<VaziosImportacaoManifest, 'id' | 'voyage_id' | 'description' | 'imported_at'> & {
    voyage?: { voyage_number: string; vessel: { name: string } | null } | null
  }) | null
}

export type VoyageExportSchedule = Omit<
  Tables<'voyage_export_schedules'>,
  'ce_status'
> & {
  ce_status: 'waiting' | 'received' | 'launching' | 'approving' | 'approved' | null
}

export type VoyageExportCeStatus = NonNullable<VoyageExportSchedule['ce_status']>
export type VoyageRecord = Tables<'voyages'>
export type ManifestoMercanteRecord = Tables<'manifestos_mercante'>
