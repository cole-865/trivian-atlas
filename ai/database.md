# Database Structure - Trivian Atlas

## Purpose
This file defines the core database structure and relationships.

Codex must:
- use existing tables
- not invent new schema without instruction
- respect organization scoping
- follow relationships defined here

---

## Core rule (CRITICAL)

ALL business data is organization-scoped.

- Always filter by `organization_id`
- Never trust client-provided organization_id
- Always derive org context server-side

---

# 🧱 Core Entities

## Organizations

### organizations
- id
- name
- slug
- is_active

---

### organization_users
Links users to organizations.

- user_id
- organization_id
- role (sales | management | admin)
- is_active
- can_approve_deal_overrides

---

### organization_invitations
Handles onboarding.

- email
- role
- status (pending | accepted | expired | revoked)
- token_hash
- expires_at

---

# 🚗 Deals (Core Workflow)

### deals
Primary deal record.

- id
- customer_name
- organization_id
- status
- current_step
- max_payment
- cash_down
- workflow_status

---

### deal_people
Applicants (primary + co)

- deal_id
- role (primary | co)
- name, address, phone
- residence_months

---

### income_profiles
Income per applicant

- deal_person_id
- income_type (w2, self_employed, etc)
- monthly_gross_calculated
- pay_frequency
- hire_date

---

# 🧠 Underwriting

### underwriting_inputs
Raw deal inputs

- deal_id
- gross_monthly_income
- total_monthly_income
- monthly_debt
- monthly_housing
- interest_rate_apr
- term_months

---

### underwriting_results
System decision + limits

- deal_id
- tier
- decision
- max_ltv
- max_pti
- max_amount_financed
- max_vehicle_price
- max_term_months
- min_cash_down
- min_down_pct
- apr

👉 THIS TABLE DRIVES ALL STRUCTURING LOGIC

---

### underwriting_tier_policy
Defines rules per tier

- tier
- max_ltv
- max_pti
- max_term_months
- max_vehicle_price
- min_cash_down
- min_down_pct

---

# 🚘 Inventory

### trivian_inventory
Vehicle inventory

- id
- stock_number
- vin
- year / make / model
- asking_price
- jd_power_retail_book
- odometer
- organization_id
- status

---

# 💰 Deal Structuring

### deal_structure_inputs
Inputs used to build structure

- deal_id
- vehicle_id
- sale_price
- cash_down
- term_months
- include_vsc
- include_gap
- tax_rate_main
- tax_add_rate

---

### deal_structure
Computed deal

- deal_id
- vehicle_id
- monthly_payment
- amount_financed
- ltv
- term_months
- include_vsc
- include_gap
- product_total
- fits_program (true/false)
- fail_reasons (JSON)

---

### deal_vehicle_selection
Final selected structure

- deal_id
- vehicle_id
- monthly_payment
- term_months
- include_vsc
- include_gap

---

# 🔁 Overrides System

### deal_override_requests
When a deal fails constraints

- deal_id
- blocker_code (PTI, LTV, etc)
- status
- structure_fingerprint
- requested_by
- reviewed_by

---

### deal_override_counter_offers
Alternative structures

- deal_id
- inputs_json
- outputs_snapshot_json
- status
- version_number

---

# 📄 Documents

### deal_documents
Uploaded deal docs

- deal_id
- doc_type
- storage_path

---

### credit_reports / credit_report_jobs
Credit parsing pipeline

- raw_path
- redacted_path
- extracted_text
- status (queued → parsing → done)

---

### bureau_summary
Parsed credit summary

- deal_id
- score
- risk_tier
- repo_count
- total_collections
- utilization_pct

---

# ⚙️ Config

### trivian_config
Global deal settings

- apr
- doc_fee
- gap_price
- vsc_price
- tax_rate_main
- tax_add_rate
- payment_cap_pct

---

### vehicle_term_policy
Controls term by vehicle

- max_term_months
- mileage limits
- vehicle age limits

---

# 🔑 Key Relationships

- deals → organization_id
- deal_people → deals
- income_profiles → deal_people
- underwriting_results → deals
- deal_structure → deals
- deal_structure → vehicle (inventory)
- overrides → deals
- inventory → organization_id

---

# ⚠️ Safety Rules

- Never query deals without organization filter
- Never join across organizations
- Never bypass underwriting_results limits
- Never compute structure without:
  - underwriting_results
  - deal_structure_inputs

---

# 🧠 Notes for Codex

- underwriting_results is the source of truth for limits
- deal_structure is computed, not user input
- inventory must always be filtered by organization
- overrides are required when constraints fail
- do not duplicate business logic across API routes