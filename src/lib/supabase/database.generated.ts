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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      app_notifications: {
        Row: {
          body: string
          created_at: string
          deal_id: string | null
          id: string
          link_href: string | null
          metadata_json: Json | null
          organization_id: string
          override_request_id: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deal_id?: string | null
          id?: string
          link_href?: string | null
          metadata_json?: Json | null
          organization_id: string
          override_request_id?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deal_id?: string | null
          id?: string
          link_href?: string | null
          metadata_json?: Json | null
          organization_id?: string
          override_request_id?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_notifications_override_request_id_fkey"
            columns: ["override_request_id"]
            isOneToOne: false
            referencedRelation: "deal_override_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value_json: Json | null
        }
        Insert: {
          key: string
          updated_at?: string
          value_json?: Json | null
        }
        Update: {
          key?: string
          updated_at?: string
          value_json?: Json | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          change_type: string | null
          changed_by_user_id: string | null
          created_at: string
          deal_id: string | null
          entity_type: string | null
          id: string
          meta: Json
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          change_type?: string | null
          changed_by_user_id?: string | null
          created_at?: string
          deal_id?: string | null
          entity_type?: string | null
          id?: string
          meta?: Json
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          change_type?: string | null
          changed_by_user_id?: string | null
          created_at?: string
          deal_id?: string | null
          entity_type?: string | null
          id?: string
          meta?: Json
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bhph_bureau_rules: {
        Row: {
          created_at: string
          hard_stop_if_bk_within_months: number | null
          hard_stop_if_repo_within_months: number | null
          id: string
          max_score: number | null
          max_term_months: number
          min_cash_down: number
          min_score: number | null
          tier: string
        }
        Insert: {
          created_at?: string
          hard_stop_if_bk_within_months?: number | null
          hard_stop_if_repo_within_months?: number | null
          id?: string
          max_score?: number | null
          max_term_months: number
          min_cash_down: number
          min_score?: number | null
          tier: string
        }
        Update: {
          created_at?: string
          hard_stop_if_bk_within_months?: number | null
          hard_stop_if_repo_within_months?: number | null
          id?: string
          max_score?: number | null
          max_term_months?: number
          min_cash_down?: number
          min_score?: number | null
          tier?: string
        }
        Relationships: []
      }
      bureau_messages: {
        Row: {
          bureau_summary_id: string
          code: string | null
          created_at: string
          deal_id: string
          id: string
          message_text: string
          message_type: string | null
          organization_id: string | null
          severity: string | null
        }
        Insert: {
          bureau_summary_id: string
          code?: string | null
          created_at?: string
          deal_id: string
          id?: string
          message_text: string
          message_type?: string | null
          organization_id?: string | null
          severity?: string | null
        }
        Update: {
          bureau_summary_id?: string
          code?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          message_text?: string
          message_type?: string | null
          organization_id?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bureau_messages_bureau_summary_id_fkey"
            columns: ["bureau_summary_id"]
            isOneToOne: false
            referencedRelation: "bureau_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_messages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bureau_public_records: {
        Row: {
          amount: number | null
          bad: boolean | null
          bureau_summary_id: string
          court_name: string | null
          created_at: string
          deal_id: string
          filed_date: string | null
          good: boolean | null
          id: string
          no_effect: boolean | null
          organization_id: string | null
          plaintiff: string | null
          raw_segment: Json | null
          record_type: string | null
          resolved_date: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          bad?: boolean | null
          bureau_summary_id: string
          court_name?: string | null
          created_at?: string
          deal_id: string
          filed_date?: string | null
          good?: boolean | null
          id?: string
          no_effect?: boolean | null
          organization_id?: string | null
          plaintiff?: string | null
          raw_segment?: Json | null
          record_type?: string | null
          resolved_date?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          bad?: boolean | null
          bureau_summary_id?: string
          court_name?: string | null
          created_at?: string
          deal_id?: string
          filed_date?: string | null
          good?: boolean | null
          id?: string
          no_effect?: boolean | null
          organization_id?: string | null
          plaintiff?: string | null
          raw_segment?: Json | null
          record_type?: string | null
          resolved_date?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bureau_public_records_bureau_summary_id_fkey"
            columns: ["bureau_summary_id"]
            isOneToOne: false
            referencedRelation: "bureau_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_public_records_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_public_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bureau_summary: {
        Row: {
          autos_on_bureau: number | null
          bureau_raw: Json | null
          bureau_source: string | null
          created_at: string
          credit_report_id: string | null
          deal_id: string
          hard_stop: boolean | null
          hard_stop_reason: string | null
          id: string
          job_id: string | null
          max_pti: number | null
          max_term_months: number | null
          min_cash_down: number | null
          months_since_bankruptcy: number | null
          months_since_repo: number | null
          oldest_trade_months: number | null
          open_auto_trade: boolean | null
          open_auto_trades: number | null
          open_tradelines: number | null
          organization_id: string | null
          paid_auto_trades: number | null
          past_due_amount: number | null
          repo_count: number | null
          risk_tier: string | null
          score: number | null
          stips: Json | null
          total_chargeoffs: number | null
          total_collections: number | null
          total_tradelines: number | null
          updated_at: string
          utilization_pct: number | null
        }
        Insert: {
          autos_on_bureau?: number | null
          bureau_raw?: Json | null
          bureau_source?: string | null
          created_at?: string
          credit_report_id?: string | null
          deal_id: string
          hard_stop?: boolean | null
          hard_stop_reason?: string | null
          id?: string
          job_id?: string | null
          max_pti?: number | null
          max_term_months?: number | null
          min_cash_down?: number | null
          months_since_bankruptcy?: number | null
          months_since_repo?: number | null
          oldest_trade_months?: number | null
          open_auto_trade?: boolean | null
          open_auto_trades?: number | null
          open_tradelines?: number | null
          organization_id?: string | null
          paid_auto_trades?: number | null
          past_due_amount?: number | null
          repo_count?: number | null
          risk_tier?: string | null
          score?: number | null
          stips?: Json | null
          total_chargeoffs?: number | null
          total_collections?: number | null
          total_tradelines?: number | null
          updated_at?: string
          utilization_pct?: number | null
        }
        Update: {
          autos_on_bureau?: number | null
          bureau_raw?: Json | null
          bureau_source?: string | null
          created_at?: string
          credit_report_id?: string | null
          deal_id?: string
          hard_stop?: boolean | null
          hard_stop_reason?: string | null
          id?: string
          job_id?: string | null
          max_pti?: number | null
          max_term_months?: number | null
          min_cash_down?: number | null
          months_since_bankruptcy?: number | null
          months_since_repo?: number | null
          oldest_trade_months?: number | null
          open_auto_trade?: boolean | null
          open_auto_trades?: number | null
          open_tradelines?: number | null
          organization_id?: string | null
          paid_auto_trades?: number | null
          past_due_amount?: number | null
          repo_count?: number | null
          risk_tier?: string | null
          score?: number | null
          stips?: Json | null
          total_chargeoffs?: number | null
          total_collections?: number | null
          total_tradelines?: number | null
          updated_at?: string
          utilization_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bureau_summary_credit_report_id_fkey"
            columns: ["credit_report_id"]
            isOneToOne: true
            referencedRelation: "credit_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_summary_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_summary_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "credit_report_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_summary_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bureau_tradelines: {
        Row: {
          account_status: string | null
          account_type: string | null
          amount: number | null
          auto_repo: boolean | null
          bad: boolean | null
          balance: number | null
          bureau_summary_id: string
          condition_code: string | null
          created_at: string
          credit_limit: number | null
          creditor_name: string | null
          deal_id: string
          good: boolean | null
          high_balance: number | null
          id: string
          is_auto: boolean | null
          is_installment: boolean | null
          is_revolving: boolean | null
          last_activity_date: string | null
          last_payment_date: string | null
          monthly_payment: number | null
          no_effect: boolean | null
          opened_date: string | null
          organization_id: string | null
          past_due_amount: number | null
          raw_segment: Json | null
          unpaid_chargeoff: boolean | null
          unpaid_collection: boolean | null
          updated_at: string
        }
        Insert: {
          account_status?: string | null
          account_type?: string | null
          amount?: number | null
          auto_repo?: boolean | null
          bad?: boolean | null
          balance?: number | null
          bureau_summary_id: string
          condition_code?: string | null
          created_at?: string
          credit_limit?: number | null
          creditor_name?: string | null
          deal_id: string
          good?: boolean | null
          high_balance?: number | null
          id?: string
          is_auto?: boolean | null
          is_installment?: boolean | null
          is_revolving?: boolean | null
          last_activity_date?: string | null
          last_payment_date?: string | null
          monthly_payment?: number | null
          no_effect?: boolean | null
          opened_date?: string | null
          organization_id?: string | null
          past_due_amount?: number | null
          raw_segment?: Json | null
          unpaid_chargeoff?: boolean | null
          unpaid_collection?: boolean | null
          updated_at?: string
        }
        Update: {
          account_status?: string | null
          account_type?: string | null
          amount?: number | null
          auto_repo?: boolean | null
          bad?: boolean | null
          balance?: number | null
          bureau_summary_id?: string
          condition_code?: string | null
          created_at?: string
          credit_limit?: number | null
          creditor_name?: string | null
          deal_id?: string
          good?: boolean | null
          high_balance?: number | null
          id?: string
          is_auto?: boolean | null
          is_installment?: boolean | null
          is_revolving?: boolean | null
          last_activity_date?: string | null
          last_payment_date?: string | null
          monthly_payment?: number | null
          no_effect?: boolean | null
          opened_date?: string | null
          organization_id?: string | null
          past_due_amount?: number | null
          raw_segment?: Json | null
          unpaid_chargeoff?: boolean | null
          unpaid_collection?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bureau_tradelines_bureau_summary_id_fkey"
            columns: ["bureau_summary_id"]
            isOneToOne: false
            referencedRelation: "bureau_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_tradelines_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bureau_tradelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_report_jobs: {
        Row: {
          bureau: string
          created_at: string
          deal_id: string
          error_message: string | null
          extracted_text: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          organization_id: string | null
          processed_at: string | null
          raw_bucket: string
          raw_path: string
          redacted_bucket: string | null
          redacted_path: string | null
          redacted_text: string | null
          status: Database["public"]["Enums"]["credit_report_status"]
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          bureau?: string
          created_at?: string
          deal_id: string
          error_message?: string | null
          extracted_text?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string | null
          processed_at?: string | null
          raw_bucket?: string
          raw_path: string
          redacted_bucket?: string | null
          redacted_path?: string | null
          redacted_text?: string | null
          status?: Database["public"]["Enums"]["credit_report_status"]
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          bureau?: string
          created_at?: string
          deal_id?: string
          error_message?: string | null
          extracted_text?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string | null
          processed_at?: string | null
          raw_bucket?: string
          raw_path?: string
          redacted_bucket?: string | null
          redacted_path?: string | null
          redacted_text?: string | null
          status?: Database["public"]["Enums"]["credit_report_status"]
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_report_jobs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_report_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_reports: {
        Row: {
          bureau: string
          created_at: string
          deal_id: string
          id: string
          latest_job_id: string | null
          organization_id: string | null
          raw_bucket: string
          raw_path: string
          redacted_bucket: string | null
          redacted_path: string | null
          redacted_text: string | null
          updated_at: string
        }
        Insert: {
          bureau?: string
          created_at?: string
          deal_id: string
          id?: string
          latest_job_id?: string | null
          organization_id?: string | null
          raw_bucket?: string
          raw_path: string
          redacted_bucket?: string | null
          redacted_path?: string | null
          redacted_text?: string | null
          updated_at?: string
        }
        Update: {
          bureau?: string
          created_at?: string
          deal_id?: string
          id?: string
          latest_job_id?: string | null
          organization_id?: string | null
          raw_bucket?: string
          raw_path?: string
          redacted_bucket?: string | null
          redacted_path?: string | null
          redacted_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_reports_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_reports_latest_job_id_fkey"
            columns: ["latest_job_id"]
            isOneToOne: false
            referencedRelation: "credit_report_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_documents: {
        Row: {
          created_at: string
          deal_id: string
          doc_type: string
          id: string
          mime_type: string | null
          organization_id: string | null
          original_name: string | null
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          doc_type: string
          id?: string
          mime_type?: string | null
          organization_id?: string | null
          original_name?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          doc_type?: string
          id?: string
          mime_type?: string | null
          organization_id?: string | null
          original_name?: string | null
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_funding_stip_verifications: {
        Row: {
          created_at: string
          deal_id: string
          doc_type: string
          id: string
          organization_id: string
          rejection_reason: string | null
          status: string
          structure_fingerprint: string
          updated_at: string
          verified_at: string
          verified_by: string | null
          verified_monthly_income: number | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          doc_type: string
          id?: string
          organization_id: string
          rejection_reason?: string | null
          status: string
          structure_fingerprint: string
          updated_at?: string
          verified_at?: string
          verified_by?: string | null
          verified_monthly_income?: number | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          doc_type?: string
          id?: string
          organization_id?: string
          rejection_reason?: string | null
          status?: string
          structure_fingerprint?: string
          updated_at?: string
          verified_at?: string
          verified_by?: string | null
          verified_monthly_income?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_funding_stip_verifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_funding_stip_verifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_management_notes: {
        Row: {
          created_at: string
          created_by: string | null
          deal_id: string
          id: string
          note: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deal_id: string
          id?: string
          note: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deal_id?: string
          id?: string
          note?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_management_notes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_override_counter_offers: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          base_structure_fingerprint: string
          counter_type: string
          created_at: string
          deal_id: string
          deal_override_request_id: string
          id: string
          inputs_json: Json
          organization_id: string
          outputs_snapshot_json: Json
          proposal_structure_fingerprint: string
          rejection_reason: string | null
          review_note: string
          reviewed_at: string
          reviewed_by: string | null
          stale_reason: string | null
          status: string
          updated_at: string
          version_number: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          base_structure_fingerprint: string
          counter_type: string
          created_at?: string
          deal_id: string
          deal_override_request_id: string
          id?: string
          inputs_json: Json
          organization_id: string
          outputs_snapshot_json: Json
          proposal_structure_fingerprint: string
          rejection_reason?: string | null
          review_note: string
          reviewed_at?: string
          reviewed_by?: string | null
          stale_reason?: string | null
          status?: string
          updated_at?: string
          version_number: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          base_structure_fingerprint?: string
          counter_type?: string
          created_at?: string
          deal_id?: string
          deal_override_request_id?: string
          id?: string
          inputs_json?: Json
          organization_id?: string
          outputs_snapshot_json?: Json
          proposal_structure_fingerprint?: string
          rejection_reason?: string | null
          review_note?: string
          reviewed_at?: string
          reviewed_by?: string | null
          stale_reason?: string | null
          status?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_override_counter_offers_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_override_counter_offers_deal_override_request_id_fkey"
            columns: ["deal_override_request_id"]
            isOneToOne: false
            referencedRelation: "deal_override_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_override_counter_offers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_override_requests: {
        Row: {
          amount_financed_snapshot: number | null
          blocker_code: string
          cash_down_snapshot: number | null
          created_at: string
          deal_id: string
          id: string
          ltv_snapshot: number | null
          monthly_payment_snapshot: number | null
          organization_id: string
          pti_snapshot: number | null
          requested_at: string
          requested_by: string | null
          requested_note: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          stale_reason: string | null
          status: string
          status_changed_at: string
          structure_fingerprint: string
          term_months_snapshot: number | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount_financed_snapshot?: number | null
          blocker_code: string
          cash_down_snapshot?: number | null
          created_at?: string
          deal_id: string
          id?: string
          ltv_snapshot?: number | null
          monthly_payment_snapshot?: number | null
          organization_id: string
          pti_snapshot?: number | null
          requested_at?: string
          requested_by?: string | null
          requested_note?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stale_reason?: string | null
          status?: string
          status_changed_at?: string
          structure_fingerprint: string
          term_months_snapshot?: number | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount_financed_snapshot?: number | null
          blocker_code?: string
          cash_down_snapshot?: number | null
          created_at?: string
          deal_id?: string
          id?: string
          ltv_snapshot?: number | null
          monthly_payment_snapshot?: number | null
          organization_id?: string
          pti_snapshot?: number | null
          requested_at?: string
          requested_by?: string | null
          requested_note?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stale_reason?: string | null
          status?: string
          status_changed_at?: string
          structure_fingerprint?: string
          term_months_snapshot?: number | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_override_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_override_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_people: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          banking_checking: boolean
          banking_prepaid: boolean
          banking_savings: boolean
          city: string | null
          created_at: string
          deal_id: string
          email: string | null
          first_name: string | null
          housing: Database["public"]["Enums"]["housing_type"] | null
          id: string
          last_name: string | null
          move_in_date: string | null
          organization_id: string | null
          phone: string | null
          residence_months: number | null
          role: Database["public"]["Enums"]["person_role"]
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          banking_checking?: boolean
          banking_prepaid?: boolean
          banking_savings?: boolean
          city?: string | null
          created_at?: string
          deal_id: string
          email?: string | null
          first_name?: string | null
          housing?: Database["public"]["Enums"]["housing_type"] | null
          id?: string
          last_name?: string | null
          move_in_date?: string | null
          organization_id?: string | null
          phone?: string | null
          residence_months?: number | null
          role: Database["public"]["Enums"]["person_role"]
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          banking_checking?: boolean
          banking_prepaid?: boolean
          banking_savings?: boolean
          city?: string | null
          created_at?: string
          deal_id?: string
          email?: string | null
          first_name?: string | null
          housing?: Database["public"]["Enums"]["housing_type"] | null
          id?: string
          last_name?: string | null
          move_in_date?: string | null
          organization_id?: string | null
          phone?: string | null
          residence_months?: number | null
          role?: Database["public"]["Enums"]["person_role"]
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_people_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_structure: {
        Row: {
          amount_financed: number
          apr: number
          cash_down: number | null
          created_at: string
          deal_id: string
          doc_fee: number
          fail_reasons: Json
          fees_total: number
          fits_program: boolean
          gap_price: number
          include_gap: boolean
          include_vsc: boolean
          jd_power_retail_book: number | null
          ltv: number | null
          monthly_payment: number
          option_label: string
          organization_id: string | null
          product_total: number
          sale_price: number
          sales_tax: number
          snapshot_json: Json
          taxable_amount: number
          term_months: number
          title_license: number
          trade_payoff: number | null
          updated_at: string
          vehicle_id: string
          vsc_price: number
        }
        Insert: {
          amount_financed?: number
          apr?: number
          cash_down?: number | null
          created_at?: string
          deal_id: string
          doc_fee?: number
          fail_reasons?: Json
          fees_total?: number
          fits_program?: boolean
          gap_price?: number
          include_gap?: boolean
          include_vsc?: boolean
          jd_power_retail_book?: number | null
          ltv?: number | null
          monthly_payment?: number
          option_label: string
          organization_id?: string | null
          product_total?: number
          sale_price?: number
          sales_tax?: number
          snapshot_json?: Json
          taxable_amount?: number
          term_months?: number
          title_license?: number
          trade_payoff?: number | null
          updated_at?: string
          vehicle_id: string
          vsc_price?: number
        }
        Update: {
          amount_financed?: number
          apr?: number
          cash_down?: number | null
          created_at?: string
          deal_id?: string
          doc_fee?: number
          fail_reasons?: Json
          fees_total?: number
          fits_program?: boolean
          gap_price?: number
          include_gap?: boolean
          include_vsc?: boolean
          jd_power_retail_book?: number | null
          ltv?: number | null
          monthly_payment?: number
          option_label?: string
          organization_id?: string | null
          product_total?: number
          sale_price?: number
          sales_tax?: number
          snapshot_json?: Json
          taxable_amount?: number
          term_months?: number
          title_license?: number
          trade_payoff?: number | null
          updated_at?: string
          vehicle_id?: string
          vsc_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_structure_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_structure_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_structure_inputs: {
        Row: {
          cash_down: number | null
          created_at: string
          deal_id: string
          doc_fee: number
          gap_price: number
          id: string
          include_gap: boolean
          include_vsc: boolean
          option_label: string
          organization_id: string
          sale_price: number
          tax_add_base: number
          tax_add_rate: number
          tax_rate_main: number
          term_months: number
          title_license: number
          updated_at: string
          vehicle_id: string
          vsc_price: number
        }
        Insert: {
          cash_down?: number | null
          created_at?: string
          deal_id: string
          doc_fee?: number
          gap_price?: number
          id?: string
          include_gap?: boolean
          include_vsc?: boolean
          option_label: string
          organization_id: string
          sale_price?: number
          tax_add_base?: number
          tax_add_rate?: number
          tax_rate_main?: number
          term_months: number
          title_license?: number
          updated_at?: string
          vehicle_id: string
          vsc_price?: number
        }
        Update: {
          cash_down?: number | null
          created_at?: string
          deal_id?: string
          doc_fee?: number
          gap_price?: number
          id?: string
          include_gap?: boolean
          include_vsc?: boolean
          option_label?: string
          organization_id?: string
          sale_price?: number
          tax_add_base?: number
          tax_add_rate?: number
          tax_rate_main?: number
          term_months?: number
          title_license?: number
          updated_at?: string
          vehicle_id?: string
          vsc_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_structure_inputs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_structure_inputs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_structure_inputs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "trivian_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_vehicle_selection: {
        Row: {
          cash_down: number | null
          created_at: string
          deal_id: string
          include_gap: boolean
          include_vsc: boolean
          monthly_payment: number
          option_label: string
          organization_id: string | null
          term_months: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          cash_down?: number | null
          created_at?: string
          deal_id: string
          include_gap?: boolean
          include_vsc?: boolean
          monthly_payment: number
          option_label: string
          organization_id?: string | null
          term_months: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          cash_down?: number | null
          created_at?: string
          deal_id?: string
          include_gap?: boolean
          include_vsc?: boolean
          monthly_payment?: number
          option_label?: string
          organization_id?: string | null
          term_months?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_vehicle_selection_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_vehicle_selection_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_vehicle_selection_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "trivian_inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          approval_number: string | null
          cash_down: number | null
          created_at: string | null
          current_step: number
          customer_name: string
          funded_at: string | null
          funded_by: string | null
          funding_decision_notes: string | null
          funding_notes: string | null
          funding_status: string | null
          has_trade: boolean
          household_income: boolean
          id: string
          internal_notes: string | null
          max_payment: number | null
          min_down: number | null
          organization_id: string | null
          status: string | null
          submit_status: string | null
          submitted_at: string | null
          submitted_by: string | null
          trade_payoff: number | null
          trade_value: number | null
          updated_at: string | null
          user_id: string | null
          vehicle_description: string | null
          vehicle_type: string | null
          workflow_status: Database["public"]["Enums"]["deal_workflow_status"]
        }
        Insert: {
          approval_number?: string | null
          cash_down?: number | null
          created_at?: string | null
          current_step?: number
          customer_name: string
          funded_at?: string | null
          funded_by?: string | null
          funding_decision_notes?: string | null
          funding_notes?: string | null
          funding_status?: string | null
          has_trade?: boolean
          household_income?: boolean
          id?: string
          internal_notes?: string | null
          max_payment?: number | null
          min_down?: number | null
          organization_id?: string | null
          status?: string | null
          submit_status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          trade_payoff?: number | null
          trade_value?: number | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_description?: string | null
          vehicle_type?: string | null
          workflow_status?: Database["public"]["Enums"]["deal_workflow_status"]
        }
        Update: {
          approval_number?: string | null
          cash_down?: number | null
          created_at?: string | null
          current_step?: number
          customer_name?: string
          funded_at?: string | null
          funded_by?: string | null
          funding_decision_notes?: string | null
          funding_notes?: string | null
          funding_status?: string | null
          has_trade?: boolean
          household_income?: boolean
          id?: string
          internal_notes?: string | null
          max_payment?: number | null
          min_down?: number | null
          organization_id?: string | null
          status?: string | null
          submit_status?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          trade_payoff?: number | null
          trade_value?: number | null
          updated_at?: string | null
          user_id?: string | null
          vehicle_description?: string | null
          vehicle_type?: string | null
          workflow_status?: Database["public"]["Enums"]["deal_workflow_status"]
        }
        Relationships: [
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string | null
          deal_id: string | null
          document_type: string
          extracted_data: Json
          file_name: string
          file_path: string
          id: string
          parse_status: Database["public"]["Enums"]["parse_status"]
          person_role: Database["public"]["Enums"]["person_role"] | null
          sha256: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          document_type: string
          extracted_data?: Json
          file_name: string
          file_path: string
          id?: string
          parse_status?: Database["public"]["Enums"]["parse_status"]
          person_role?: Database["public"]["Enums"]["person_role"] | null
          sha256?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          document_type?: string
          extracted_data?: Json
          file_name?: string
          file_path?: string
          id?: string
          parse_status?: Database["public"]["Enums"]["parse_status"]
          person_role?: Database["public"]["Enums"]["person_role"] | null
          sha256?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      income_profiles: {
        Row: {
          applied_to_deal: boolean
          calc_flags: Json
          created_at: string
          deal_person_id: string
          gross_per_pay: number | null
          gross_ytd: number | null
          hire_date: string | null
          id: string
          income_type: Database["public"]["Enums"]["income_type"]
          manual_notes: string | null
          monthly_gross_calculated: number | null
          monthly_gross_manual: number | null
          organization_id: string | null
          pay_date: string | null
          pay_frequency: Database["public"]["Enums"]["pay_frequency"] | null
          pay_period_end: string | null
          updated_at: string
          ytd_end_date: string | null
          ytd_start_date: string | null
        }
        Insert: {
          applied_to_deal?: boolean
          calc_flags?: Json
          created_at?: string
          deal_person_id: string
          gross_per_pay?: number | null
          gross_ytd?: number | null
          hire_date?: string | null
          id?: string
          income_type?: Database["public"]["Enums"]["income_type"]
          manual_notes?: string | null
          monthly_gross_calculated?: number | null
          monthly_gross_manual?: number | null
          organization_id?: string | null
          pay_date?: string | null
          pay_frequency?: Database["public"]["Enums"]["pay_frequency"] | null
          pay_period_end?: string | null
          updated_at?: string
          ytd_end_date?: string | null
          ytd_start_date?: string | null
        }
        Update: {
          applied_to_deal?: boolean
          calc_flags?: Json
          created_at?: string
          deal_person_id?: string
          gross_per_pay?: number | null
          gross_ytd?: number | null
          hire_date?: string | null
          id?: string
          income_type?: Database["public"]["Enums"]["income_type"]
          manual_notes?: string | null
          monthly_gross_calculated?: number | null
          monthly_gross_manual?: number | null
          organization_id?: string | null
          pay_date?: string | null
          pay_frequency?: Database["public"]["Enums"]["pay_frequency"] | null
          pay_period_end?: string | null
          updated_at?: string
          ytd_end_date?: string | null
          ytd_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "income_profiles_deal_person_id_fkey"
            columns: ["deal_person_id"]
            isOneToOne: false
            referencedRelation: "deal_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          full_name: string | null
          id: string
          invited_by_user_id: string | null
          organization_id: string
          revoked_at: string | null
          role: string
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          email: string
          expires_at: string
          full_name?: string | null
          id?: string
          invited_by_user_id?: string | null
          organization_id: string
          revoked_at?: string | null
          role: string
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by_user_id?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: string
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_profile_settings: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          country: string | null
          created_at: string
          dba_name: string | null
          legal_business_name: string | null
          logo_storage_path: string | null
          main_email: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          state: string | null
          timezone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          dba_name?: string | null
          legal_business_name?: string | null
          logo_storage_path?: string | null
          main_email?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          dba_name?: string | null
          legal_business_name?: string | null
          logo_storage_path?: string | null
          main_email?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          timezone?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_profile_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          organization_id: string
          permission_key: string
          role: string
          updated_at: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          organization_id: string
          permission_key: string
          role: string
          updated_at?: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          organization_id?: string
          permission_key?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_role_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          key: string
          organization_id: string
          updated_at: string
          value_json: Json | null
        }
        Insert: {
          key: string
          organization_id: string
          updated_at?: string
          value_json?: Json | null
        }
        Update: {
          key?: string
          organization_id?: string
          updated_at?: string
          value_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_user_permission_overrides: {
        Row: {
          allowed: boolean
          created_at: string
          organization_id: string
          permission_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed: boolean
          created_at?: string
          organization_id: string
          permission_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          organization_id?: string
          permission_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_user_permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_users: {
        Row: {
          created_at: string
          is_active: boolean
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          organization_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      trivian_config: {
        Row: {
          apr: number
          created_at: string
          doc_fee: number
          gap_price: number
          id: string
          organization_id: string | null
          payment_cap_pct: number
          tax_add_base: number
          tax_add_rate: number
          tax_rate_main: number
          title_license: number
          updated_at: string
          vsc_price: number
        }
        Insert: {
          apr?: number
          created_at?: string
          doc_fee?: number
          gap_price?: number
          id?: string
          organization_id?: string | null
          payment_cap_pct?: number
          tax_add_base?: number
          tax_add_rate?: number
          tax_rate_main?: number
          title_license?: number
          updated_at?: string
          vsc_price?: number
        }
        Update: {
          apr?: number
          created_at?: string
          doc_fee?: number
          gap_price?: number
          id?: string
          organization_id?: string | null
          payment_cap_pct?: number
          tax_add_base?: number
          tax_add_rate?: number
          tax_rate_main?: number
          title_license?: number
          updated_at?: string
          vsc_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "trivian_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trivian_inventory: {
        Row: {
          advertising_price: number | null
          asking_price: number | null
          body_type: string | null
          created_at: string
          date_in_stock: string | null
          exterior_color: string | null
          id: string
          jd_power_retail_book: number | null
          jd_power_trade_book: number | null
          last_seen_at: string
          make: string | null
          model: string | null
          odometer: number | null
          organization_id: string | null
          status: string | null
          stock_number: string
          total_cost_with_estimated_flooring: number | null
          updated_at: string
          vehicle_category: string | null
          vehicle_cost: number | null
          vin: string | null
          year: number | null
        }
        Insert: {
          advertising_price?: number | null
          asking_price?: number | null
          body_type?: string | null
          created_at?: string
          date_in_stock?: string | null
          exterior_color?: string | null
          id?: string
          jd_power_retail_book?: number | null
          jd_power_trade_book?: number | null
          last_seen_at?: string
          make?: string | null
          model?: string | null
          odometer?: number | null
          organization_id?: string | null
          status?: string | null
          stock_number: string
          total_cost_with_estimated_flooring?: number | null
          updated_at?: string
          vehicle_category?: string | null
          vehicle_cost?: number | null
          vin?: string | null
          year?: number | null
        }
        Update: {
          advertising_price?: number | null
          asking_price?: number | null
          body_type?: string | null
          created_at?: string
          date_in_stock?: string | null
          exterior_color?: string | null
          id?: string
          jd_power_retail_book?: number | null
          jd_power_trade_book?: number | null
          last_seen_at?: string
          make?: string | null
          model?: string | null
          odometer?: number | null
          organization_id?: string | null
          status?: string | null
          stock_number?: string
          total_cost_with_estimated_flooring?: number | null
          updated_at?: string
          vehicle_category?: string | null
          vehicle_cost?: number | null
          vin?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trivian_inventory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      underwriting_inputs: {
        Row: {
          created_at: string | null
          deal_id: string | null
          gap_price: number | null
          gross_monthly_income: number | null
          id: string
          include_gap: boolean | null
          include_vsc: boolean | null
          interest_rate_apr: number | null
          max_payment_pct: number | null
          monthly_debt: number | null
          monthly_housing: number | null
          organization_id: string | null
          other_monthly_income: number | null
          term_months: number | null
          total_monthly_income: number | null
          updated_at: string
          user_id: string | null
          vsc_price: number | null
        }
        Insert: {
          created_at?: string | null
          deal_id?: string | null
          gap_price?: number | null
          gross_monthly_income?: number | null
          id?: string
          include_gap?: boolean | null
          include_vsc?: boolean | null
          interest_rate_apr?: number | null
          max_payment_pct?: number | null
          monthly_debt?: number | null
          monthly_housing?: number | null
          organization_id?: string | null
          other_monthly_income?: number | null
          term_months?: number | null
          total_monthly_income?: number | null
          updated_at?: string
          user_id?: string | null
          vsc_price?: number | null
        }
        Update: {
          created_at?: string | null
          deal_id?: string | null
          gap_price?: number | null
          gross_monthly_income?: number | null
          id?: string
          include_gap?: boolean | null
          include_vsc?: boolean | null
          interest_rate_apr?: number | null
          max_payment_pct?: number | null
          monthly_debt?: number | null
          monthly_housing?: number | null
          organization_id?: string | null
          other_monthly_income?: number | null
          term_months?: number | null
          total_monthly_income?: number | null
          updated_at?: string
          user_id?: string | null
          vsc_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "underwriting_inputs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "underwriting_inputs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      underwriting_results: {
        Row: {
          apr: number | null
          created_at: string | null
          deal_id: string | null
          decision: string | null
          hard_stop: boolean
          hard_stop_reason: string | null
          id: string
          max_amount_financed: number | null
          max_ltv: number | null
          max_payment: number | null
          max_pti: number | null
          max_term_months: number | null
          max_vehicle_price: number | null
          min_cash_down: number | null
          min_down_pct: number | null
          notes: string | null
          organization_id: string | null
          score_factors: Json | null
          score_total: number | null
          stage: string | null
          tier: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          apr?: number | null
          created_at?: string | null
          deal_id?: string | null
          decision?: string | null
          hard_stop?: boolean
          hard_stop_reason?: string | null
          id?: string
          max_amount_financed?: number | null
          max_ltv?: number | null
          max_payment?: number | null
          max_pti?: number | null
          max_term_months?: number | null
          max_vehicle_price?: number | null
          min_cash_down?: number | null
          min_down_pct?: number | null
          notes?: string | null
          organization_id?: string | null
          score_factors?: Json | null
          score_total?: number | null
          stage?: string | null
          tier?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          apr?: number | null
          created_at?: string | null
          deal_id?: string | null
          decision?: string | null
          hard_stop?: boolean
          hard_stop_reason?: string | null
          id?: string
          max_amount_financed?: number | null
          max_ltv?: number | null
          max_payment?: number | null
          max_pti?: number | null
          max_term_months?: number | null
          max_vehicle_price?: number | null
          min_cash_down?: number | null
          min_down_pct?: number | null
          notes?: string | null
          organization_id?: string | null
          score_factors?: Json | null
          score_total?: number | null
          stage?: string | null
          tier?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "underwriting_results_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "underwriting_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      underwriting_tier_policy: {
        Row: {
          active: boolean
          apr: number | null
          created_at: string
          id: string
          max_amount_financed: number
          max_ltv: number
          max_pti: number
          max_term_months: number
          max_vehicle_price: number
          min_cash_down: number
          min_down_pct: number
          organization_id: string | null
          sort_order: number
          tier: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          apr?: number | null
          created_at?: string
          id?: string
          max_amount_financed: number
          max_ltv: number
          max_pti: number
          max_term_months: number
          max_vehicle_price: number
          min_cash_down: number
          min_down_pct: number
          organization_id?: string | null
          sort_order: number
          tier: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          apr?: number | null
          created_at?: string
          id?: string
          max_amount_financed?: number
          max_ltv?: number
          max_pti?: number
          max_term_months?: number
          max_vehicle_price?: number
          min_cash_down?: number
          min_down_pct?: number
          organization_id?: string | null
          sort_order?: number
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "underwriting_tier_policy_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      vehicle_options: {
        Row: {
          additional_down: number
          created_at: string
          deal_id: string
          gap_price: number
          id: string
          includes_gap: boolean
          includes_vsc: boolean
          option_type: Database["public"]["Enums"]["vehicle_option_type"]
          payment: number
          term_months: number
          vsc_price: number
        }
        Insert: {
          additional_down?: number
          created_at?: string
          deal_id: string
          gap_price?: number
          id?: string
          includes_gap?: boolean
          includes_vsc?: boolean
          option_type: Database["public"]["Enums"]["vehicle_option_type"]
          payment: number
          term_months: number
          vsc_price?: number
        }
        Update: {
          additional_down?: number
          created_at?: string
          deal_id?: string
          gap_price?: number
          id?: string
          includes_gap?: boolean
          includes_vsc?: boolean
          option_type?: Database["public"]["Enums"]["vehicle_option_type"]
          payment?: number
          term_months?: number
          vsc_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_options_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_selection: {
        Row: {
          deal_id: string
          id: string
          selected_at: string
          selected_by: string | null
          updated_at: string | null
          vehicle_option_id: string
        }
        Insert: {
          deal_id: string
          id?: string
          selected_at?: string
          selected_by?: string | null
          updated_at?: string | null
          vehicle_option_id: string
        }
        Update: {
          deal_id?: string
          id?: string
          selected_at?: string
          selected_by?: string | null
          updated_at?: string | null
          vehicle_option_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_selection_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_selection_vehicle_option_id_fkey"
            columns: ["vehicle_option_id"]
            isOneToOne: false
            referencedRelation: "vehicle_options"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_term_policy: {
        Row: {
          active: boolean
          created_at: string
          id: string
          max_mileage: number | null
          max_term_months: number
          max_vehicle_age: number | null
          min_mileage: number | null
          min_vehicle_age: number | null
          notes: string | null
          organization_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          max_mileage?: number | null
          max_term_months: number
          max_vehicle_age?: number | null
          min_mileage?: number | null
          min_vehicle_age?: number | null
          notes?: string | null
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          max_mileage?: number | null
          max_term_months?: number
          max_vehicle_age?: number | null
          min_mileage?: number | null
          min_vehicle_age?: number | null
          notes?: string | null
          organization_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_term_policy_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      atlas_dashboard_metrics: { Args: never; Returns: Json }
      atlas_has_deal_override_authority: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      atlas_is_active_organization_member: {
        Args: { target_organization_id: string }
        Returns: boolean
      }
      bhph_evaluate_bureau: { Args: { p_deal_id: string }; Returns: undefined }
      create_deal_with_seed_data:
        | {
            Args: { p_customer_name: string }
            Returns: {
              approval_number: string
              deal_id: string
            }[]
          }
        | {
            Args: { p_customer_name: string; p_organization_id: string }
            Returns: {
              approval_number: string
              deal_id: string
            }[]
          }
      current_app_role: { Args: never; Returns: string }
      has_organization_role: {
        Args: {
          p_organization_id: string
          p_roles: string[]
          p_user_id?: string
        }
        Returns: boolean
      }
      is_active_organization_member: {
        Args: { p_organization_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      trivian_amount_financed: {
        Args: {
          cash_down?: number
          include_gap?: boolean
          include_vsc?: boolean
          vehicle_price: number
        }
        Returns: number
      }
      trivian_get_config: {
        Args: never
        Returns: {
          apr: number
          created_at: string
          doc_fee: number
          gap_price: number
          id: string
          organization_id: string | null
          payment_cap_pct: number
          tax_add_base: number
          tax_add_rate: number
          tax_rate_main: number
          title_license: number
          updated_at: string
          vsc_price: number
        }
        SetofOptions: {
          from: "*"
          to: "trivian_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      trivian_inventory_pricing: {
        Args: {
          p_cash_down?: number
          p_gross_monthly_income: number
          p_include_gap?: boolean
          p_include_vsc?: boolean
          p_term_months: number
        }
        Returns: {
          age_days: number
          amount_financed: number
          asking_price: number
          error_notes: string
          exterior_color: string
          has_future_stock_date: boolean
          has_price_error: boolean
          make: string
          max_payment: number
          model: string
          odometer: number
          payment: number
          pti: number
          pti_band: string
          qualified: boolean
          stock_number: string
          tax_amount: number
          year: number
        }[]
      }
      trivian_max_amount_financed: {
        Args: { max_payment: number; term_months: number }
        Returns: number
      }
      trivian_max_payment: {
        Args: { gross_monthly_income: number }
        Returns: number
      }
      trivian_monthly_payment: {
        Args: { amount_financed: number; term_months: number }
        Returns: number
      }
      trivian_qualifying_units: {
        Args: {
          p_cash_down?: number
          p_gross_monthly_income: number
          p_include_gap?: boolean
          p_include_vsc?: boolean
          p_term_months: number
        }
        Returns: {
          amount_financed: number
          asking_price: number
          make: string
          max_payment: number
          model: string
          payment: number
          qualified: boolean
          stock_number: string
          tax_amount: number
          year: number
        }[]
      }
      trivian_quote: {
        Args: {
          cash_down?: number
          gross_monthly_income: number
          include_gap?: boolean
          include_vsc?: boolean
          term_months: number
          vehicle_price: number
        }
        Returns: {
          amount_financed: number
          doc_fee: number
          gap: number
          max_amount_financed: number
          max_payment: number
          payment: number
          purchase_price: number
          qualified: boolean
          tax_amount: number
          title_license: number
          vsc: number
        }[]
      }
      trivian_tax_amount:
        | { Args: { vehicle_price: number }; Returns: number }
        | {
            Args: { include_vsc?: boolean; vehicle_price: number }
            Returns: number
          }
    }
    Enums: {
      credit_report_status:
        | "queued"
        | "uploaded"
        | "parsing"
        | "redacting"
        | "scoring"
        | "done"
        | "failed"
      deal_workflow_status:
        | "draft"
        | "in_progress"
        | "ready_to_score"
        | "scored"
        | "vehicle_selected"
        | "awaiting_stips"
        | "submitted_conditional"
        | "submitted_complete"
        | "decisioned"
        | "archived"
      housing_type: "rent" | "own" | "family"
      income_type: "w2" | "self_employed" | "fixed" | "cash"
      parse_status: "pending" | "parsed" | "failed" | "redacted"
      pay_frequency: "weekly" | "biweekly" | "semimonthly" | "monthly"
      person_role: "primary" | "co"
      vehicle_option_type: "vsc_gap" | "vsc_only" | "gap_only" | "none"
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
      credit_report_status: [
        "queued",
        "uploaded",
        "parsing",
        "redacting",
        "scoring",
        "done",
        "failed",
      ],
      deal_workflow_status: [
        "draft",
        "in_progress",
        "ready_to_score",
        "scored",
        "vehicle_selected",
        "awaiting_stips",
        "submitted_conditional",
        "submitted_complete",
        "decisioned",
        "archived",
      ],
      housing_type: ["rent", "own", "family"],
      income_type: ["w2", "self_employed", "fixed", "cash"],
      parse_status: ["pending", "parsed", "failed", "redacted"],
      pay_frequency: ["weekly", "biweekly", "semimonthly", "monthly"],
      person_role: ["primary", "co"],
      vehicle_option_type: ["vsc_gap", "vsc_only", "gap_only", "none"],
    },
  },
} as const
