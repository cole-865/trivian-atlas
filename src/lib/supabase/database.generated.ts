export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
          applicant_role: string
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
          applicant_role?: string
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
          applicant_role?: string
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
          applicant_role: string
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
          applicant_role?: string
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
          applicant_role?: string
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
          applicant_role: string
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
          applicant_role?: string
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
          applicant_role?: string
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
          applicant_role: string
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
          applicant_role?: string
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
          applicant_role?: string
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
          applicant_role: string
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
          applicant_role?: string
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
          applicant_role?: string
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
          applicant_role: string
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
          applicant_role?: string
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
          applicant_role?: string
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
            isOneToOne: false
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
          applicant_role: string | null
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
          applicant_role?: string | null
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
          applicant_role?: string | null
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
      dms_accounts_snapshot: {
        Row: {
          account_closed_date: string | null
          account_conditions: string | null
          account_sale_received_amount: number | null
          account_sell_date: string | null
          account_status: string | null
          apr: number | null
          auto_pay_status: string | null
          backend_gross_amount: number | null
          bad_debt_amount: number | null
          balance_down_amount: number | null
          balance_principal_amount: number | null
          balance_side_note_amount: number | null
          buy_back_cost: number | null
          buy_back_date: string | null
          buy_back_reason: string | null
          charge_off_date: string | null
          charge_off_reason: string | null
          collateral_status: string | null
          collector_name: string | null
          created_at: string
          credit_due_amount: number | null
          cured_date: string | null
          current_insurance_carrier: string | null
          current_insurance_effective_date: string | null
          current_insurance_expiry_date: string | null
          custom_account_status: string | null
          days_past_due: number | null
          deal_date: string | null
          deal_number: string
          dealer_gross_amount: number | null
          down_amount: number | null
          down_due_amount: number | null
          exposure: number | null
          final_payment_amount: number | null
          first_payment_date: string | null
          front_gross_amount: number | null
          gps_provider: string | null
          gps_tracking_number: string | null
          id: string
          import_batch_id: string
          insurance_status: string | null
          interest_balance_amount: number | null
          interest_due_amount: number | null
          interest_paid_amount: number | null
          last_contacted_date: string | null
          last_paid_amount: number | null
          last_paid_date: string | null
          last_repo_date: string | null
          late_balance_amount: number | null
          late_due_amount: number | null
          lender_name: string | null
          lender_type: string | null
          loan_modification_date: string | null
          loan_modification_reason: string | null
          net_cash_in_deal: number | null
          net_profit: number | null
          new_due_date: string | null
          next_call_back_date: string | null
          notes: string | null
          num_of_extensions: number | null
          num_of_loan_modification: number | null
          num_of_payments_till_break_even: number | null
          organization_id: string
          original_due_date: string | null
          original_financed_amount: number | null
          original_financed_charge: number | null
          other_balance_amount: number | null
          other_due_amount: number | null
          out_for_repo_date: string | null
          payment_end_date: string | null
          payment_frequency: string | null
          payment_status: string | null
          previous_payment_amount: number | null
          principal_bad_debt_amount: number | null
          principal_due_amount: number | null
          principal_paid_amount: number | null
          promise_amount: number | null
          promise_created_date: string | null
          promise_date: string | null
          promise_note: string | null
          promised_result: string | null
          raw_data: Json
          recovery_amount: number | null
          recovery_without_repo_credit: number | null
          remaining_payment: number | null
          repo_company_name: string | null
          repo_completed_date: string | null
          repo_created_date: string | null
          repo_credit: number | null
          repo_fees: number | null
          repo_location: string | null
          repo_reason: string | null
          repo_stage: string | null
          repo_status: string | null
          repo_type: string | null
          side_note_due_amount: number | null
          snapshot_date: string
          tax_balance_amount: number | null
          total_cash_in_deal: number | null
          total_down_amount: number | null
          total_down_paid_amount: number | null
          total_gross: number | null
          total_late_fees_paid_amount: number | null
          total_other_fees_paid_amount: number | null
          total_paid_amount: number | null
          total_paid_without_down_side_note: number | null
          total_past_due_amount: number | null
          total_payment_amount: number | null
          total_payment_due_amount: number | null
          total_payoff_amount: number | null
          total_price: number | null
          total_side_note_paid_amount: number | null
          vehicle_cost: number | null
          vehicle_exterior_color: string | null
          vehicle_fuel_type: string | null
          vehicle_mileage: number | null
          vehicle_price: number | null
          vehicle_stock_number: string | null
          vehicle_vin: string | null
          vehicle_year_make_model: string | null
          vin_last_six: string | null
        }
        Insert: {
          account_closed_date?: string | null
          account_conditions?: string | null
          account_sale_received_amount?: number | null
          account_sell_date?: string | null
          account_status?: string | null
          apr?: number | null
          auto_pay_status?: string | null
          backend_gross_amount?: number | null
          bad_debt_amount?: number | null
          balance_down_amount?: number | null
          balance_principal_amount?: number | null
          balance_side_note_amount?: number | null
          buy_back_cost?: number | null
          buy_back_date?: string | null
          buy_back_reason?: string | null
          charge_off_date?: string | null
          charge_off_reason?: string | null
          collateral_status?: string | null
          collector_name?: string | null
          created_at?: string
          credit_due_amount?: number | null
          cured_date?: string | null
          current_insurance_carrier?: string | null
          current_insurance_effective_date?: string | null
          current_insurance_expiry_date?: string | null
          custom_account_status?: string | null
          days_past_due?: number | null
          deal_date?: string | null
          deal_number: string
          dealer_gross_amount?: number | null
          down_amount?: number | null
          down_due_amount?: number | null
          exposure?: number | null
          final_payment_amount?: number | null
          first_payment_date?: string | null
          front_gross_amount?: number | null
          gps_provider?: string | null
          gps_tracking_number?: string | null
          id?: string
          import_batch_id: string
          insurance_status?: string | null
          interest_balance_amount?: number | null
          interest_due_amount?: number | null
          interest_paid_amount?: number | null
          last_contacted_date?: string | null
          last_paid_amount?: number | null
          last_paid_date?: string | null
          last_repo_date?: string | null
          late_balance_amount?: number | null
          late_due_amount?: number | null
          lender_name?: string | null
          lender_type?: string | null
          loan_modification_date?: string | null
          loan_modification_reason?: string | null
          net_cash_in_deal?: number | null
          net_profit?: number | null
          new_due_date?: string | null
          next_call_back_date?: string | null
          notes?: string | null
          num_of_extensions?: number | null
          num_of_loan_modification?: number | null
          num_of_payments_till_break_even?: number | null
          organization_id: string
          original_due_date?: string | null
          original_financed_amount?: number | null
          original_financed_charge?: number | null
          other_balance_amount?: number | null
          other_due_amount?: number | null
          out_for_repo_date?: string | null
          payment_end_date?: string | null
          payment_frequency?: string | null
          payment_status?: string | null
          previous_payment_amount?: number | null
          principal_bad_debt_amount?: number | null
          principal_due_amount?: number | null
          principal_paid_amount?: number | null
          promise_amount?: number | null
          promise_created_date?: string | null
          promise_date?: string | null
          promise_note?: string | null
          promised_result?: string | null
          raw_data: Json
          recovery_amount?: number | null
          recovery_without_repo_credit?: number | null
          remaining_payment?: number | null
          repo_company_name?: string | null
          repo_completed_date?: string | null
          repo_created_date?: string | null
          repo_credit?: number | null
          repo_fees?: number | null
          repo_location?: string | null
          repo_reason?: string | null
          repo_stage?: string | null
          repo_status?: string | null
          repo_type?: string | null
          side_note_due_amount?: number | null
          snapshot_date?: string
          tax_balance_amount?: number | null
          total_cash_in_deal?: number | null
          total_down_amount?: number | null
          total_down_paid_amount?: number | null
          total_gross?: number | null
          total_late_fees_paid_amount?: number | null
          total_other_fees_paid_amount?: number | null
          total_paid_amount?: number | null
          total_paid_without_down_side_note?: number | null
          total_past_due_amount?: number | null
          total_payment_amount?: number | null
          total_payment_due_amount?: number | null
          total_payoff_amount?: number | null
          total_price?: number | null
          total_side_note_paid_amount?: number | null
          vehicle_cost?: number | null
          vehicle_exterior_color?: string | null
          vehicle_fuel_type?: string | null
          vehicle_mileage?: number | null
          vehicle_price?: number | null
          vehicle_stock_number?: string | null
          vehicle_vin?: string | null
          vehicle_year_make_model?: string | null
          vin_last_six?: string | null
        }
        Update: {
          account_closed_date?: string | null
          account_conditions?: string | null
          account_sale_received_amount?: number | null
          account_sell_date?: string | null
          account_status?: string | null
          apr?: number | null
          auto_pay_status?: string | null
          backend_gross_amount?: number | null
          bad_debt_amount?: number | null
          balance_down_amount?: number | null
          balance_principal_amount?: number | null
          balance_side_note_amount?: number | null
          buy_back_cost?: number | null
          buy_back_date?: string | null
          buy_back_reason?: string | null
          charge_off_date?: string | null
          charge_off_reason?: string | null
          collateral_status?: string | null
          collector_name?: string | null
          created_at?: string
          credit_due_amount?: number | null
          cured_date?: string | null
          current_insurance_carrier?: string | null
          current_insurance_effective_date?: string | null
          current_insurance_expiry_date?: string | null
          custom_account_status?: string | null
          days_past_due?: number | null
          deal_date?: string | null
          deal_number?: string
          dealer_gross_amount?: number | null
          down_amount?: number | null
          down_due_amount?: number | null
          exposure?: number | null
          final_payment_amount?: number | null
          first_payment_date?: string | null
          front_gross_amount?: number | null
          gps_provider?: string | null
          gps_tracking_number?: string | null
          id?: string
          import_batch_id?: string
          insurance_status?: string | null
          interest_balance_amount?: number | null
          interest_due_amount?: number | null
          interest_paid_amount?: number | null
          last_contacted_date?: string | null
          last_paid_amount?: number | null
          last_paid_date?: string | null
          last_repo_date?: string | null
          late_balance_amount?: number | null
          late_due_amount?: number | null
          lender_name?: string | null
          lender_type?: string | null
          loan_modification_date?: string | null
          loan_modification_reason?: string | null
          net_cash_in_deal?: number | null
          net_profit?: number | null
          new_due_date?: string | null
          next_call_back_date?: string | null
          notes?: string | null
          num_of_extensions?: number | null
          num_of_loan_modification?: number | null
          num_of_payments_till_break_even?: number | null
          organization_id?: string
          original_due_date?: string | null
          original_financed_amount?: number | null
          original_financed_charge?: number | null
          other_balance_amount?: number | null
          other_due_amount?: number | null
          out_for_repo_date?: string | null
          payment_end_date?: string | null
          payment_frequency?: string | null
          payment_status?: string | null
          previous_payment_amount?: number | null
          principal_bad_debt_amount?: number | null
          principal_due_amount?: number | null
          principal_paid_amount?: number | null
          promise_amount?: number | null
          promise_created_date?: string | null
          promise_date?: string | null
          promise_note?: string | null
          promised_result?: string | null
          raw_data?: Json
          recovery_amount?: number | null
          recovery_without_repo_credit?: number | null
          remaining_payment?: number | null
          repo_company_name?: string | null
          repo_completed_date?: string | null
          repo_created_date?: string | null
          repo_credit?: number | null
          repo_fees?: number | null
          repo_location?: string | null
          repo_reason?: string | null
          repo_stage?: string | null
          repo_status?: string | null
          repo_type?: string | null
          side_note_due_amount?: number | null
          snapshot_date?: string
          tax_balance_amount?: number | null
          total_cash_in_deal?: number | null
          total_down_amount?: number | null
          total_down_paid_amount?: number | null
          total_gross?: number | null
          total_late_fees_paid_amount?: number | null
          total_other_fees_paid_amount?: number | null
          total_paid_amount?: number | null
          total_paid_without_down_side_note?: number | null
          total_past_due_amount?: number | null
          total_payment_amount?: number | null
          total_payment_due_amount?: number | null
          total_payoff_amount?: number | null
          total_price?: number | null
          total_side_note_paid_amount?: number | null
          vehicle_cost?: number | null
          vehicle_exterior_color?: string | null
          vehicle_fuel_type?: string | null
          vehicle_mileage?: number | null
          vehicle_price?: number | null
          vehicle_stock_number?: string | null
          vehicle_vin?: string | null
          vehicle_year_make_model?: string | null
          vin_last_six?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dms_accounts_snapshot_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "dms_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dms_accounts_snapshot_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dms_activity_events: {
        Row: {
          account_status: string | null
          activity_status: string | null
          activity_type: string | null
          assigned_rep_on_activity: string | null
          collector: string | null
          created_at: string
          created_date: string | null
          customer_name: string | null
          deal_number: string
          disposition: string | null
          event_hash: string
          has_promise: boolean
          id: string
          import_batch_id: string
          is_call: boolean
          is_email: boolean
          is_inbound: boolean
          is_outbound: boolean
          is_sms: boolean
          last_updated_by: string | null
          last_updated_date: string | null
          organization_id: string
          payment_due_date: string | null
          promise_amount: number | null
          promise_broken: boolean
          promise_date: string | null
          promise_kept: boolean
          promised_result: string | null
          raw_data: Json
          subject: string | null
        }
        Insert: {
          account_status?: string | null
          activity_status?: string | null
          activity_type?: string | null
          assigned_rep_on_activity?: string | null
          collector?: string | null
          created_at?: string
          created_date?: string | null
          customer_name?: string | null
          deal_number: string
          disposition?: string | null
          event_hash: string
          has_promise?: boolean
          id?: string
          import_batch_id: string
          is_call?: boolean
          is_email?: boolean
          is_inbound?: boolean
          is_outbound?: boolean
          is_sms?: boolean
          last_updated_by?: string | null
          last_updated_date?: string | null
          organization_id: string
          payment_due_date?: string | null
          promise_amount?: number | null
          promise_broken?: boolean
          promise_date?: string | null
          promise_kept?: boolean
          promised_result?: string | null
          raw_data: Json
          subject?: string | null
        }
        Update: {
          account_status?: string | null
          activity_status?: string | null
          activity_type?: string | null
          assigned_rep_on_activity?: string | null
          collector?: string | null
          created_at?: string
          created_date?: string | null
          customer_name?: string | null
          deal_number?: string
          disposition?: string | null
          event_hash?: string
          has_promise?: boolean
          id?: string
          import_batch_id?: string
          is_call?: boolean
          is_email?: boolean
          is_inbound?: boolean
          is_outbound?: boolean
          is_sms?: boolean
          last_updated_by?: string | null
          last_updated_date?: string | null
          organization_id?: string
          payment_due_date?: string | null
          promise_amount?: number | null
          promise_broken?: boolean
          promise_date?: string | null
          promise_kept?: boolean
          promised_result?: string | null
          raw_data?: Json
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dms_activity_events_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "dms_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dms_activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dms_import_batches: {
        Row: {
          created_at: string
          id: string
          imported_at: string
          imported_by_user_id: string | null
          notes: string | null
          organization_id: string
          raw_metadata: Json | null
          report_type: string
          row_count: number | null
          source_filename: string | null
          source_headers: Json | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          imported_at?: string
          imported_by_user_id?: string | null
          notes?: string | null
          organization_id: string
          raw_metadata?: Json | null
          report_type: string
          row_count?: number | null
          source_filename?: string | null
          source_headers?: Json | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          imported_at?: string
          imported_by_user_id?: string | null
          notes?: string | null
          organization_id?: string
          raw_metadata?: Json | null
          report_type?: string
          row_count?: number | null
          source_filename?: string | null
          source_headers?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "dms_import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dms_payment_ledger: {
        Row: {
          account_conditions: string | null
          account_status: string | null
          balance_amount: number | null
          collector_name: string | null
          created_at: string
          credit_applied_amt: number | null
          days_late: number | null
          deal_number: string
          deal_status: string | null
          down_applied_amt: number | null
          due_amount: number | null
          id: string
          import_batch_id: string
          interest_applied_amt: number | null
          interest_due_amount: number | null
          is_ach_returned: boolean | null
          is_auto_nsf: boolean | null
          is_reversal: boolean
          last_updated_by_name: string | null
          last_updated_date: string | null
          late_fee_amount: number | null
          late_fees_applied_amt: number | null
          organization_id: string
          other_fees_applied_amt: number | null
          other_fees_due_amount: number | null
          paid_amount: number | null
          paid_date: string | null
          period_num: string | null
          positive_payment_amount: number | null
          principal_applied_amt: number | null
          principal_due_amount: number | null
          processing_fee_due_amount: number | null
          raw_data: Json
          ref_num: string | null
          reversal_amount: number | null
          side_note_applied_amt: number | null
          side_note_due_amount: number | null
          transaction_hash: string
          transaction_type: string | null
        }
        Insert: {
          account_conditions?: string | null
          account_status?: string | null
          balance_amount?: number | null
          collector_name?: string | null
          created_at?: string
          credit_applied_amt?: number | null
          days_late?: number | null
          deal_number: string
          deal_status?: string | null
          down_applied_amt?: number | null
          due_amount?: number | null
          id?: string
          import_batch_id: string
          interest_applied_amt?: number | null
          interest_due_amount?: number | null
          is_ach_returned?: boolean | null
          is_auto_nsf?: boolean | null
          is_reversal?: boolean
          last_updated_by_name?: string | null
          last_updated_date?: string | null
          late_fee_amount?: number | null
          late_fees_applied_amt?: number | null
          organization_id: string
          other_fees_applied_amt?: number | null
          other_fees_due_amount?: number | null
          paid_amount?: number | null
          paid_date?: string | null
          period_num?: string | null
          positive_payment_amount?: number | null
          principal_applied_amt?: number | null
          principal_due_amount?: number | null
          processing_fee_due_amount?: number | null
          raw_data: Json
          ref_num?: string | null
          reversal_amount?: number | null
          side_note_applied_amt?: number | null
          side_note_due_amount?: number | null
          transaction_hash: string
          transaction_type?: string | null
        }
        Update: {
          account_conditions?: string | null
          account_status?: string | null
          balance_amount?: number | null
          collector_name?: string | null
          created_at?: string
          credit_applied_amt?: number | null
          days_late?: number | null
          deal_number?: string
          deal_status?: string | null
          down_applied_amt?: number | null
          due_amount?: number | null
          id?: string
          import_batch_id?: string
          interest_applied_amt?: number | null
          interest_due_amount?: number | null
          is_ach_returned?: boolean | null
          is_auto_nsf?: boolean | null
          is_reversal?: boolean
          last_updated_by_name?: string | null
          last_updated_date?: string | null
          late_fee_amount?: number | null
          late_fees_applied_amt?: number | null
          organization_id?: string
          other_fees_applied_amt?: number | null
          other_fees_due_amount?: number | null
          paid_amount?: number | null
          paid_date?: string | null
          period_num?: string | null
          positive_payment_amount?: number | null
          principal_applied_amt?: number | null
          principal_due_amount?: number | null
          processing_fee_due_amount?: number | null
          raw_data?: Json
          ref_num?: string | null
          reversal_amount?: number | null
          side_note_applied_amt?: number | null
          side_note_due_amount?: number | null
          transaction_hash?: string
          transaction_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dms_payment_ledger_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "dms_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dms_payment_ledger_organization_id_fkey"
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
      account_collections_signals: {
        Row: {
          collections_effort_score: number | null
          collections_tier: string | null
          contacts_30d: number | null
          contacts_60d: number | null
          contacts_90d: number | null
          customer_behavior_type: string | null
          days_since_last_activity: number | null
          deal_number: string | null
          inbound_90d: number | null
          organization_id: string | null
          outbound_90d: number | null
          promise_reliability_life: number | null
          promises_90d: number | null
          response_rate_90d: number | null
          total_promise_amount: number | null
          total_promise_broken: number | null
          total_promise_kept: number | null
          total_promises: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dms_accounts_snapshot_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      account_outcomes: {
        Row: {
          account_sale_received_amount: number | null
          account_status_normalized: string | null
          bad_debt_amount: number | null
          buy_back_cost: number | null
          days_to_charge_off: number | null
          days_to_close: number | null
          days_to_repo: number | null
          deal_number: string | null
          exposure: number | null
          is_bad_outcome: boolean | null
          is_excluded: boolean | null
          is_good_outcome: boolean | null
          loss_severity: number | null
          net_outcome_estimate: number | null
          net_profit: number | null
          organization_id: string | null
          outcome_bucket: string | null
          recovery_amount: number | null
          repo_credit: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dms_accounts_snapshot_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      account_payment_signals: {
        Row: {
          avg_payment_60d: number | null
          catchup_gap_estimated: number | null
          days_past_due: number | null
          days_since_last_payment: number | null
          deal_number: string | null
          expected_paid_30d: number | null
          expected_paid_60d: number | null
          expected_paid_90d: number | null
          first_ledger_payment: string | null
          fragmented_payment_flag: boolean | null
          last_positive_payment_date: string | null
          latest_snapshot_date: string | null
          lifetime_paid_from_ledger: number | null
          organization_id: string | null
          payment_frequency: string | null
          payment_ratio_30d: number | null
          payment_ratio_60d: number | null
          payment_ratio_90d: number | null
          payments_30d: number | null
          payments_60d: number | null
          payments_90d: number | null
          reversals_30d: number | null
          reversals_60d: number | null
          reversals_90d: number | null
          scheduled_payment_amount: number | null
          survival_payment_flag: boolean | null
          total_paid_30d: number | null
          total_paid_60d: number | null
          total_paid_90d: number | null
          total_payment_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dms_accounts_snapshot_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      account_repo_signals: {
        Row: {
          account_status: string | null
          balance_principal_amount: number | null
          collateral_status: string | null
          collector_name: string | null
          current_insurance_expiry_date: string | null
          customer_name: string | null
          days_past_due: number | null
          days_since_last_payment: number | null
          deal_number: string | null
          exposure: number | null
          insurance_status: string | null
          latest_snapshot_date: string | null
          organization_id: string | null
          payment_ratio_60d: number | null
          payment_status: string | null
          payments_60d: number | null
          pre_repo: boolean | null
          promise_date: string | null
          promised_result: string | null
          recommended_status: string | null
          repo_now: boolean | null
          repo_reason: string | null
          repo_score: number | null
          repo_stage: string | null
          repo_status: string | null
          repo_type: string | null
          reversals_60d: number | null
          risk_flags: string[] | null
          total_past_due_amount: number | null
          total_payment_amount: number | null
          total_payment_due_amount: number | null
          total_payoff_amount: number | null
          vehicle_stock_number: string | null
          vehicle_vin: string | null
          vehicle_year_make_model: string | null
          vin_last_six: string | null
          watch: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "dms_accounts_snapshot_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      dms_hash_part: { Args: { raw_value: string }; Returns: string }
      dms_parse_boolean: { Args: { raw_value: string }; Returns: boolean }
      dms_parse_date: { Args: { raw_value: string }; Returns: string }
      dms_parse_numeric: { Args: { raw_value: string }; Returns: number }
      dms_parse_timestamptz: { Args: { raw_value: string }; Returns: string }
      dms_payment_frequency_days: {
        Args: { raw_value: string }
        Returns: number
      }
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
