-- Ask 865 reporting migration, scoped to the existing 865 Autos organization.
-- Source auth, Meals, public schema, and source infrastructure are excluded.
-- Login passwords and data are transferred separately; no secrets in this file.
-- This remains a private single-dealership store until Atlas module integration.
CREATE ROLE ask865_ingest NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ask865_ingest TO postgres;
CREATE ROLE ask865_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ask865_reader TO postgres;
CREATE ROLE ask865_sensitive_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ask865_sensitive_reader TO postgres;
CREATE ROLE ask865_view_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ask865_view_owner TO postgres;
CREATE ROLE ask865_n8n NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ask865_n8n TO postgres;
CREATE ROLE ask865_dashboard_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ask865_dashboard_app TO postgres;
GRANT ask865_ingest TO ask865_n8n;
GRANT ask865_reader TO ask865_dashboard_app;
ALTER ROLE ask865_n8n CONNECTION LIMIT 5;
ALTER ROLE ask865_dashboard_app SET default_transaction_read_only = on;
ALTER ROLE ask865_dashboard_app SET statement_timeout = '15s';
ALTER ROLE ask865_dashboard_app SET idle_in_transaction_session_timeout = '15s';
GRANT USAGE ON SCHEMA extensions TO ask865_ingest;
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ask865; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA ask865;
GRANT CREATE ON SCHEMA ask865 TO ask865_view_owner;


ALTER SCHEMA ask865 OWNER TO postgres;

--
-- Name: SCHEMA ask865; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA ask865 IS 'Private Ask 865 business-intelligence data, beginning with DealerCenter.';


--
-- Name: audit_completed_import(); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.audit_completed_import() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'ask865'
    AS $$
begin
  perform ask865.audit_import(new.id);
  return new;
end $$;


ALTER FUNCTION ask865.audit_completed_import() OWNER TO postgres;

--
-- Name: audit_import(bigint); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.audit_import(p_run_id bigint) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'ask865'
    AS $$
declare
  r ask865.import_runs%rowtype;
  stored integer;
  normalized integer;
  expected integer;
  problems text[] := '{}';
begin
  select * into strict r from ask865.import_runs where id=p_run_id;
  if r.status not in ('loaded','loaded_with_warnings') or r.completed_at is null then return; end if;
  select expected_header_count into expected from ask865.report_definitions where report_key=r.report_key;
  select count(*) into stored from ask865.report_rows where import_run_id=r.id;
  if r.source_row_count <> r.loaded_row_count + r.rejected_row_count then problems := array_append(problems,'source_count_mismatch'); end if;
  if stored <> r.loaded_row_count then problems := array_append(problems,'stored_count_mismatch'); end if;
  if r.rejected_row_count > 0 then problems := array_append(problems,'rejected_rows'); end if;
  if cardinality(r.header_names) <> expected then problems := array_append(problems,'header_count_mismatch'); end if;
  case r.report_key
    when 'ask865_sold_deals_gross' then select count(*) into normalized from ask865.sold_deals where source_import_run_id=r.id and is_in_latest_export;
    when 'ask865_current_inventory' then select count(*) into normalized from ask865.inventory_snapshots where import_run_id=r.id;
    when 'ask865_inventory_cost_detail' then select count(*) into normalized from ask865.inventory_cost_snapshots where import_run_id=r.id;
    when 'ask865_price_log' then select count(*) into normalized from ask865.inventory_price_history where import_run_id=r.id;
    else
      if r.report_key in ('ask865_amended_contracts','ask865_charge_offs','ask865_deferred_down_tracking','ask865_open_promises','ask865_reversed_payments','ask865_lender_buybacks') then
        select count(*) into normalized from ask865.bhph_account_events where import_run_id=r.id;
      end if;
  end case;
  if normalized is not null and normalized <> r.loaded_row_count then problems := array_append(problems,'normalized_count_mismatch'); end if;
  insert into ask865.import_audits(import_run_id,completed_at,stored_rows,normalized_rows,problems)
    values(r.id,r.completed_at,stored,normalized,problems)
    on conflict(import_run_id,completed_at) do update set checked_at=now(),stored_rows=excluded.stored_rows,normalized_rows=excluded.normalized_rows,problems=excluded.problems;

  -- Only latest snapshots may resolve or reopen current issues. Replaying older files cannot clear them.
  if exists(select 1 from ask865.import_runs newer where newer.report_key=r.report_key and (newer.snapshot_at,newer.id)>(r.snapshot_at,r.id)) then return; end if;
  update ask865.source_issue_register set resolved_at=now(),affected_rows=0,source_row_numbers='{}'
    where report_key=r.report_key and resolved_at is null;
  insert into ask865.source_issue_register(report_key,issue_code,last_seen_at,affected_rows,source_row_numbers)
    with observations as (
      select code,rr.row_number from ask865.report_rows rr cross join lateral unnest(rr.parser_warnings) code where rr.import_run_id=r.id
      union all
      select 'missing_stock_number',source_row_number from ask865.sold_deals where source_import_run_id=r.id and stock_no is null
      union all
      select 'missing_vin',source_row_number from ask865.sold_deals where source_import_run_id=r.id and vin is null
      union all
      select 'missing_primary_salesperson',source_row_number from ask865.sold_deals where source_import_run_id=r.id and salesperson1_name is null
      union all
      select 'finance_deal_missing_lender',source_row_number from ask865.sold_deals where source_import_run_id=r.id and deal_type='FINANCE' and lender_name is null
      union all
      select 'gross_completeness_or_arithmetic',source_row_number from ask865.sold_deals where source_import_run_id=r.id and (front_gross is null or back_gross is null or total_gross is null or abs(total_gross-front_gross-back_gross)>0.01)
      union all
      select 'future_or_impossible_sale_dates',source_row_number from ask865.sold_deals where source_import_run_id=r.id and (deal_date>current_date or funded_date<deal_date)
      union all
      select 'inventory_required_field_gaps',source_row_number from ask865.inventory_snapshots where import_run_id=r.id and (vin is null or status is null or vehicle_cost is null or total_cost is null or days_in_inventory is null or vehicle_purchase_source is null)
      union all
      select 'vin_used_by_multiple_stock_numbers',source_row_number from ask865.inventory_snapshots i where import_run_id=r.id and vin is not null and exists(select 1 from ask865.inventory_snapshots j where j.import_run_id=r.id and j.vin=i.vin and j.stock_no<>i.stock_no)
      union all
      select 'future_bhph_event_date',source_row_number from ask865.bhph_account_events where import_run_id=r.id and event_date>current_date+interval '1 year'
      union all
      select 'negative_days_past_due',source_row_number from ask865.bhph_account_events where import_run_id=r.id and days_past_due<0
    )
    select r.report_key,code,now(),count(distinct row_number),array_agg(distinct row_number order by row_number)
    from observations group by code
    on conflict(report_key,issue_code) do update set last_seen_at=excluded.last_seen_at,resolved_at=null,
      affected_rows=excluded.affected_rows,source_row_numbers=excluded.source_row_numbers;
end $$;


ALTER FUNCTION ask865.audit_import(p_run_id bigint) OWNER TO postgres;

--
-- Name: dc_boolean(text); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.dc_boolean(value text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'pg_catalog'
    AS $$
  select case lower(btrim(value))
    when 'true' then true when 'yes' then true when 'y' then true when '1' then true
    when 'false' then false when 'no' then false when 'n' then false when '0' then false
    else null
  end
$$;


ALTER FUNCTION ask865.dc_boolean(value text) OWNER TO postgres;

--
-- Name: dc_date(text); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.dc_date(value text) RETURNS date
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'pg_catalog'
    AS $_$
  select case
    when nullif(btrim(value), '') is null then null
    when value ~ '^\d{4}-\d{2}-\d{2}$' then value::date
    else to_date(split_part(value, ' ', 1), 'MM/DD/YYYY')
  end
$_$;


ALTER FUNCTION ask865.dc_date(value text) OWNER TO postgres;

--
-- Name: dc_integer(text); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.dc_integer(value text) RETURNS integer
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'pg_catalog'
    AS $$
  select ask865.dc_number(value)::integer
$$;


ALTER FUNCTION ask865.dc_integer(value text) OWNER TO postgres;

--
-- Name: dc_number(text); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.dc_number(value text) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'pg_catalog'
    AS $$
  select case
    when nullif(btrim(value), '') is null then null
    else
      (case when btrim(value) like '(%)' then -1 else 1 end) *
      nullif(regexp_replace(value, '[^0-9.\-]', '', 'g'), '')::numeric
  end
$$;


ALTER FUNCTION ask865.dc_number(value text) OWNER TO postgres;

--
-- Name: dc_timestamp(text); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.dc_timestamp(value text) RETURNS timestamp with time zone
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'pg_catalog'
    AS $$
  select case
    when nullif(btrim(value), '') is null then null
    else to_timestamp(value, 'MM/DD/YYYY HH12:MI:SS AM') at time zone 'America/New_York'
  end
$$;


ALTER FUNCTION ask865.dc_timestamp(value text) OWNER TO postgres;

--
-- Name: ingest_dealercenter_report(text, text, text, timestamp with time zone, text, jsonb, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: ask865; Owner: postgres
--

CREATE FUNCTION ask865.ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'ask865', 'extensions', 'pg_catalog'
    AS $$
declare
  v_run_id bigint;
  v_file_sha text;
  v_row_count integer;
  v_warning_count integer;
  v_snapshot_at timestamptz := coalesce(p_received_at, now());
begin
  if not exists (select 1 from ask865.report_definitions where report_key = p_report_key and is_active) then
    raise exception 'Unknown or inactive Ask 865 report key: %', p_report_key;
  end if;
  if jsonb_typeof(p_headers) <> 'array' or jsonb_typeof(p_rows) <> 'array'
     or jsonb_typeof(p_raw_rows) <> 'array' or jsonb_typeof(p_row_warnings) <> 'array' then
    raise exception 'Headers, rows, raw rows, and warnings must be JSON arrays';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count > 5000 then
    raise exception 'Ask 865 report exceeds the 5,000 row safety limit';
  end if;
  if jsonb_array_length(p_raw_rows) <> v_row_count then
    raise exception 'Normalized row count does not match raw row count';
  end if;

  select count(*)::integer
  into v_warning_count
  from jsonb_array_elements(p_row_warnings) warning_row
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(warning_row) = 'array' then warning_row else '[]'::jsonb end
  );

  v_file_sha := encode(extensions.digest(convert_to(p_raw_csv, 'UTF8'), 'sha256'), 'hex');

  insert into ask865.import_runs (
    report_key, source_filename, source_message_id, file_sha256,
    source_received_at, snapshot_at, status, header_names,
    source_row_count, loaded_row_count, rejected_row_count, warning_count,
    started_at, metadata
  ) values (
    p_report_key, p_filename, nullif(p_message_id, ''), v_file_sha,
    p_received_at, v_snapshot_at, 'loading',
    array(select jsonb_array_elements_text(p_headers)),
    v_row_count, 0, 0, 0, now(),
    jsonb_build_object('loader', 'ask865_n8n_v1', 'email_message_id', p_message_id)
  )
  on conflict (report_key, file_sha256) do update set
    source_filename = excluded.source_filename,
    source_message_id = excluded.source_message_id,
    source_received_at = excluded.source_received_at,
    snapshot_at = excluded.snapshot_at,
    status = 'loading',
    header_names = excluded.header_names,
    source_row_count = excluded.source_row_count,
    loaded_row_count = 0,
    rejected_row_count = 0,
    warning_count = 0,
    started_at = now(),
    completed_at = null,
    error_summary = null,
    metadata = excluded.metadata
  returning id into v_run_id;

  delete from ask865.report_rows where import_run_id = v_run_id;
  delete from ask865.data_quality_issues
  where import_run_id = v_run_id
    and issue_code in (
      'removed_dealercenter_extra_blank_before_vehicle',
      'rejoined_unquoted_company_name',
      'padded_missing_company_name',
      'right_padded_omitted_trailing_fields',
      'preserved_overflow_fields'
    );

  insert into ask865.report_rows (
    import_run_id, row_number, report_key, deal_no, deal_identifier,
    account_id, account_number, stock_no, vin, lender_name, record_date,
    row_sha256, data, raw_fields, parser_warnings
  )
  select
    v_run_id,
    row_data.ordinality::integer,
    p_report_key,
    nullif(btrim(coalesce(
      row_data.value->>'Deal No.', row_data.value->>'Deal #',
      row_data.value->>'Deal ID', row_data.value->>'Deal Id',
      row_data.value->>'Deal Number'
    )), ''),
    nullif(btrim(coalesce(row_data.value->>'Deal Identifier', row_data.value->>'DealIdentifier')), ''),
    nullif(btrim(coalesce(row_data.value->>'AccountId', row_data.value->>'Account ID')), ''),
    nullif(btrim(coalesce(row_data.value->>'AccountNumber', row_data.value->>'Account Number')), ''),
    nullif(btrim(coalesce(
      row_data.value->>'Stock No.', row_data.value->>'Stock #',
      row_data.value->>'Stock Number', row_data.value->>'StockNumber',
      row_data.value->>'Vehicle Stock Number', row_data.value->>'VehicleStockNumber'
    )), ''),
    nullif(btrim(coalesce(
      row_data.value->>'Vehicle VIN', row_data.value->>'Vehicle Vin',
      row_data.value->>'VIN', row_data.value->>'Vin'
    )), ''),
    nullif(btrim(coalesce(
      row_data.value->>'Lender Name', row_data.value->>'Lender', row_data.value->>'LenderName'
    )), ''),
    ask865.dc_date(coalesce(
      row_data.value->>'Deal Date', row_data.value->>'DealDate',
      row_data.value->>'DateInStock', row_data.value->>'PurchaseDate',
      row_data.value->>'DateAdded', row_data.value->>'PromiseDate',
      row_data.value->>'OfferDateToString'
    )),
    encode(extensions.digest(convert_to(row_data.value::text, 'UTF8'), 'sha256'), 'hex'),
    row_data.value,
    coalesce(array(
      select jsonb_array_elements_text(coalesce(p_raw_rows->(row_data.ordinality::integer - 1), '[]'::jsonb))
    ), '{}'::text[]),
    coalesce(array(
      select jsonb_array_elements_text(coalesce(p_row_warnings->(row_data.ordinality::integer - 1), '[]'::jsonb))
    ), '{}'::text[])
  from jsonb_array_elements(p_rows) with ordinality as row_data(value, ordinality);

  insert into ask865.data_quality_issues
    (import_run_id, row_number, severity, issue_code, issue_message)
  select
    v_run_id,
    warning_row.ordinality::integer,
    'warning',
    warning_code.value,
    'DealerCenter CSV structure normalized during n8n ingestion.'
  from jsonb_array_elements(p_row_warnings) with ordinality warning_row(value, ordinality)
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(warning_row.value) = 'array' then warning_row.value else '[]'::jsonb end
  ) warning_code(value)
  on conflict do nothing;

  if p_report_key = 'ask865_sold_deals_gross' then
    update ask865.sold_deals set is_in_latest_export = false;

    insert into ask865.sold_deals (
      deal_no, deal_identifier, application_no, ros_number,
      deal_status, deal_date, delivery_date, funded_date, deal_type, finance_type,
      salesperson1_name, salesperson2_name, salesperson1_id, salesperson2_id,
      sales_manager_name, finance_manager_name,
      stock_no, vin, vehicle_year, vehicle_make, vehicle_model, vehicle_trim,
      lender_name, purchase_price, vehicle_price, vehicle_asking_price, advertising_price,
      vehicle_cost, vehicle_total_cost_adds, vehicle_total_packs, pack_cost, total_vehicle_cost,
      front_gross, back_gross, total_gross, net_gross, net_profit,
      total_commissions, gross_adjustment, deal_source, lead_source, days_in_stock,
      vehicle_purchase_source, purchased_from, acquisition_fee,
      contract_apr, buy_rate, term_months, monthly_payment, financed_amount,
      cash_down, cash_down_collected, cash_down_balance, reserve_amount, lender_fees, net_check,
      total_tax, doc_fee,
      service_contract_name, service_contract_cost, service_contract_price, service_contract_gross,
      gap_name, gap_cost, gap_price, gap_gross,
      additional_products_cost, additional_products_price, additional_products_gross,
      net_trade_in, total_deal_costs, total_deal_fees, total_fees, total_official_fees,
      finance_charge, flat_reserve, dealer_discount_rate, discount,
      econtract_status, funding_check_received, stips_status,
      dealercenter_created_at, dealercenter_created_by,
      dealercenter_updated_at, dealercenter_updated_by, deal_age, days_since_sold,
      source_import_run_id, source_row_number, source_row_sha256, source_data,
      is_in_latest_export, last_seen_at
    )
    select
      nullif(btrim(r->>'Deal No.'), ''),
      nullif(btrim(r->>'Deal Identifier'), ''),
      nullif(btrim(r->>'App. No.'), ''),
      nullif(btrim(r->>'ROS Number'), ''),
      nullif(btrim(r->>'Deal Status'), ''),
      ask865.dc_date(r->>'Deal Date'), ask865.dc_date(r->>'Delivery Date'), ask865.dc_date(r->>'Funded Date'),
      nullif(btrim(r->>'Deal Type'), ''),
      case upper(coalesce(r->>'Deal Type',''))
        when 'BHPH' then 'bhph' when 'FINANCE' then 'outside_finance'
        when 'CASH' then 'cash' when 'WHOLESALE' then 'wholesale' else lower(nullif(btrim(r->>'Deal Type'),'')) end,
      nullif(btrim(r->>'Sales Person1 Name'), ''), nullif(btrim(r->>'Sales Person2 Name'), ''),
      nullif(btrim(r->>'Sales Person1 ID'), ''), nullif(btrim(r->>'Sales Person2 ID'), ''),
      nullif(btrim(r->>'Sales Manager Name'), ''), nullif(btrim(r->>'Finance Manager Name'), ''),
      nullif(btrim(r->>'Stock No.'), ''), nullif(btrim(r->>'Vehicle VIN'), ''),
      ask865.dc_integer(r->>'Year'), nullif(btrim(r->>'Vehicle Make'), ''),
      nullif(btrim(r->>'Model'), ''), nullif(btrim(r->>'Trim'), ''), nullif(btrim(r->>'Lender Name'), ''),
      ask865.dc_number(r->>'Purchase Price'), ask865.dc_number(r->>'Vehicle Price'),
      ask865.dc_number(r->>'Vehicle Asking Price'), ask865.dc_number(r->>'Advertising Price'),
      ask865.dc_number(r->>'Vehicle Cost'), ask865.dc_number(r->>'Vehicle Total Cost Adds'),
      ask865.dc_number(r->>'Vehicle Total Packs'), ask865.dc_number(r->>'Pack Cost'),
      ask865.dc_number(r->>'Total Vehicle Cost'), ask865.dc_number(r->>'Front Gross Amount'),
      ask865.dc_number(r->>'Backend Gross Amount'), ask865.dc_number(r->>'Total Gross'),
      ask865.dc_number(r->>'Net Gross Amount'), ask865.dc_number(r->>'Net Profit'),
      ask865.dc_number(r->>'Total Commissions'), ask865.dc_number(r->>'Gross Adjustment'),
      nullif(btrim(r->>'Deal Source'), ''), nullif(btrim(r->>'Lead Source'), ''), ask865.dc_integer(r->>'Days in Stock'),
      nullif(btrim(r->>'Vehicle Purchase Source'), ''), nullif(btrim(r->>'Purchased From'), ''),
      ask865.dc_number(r->>'Acquisition Fee Amount'), ask865.dc_number(r->>'Contract APR'),
      ask865.dc_number(r->>'Buy Rate'), ask865.dc_integer(r->>'Term'),
      ask865.dc_number(r->>'Monthly Payment Amount'), ask865.dc_number(r->>'Financed Amount'),
      ask865.dc_number(r->>'Cash Down Amount'), ask865.dc_number(r->>'Cash Down Collected'),
      ask865.dc_number(r->>'Cash Down Balance'), ask865.dc_number(r->>'Reserve Amount'),
      ask865.dc_number(r->>'Lender Fees'), ask865.dc_number(r->>'Net Check'),
      ask865.dc_number(r->>'Total Tax'), ask865.dc_number(r->>'Doc Fee'),
      nullif(btrim(r->>'Service Contract Name'), ''), ask865.dc_number(r->>'Service Contract Cost'),
      ask865.dc_number(r->>'Service Contract Price'), ask865.dc_number(r->>'Service Contract Gross'),
      nullif(btrim(r->>'Gap Name'), ''), ask865.dc_number(r->>'Gap Insurance Cost'),
      ask865.dc_number(r->>'Gap Insurance Premium'), ask865.dc_number(r->>'GAP Gross'),
      ask865.dc_number(r->>'Total Additional Products Cost'), ask865.dc_number(r->>'Total Additional Products Price'),
      ask865.dc_number(r->>'Total Additional Products Gross'), ask865.dc_number(r->>'Net Trade In'),
      ask865.dc_number(r->>'Total Deal Costs'), ask865.dc_number(r->>'Total Deal Fees'),
      ask865.dc_number(r->>'Total Fees'), ask865.dc_number(r->>'Total Official Fees'),
      ask865.dc_number(r->>'Finance Charge Amount'), ask865.dc_number(r->>'Flat Reserve Amount'),
      ask865.dc_number(r->>'Dealer Discount Rate'), ask865.dc_number(r->>'Discount'),
      nullif(btrim(r->>'EContract Status'), ''), nullif(btrim(r->>'Funding Check Received'), ''),
      nullif(btrim(r->>'Stips Status'), ''), ask865.dc_timestamp(r->>'Created Date'),
      nullif(btrim(r->>'Created By Name'), ''), ask865.dc_timestamp(r->>'Last Updated Date'),
      nullif(btrim(r->>'Last Updated By Name'), ''), ask865.dc_integer(r->>'Deal Age'),
      ask865.dc_integer(r->>'Days Since Sold'), v_run_id, ordinality::integer,
      encode(extensions.digest(convert_to(r::text, 'UTF8'), 'sha256'), 'hex'), r, true, now()
    from jsonb_array_elements(p_rows) with ordinality source_rows(r, ordinality)
    where nullif(btrim(r->>'Deal No.'), '') is not null
    on conflict (deal_no) do update set
      deal_identifier=excluded.deal_identifier, application_no=excluded.application_no,
      ros_number=excluded.ros_number, deal_status=excluded.deal_status,
      deal_date=excluded.deal_date, delivery_date=excluded.delivery_date, funded_date=excluded.funded_date,
      deal_type=excluded.deal_type, finance_type=excluded.finance_type,
      salesperson1_name=excluded.salesperson1_name, salesperson2_name=excluded.salesperson2_name,
      salesperson1_id=excluded.salesperson1_id, salesperson2_id=excluded.salesperson2_id,
      sales_manager_name=excluded.sales_manager_name, finance_manager_name=excluded.finance_manager_name,
      stock_no=excluded.stock_no, vin=excluded.vin, vehicle_year=excluded.vehicle_year,
      vehicle_make=excluded.vehicle_make, vehicle_model=excluded.vehicle_model, vehicle_trim=excluded.vehicle_trim,
      lender_name=excluded.lender_name, purchase_price=excluded.purchase_price,
      vehicle_price=excluded.vehicle_price, vehicle_asking_price=excluded.vehicle_asking_price,
      advertising_price=excluded.advertising_price, vehicle_cost=excluded.vehicle_cost,
      vehicle_total_cost_adds=excluded.vehicle_total_cost_adds, vehicle_total_packs=excluded.vehicle_total_packs,
      pack_cost=excluded.pack_cost, total_vehicle_cost=excluded.total_vehicle_cost,
      front_gross=excluded.front_gross, back_gross=excluded.back_gross,
      total_gross=excluded.total_gross, net_gross=excluded.net_gross, net_profit=excluded.net_profit,
      total_commissions=excluded.total_commissions, gross_adjustment=excluded.gross_adjustment,
      deal_source=excluded.deal_source, lead_source=excluded.lead_source, days_in_stock=excluded.days_in_stock,
      vehicle_purchase_source=excluded.vehicle_purchase_source, purchased_from=excluded.purchased_from,
      acquisition_fee=excluded.acquisition_fee, contract_apr=excluded.contract_apr, buy_rate=excluded.buy_rate,
      term_months=excluded.term_months, monthly_payment=excluded.monthly_payment,
      financed_amount=excluded.financed_amount, cash_down=excluded.cash_down,
      cash_down_collected=excluded.cash_down_collected, cash_down_balance=excluded.cash_down_balance,
      reserve_amount=excluded.reserve_amount, lender_fees=excluded.lender_fees, net_check=excluded.net_check,
      total_tax=excluded.total_tax, doc_fee=excluded.doc_fee,
      service_contract_name=excluded.service_contract_name, service_contract_cost=excluded.service_contract_cost,
      service_contract_price=excluded.service_contract_price, service_contract_gross=excluded.service_contract_gross,
      gap_name=excluded.gap_name, gap_cost=excluded.gap_cost, gap_price=excluded.gap_price, gap_gross=excluded.gap_gross,
      additional_products_cost=excluded.additional_products_cost,
      additional_products_price=excluded.additional_products_price,
      additional_products_gross=excluded.additional_products_gross,
      net_trade_in=excluded.net_trade_in, total_deal_costs=excluded.total_deal_costs,
      total_deal_fees=excluded.total_deal_fees, total_fees=excluded.total_fees,
      total_official_fees=excluded.total_official_fees, finance_charge=excluded.finance_charge,
      flat_reserve=excluded.flat_reserve, dealer_discount_rate=excluded.dealer_discount_rate,
      discount=excluded.discount, econtract_status=excluded.econtract_status,
      funding_check_received=excluded.funding_check_received, stips_status=excluded.stips_status,
      dealercenter_created_at=excluded.dealercenter_created_at,
      dealercenter_created_by=excluded.dealercenter_created_by,
      dealercenter_updated_at=excluded.dealercenter_updated_at,
      dealercenter_updated_by=excluded.dealercenter_updated_by,
      deal_age=excluded.deal_age, days_since_sold=excluded.days_since_sold,
      source_import_run_id=excluded.source_import_run_id,
      source_row_number=excluded.source_row_number,
      source_row_sha256=excluded.source_row_sha256,
      source_data=excluded.source_data, is_in_latest_export=true, last_seen_at=now(), ingested_at=now();

    insert into ask865.sold_deal_sensitive (
      deal_no, signer_first_name, signer_last_name, signer_email, signer_cell_phone,
      customer_type_id, credit_score, credit_score_type,
      source_import_run_id, source_row_number
    )
    select
      nullif(btrim(r->>'Deal No.'), ''), nullif(btrim(r->>'Signer First Name'), ''),
      nullif(btrim(r->>'Signer Last Name'), ''), nullif(btrim(r->>'Signer Email'), ''),
      nullif(btrim(r->>'Signer Cell Phone'), ''), nullif(btrim(r->>'Customer Type ID'), ''),
      ask865.dc_integer(r->>'Credit Score')::smallint, nullif(btrim(r->>'Credit Score Type'), ''),
      v_run_id, ordinality::integer
    from jsonb_array_elements(p_rows) with ordinality source_rows(r, ordinality)
    where nullif(btrim(r->>'Deal No.'), '') is not null
    on conflict (deal_no) do update set
      signer_first_name=excluded.signer_first_name, signer_last_name=excluded.signer_last_name,
      signer_email=excluded.signer_email, signer_cell_phone=excluded.signer_cell_phone,
      customer_type_id=excluded.customer_type_id, credit_score=excluded.credit_score,
      credit_score_type=excluded.credit_score_type,
      source_import_run_id=excluded.source_import_run_id,
      source_row_number=excluded.source_row_number, ingested_at=now();

  elsif p_report_key = 'ask865_current_inventory' then
    delete from ask865.inventory_snapshots where import_run_id = v_run_id;
    insert into ask865.inventory_snapshots (
      import_run_id, stock_no, vin, snapshot_at, created_date, date_in_stock,
      status, custom_status, vehicle_year, vehicle_make, vehicle_model, vehicle_trim,
      odometer, exterior_color, interior_color,
      asking_price, advertising_price, special_price, vehicle_price, sale_price,
      days_in_inventory, days_in_stock, location, vehicle_sale_type,
      vehicle_purchase_type, vehicle_purchase_source, purchased_from, purchase_date,
      title_status, inspection_status, days_in_recon, photo_count, has_photo,
      is_featured_on_website, third_party_sites,
      purchase_amount, buyers_fee, vehicle_cost, additional_cost, total_adds, total_packs,
      actual_flooring_cost, estimated_flooring_cost, amount_floored,
      total_cost_with_estimated_flooring, total_cost, is_floored, flooring_company,
      flooring_rate, flooring_fee, date_floored, days_floored, date_flooring_paid_off,
      floor_price, potential_gross, wholesale_price, msrp, manheim_adjusted_mmr,
      jd_power_retail, jd_power_trade, jd_power_loan, kelley_typical_listing,
      black_book_retail_avg, black_book_wholesale_avg,
      purchase_reference_number, purchase_info_details, purchase_info_memo,
      import_source, dealercenter_updated_at,
      source_row_number, source_row_sha256, source_data
    )
    select
      v_run_id, nullif(btrim(r->>'Stock Number'), ''), nullif(btrim(r->>'VIN'), ''), v_snapshot_at,
      ask865.dc_date(r->>'Created Date'), ask865.dc_date(r->>'Date In Stock'),
      nullif(btrim(r->>'Status'), ''), nullif(btrim(r->>'Custom Status'), ''),
      ask865.dc_integer(r->>'Year'), nullif(btrim(r->>'Make'), ''),
      nullif(btrim(r->>'Model'), ''), nullif(btrim(r->>'Trim'), ''),
      ask865.dc_integer(r->>'Odometer'), nullif(btrim(r->>'Exterior Color'), ''), nullif(btrim(r->>'Interior Color'), ''),
      ask865.dc_number(r->>'Asking Price'), ask865.dc_number(r->>'Advertising Price'),
      ask865.dc_number(r->>'Special Price'), ask865.dc_number(r->>'Vehicle Price'), ask865.dc_number(r->>'Sale Price'),
      ask865.dc_integer(r->>'Days In Inventory'), ask865.dc_integer(r->>'Days In Stock'),
      nullif(btrim(r->>'Location'), ''), nullif(btrim(r->>'Vehicle Sale Type'), ''),
      nullif(btrim(r->>'Vehicle Purchase Type'), ''), nullif(btrim(r->>'Vehicle Purchase Source'), ''),
      nullif(btrim(r->>'Purchased From'), ''), ask865.dc_date(r->>'Purchase Date'),
      nullif(btrim(r->>'Title Status'), ''), nullif(btrim(r->>'Inspection Status'), ''),
      ask865.dc_integer(r->>'Carketa Days In Recon'), ask865.dc_integer(r->>'Number Of Pics'),
      ask865.dc_boolean(r->>'Has Photo'), ask865.dc_boolean(r->>'Is Featured On Website'),
      nullif(btrim(r->>'Third Party Sites'), ''), ask865.dc_number(r->>'Purchase Amount'),
      ask865.dc_number(r->>'Buyers Fee'), ask865.dc_number(r->>'Vehicle Cost'),
      ask865.dc_number(r->>'Additional Cost'), ask865.dc_number(r->>'Total Adds'),
      ask865.dc_number(r->>'Total Packs'), ask865.dc_number(r->>'Actual Flooring Cost'),
      ask865.dc_number(r->>'Estimated Flooring Cost'), ask865.dc_number(r->>'Amount Floored'),
      ask865.dc_number(r->>'Total Cost With Estimated Flooring'), ask865.dc_number(r->>'Total Cost'),
      ask865.dc_boolean(r->>'Is Floored'), nullif(btrim(r->>'Flooring Company'), ''),
      ask865.dc_number(r->>'Flooring Rate'), ask865.dc_number(r->>'Flooring Fee'),
      ask865.dc_date(r->>'Date Floored'), ask865.dc_integer(r->>'Days Floored'),
      ask865.dc_date(r->>'Date Flooring Paid Off'), ask865.dc_number(r->>'Floor Price'),
      ask865.dc_number(r->>'Potential Gross'), ask865.dc_number(r->>'Wholesale Price'),
      ask865.dc_number(r->>'MSRP'), ask865.dc_number(r->>'Manheim Adjusted MMR'),
      ask865.dc_number(r->>'J.D. Power Retail Book'), ask865.dc_number(r->>'J.D. Power Trade Book'),
      ask865.dc_number(r->>'J.D. Power Loan Book'), ask865.dc_number(r->>'Kelley Typical Listing Price Total'),
      ask865.dc_number(r->>'Black Book Total Retail Avg'), ask865.dc_number(r->>'Black Book Total Wholesale Avg'),
      nullif(btrim(r->>'Purchase Reference Number'), ''), nullif(btrim(r->>'Purchase Info Details'), ''),
      nullif(btrim(r->>'Purchase Info Memo'), ''), nullif(btrim(r->>'Import Source'), ''),
      ask865.dc_timestamp(r->>'Last Updated Date'), ordinality::integer,
      encode(extensions.digest(convert_to(r::text, 'UTF8'), 'sha256'), 'hex'), r
    from jsonb_array_elements(p_rows) with ordinality source_rows(r, ordinality)
    where nullif(btrim(r->>'Stock Number'), '') is not null;

  elsif p_report_key = 'ask865_inventory_cost_detail' then
    delete from ask865.inventory_cost_snapshots where import_run_id = v_run_id;
    insert into ask865.inventory_cost_snapshots (
      import_run_id, stock_no, vin, snapshot_at, status, date_in_stock, days_in_inventory,
      vehicle_cost, purchase_amount, buyers_fee, additional_cost, total_adds, total_packs,
      total_write_down, actual_flooring_cost, estimated_flooring_cost,
      total_cost_with_estimated_flooring, total_cost, potential_gross,
      front_gross, back_gross, total_gross, net_gross, net_profit,
      vehicle_purchase_source, purchased_from, purchased_from_vendor_id,
      purchase_reference_number, purchase_info_details, purchase_info_memo,
      source_row_number, source_row_sha256, source_data
    )
    select
      v_run_id, nullif(btrim(r->>'Stock Number'), ''), nullif(btrim(r->>'VIN'), ''), v_snapshot_at,
      nullif(btrim(r->>'Status'), ''), ask865.dc_date(r->>'Date In Stock'),
      ask865.dc_integer(r->>'Days In Inventory'), ask865.dc_number(r->>'Vehicle Cost'),
      ask865.dc_number(r->>'Purchase Amount'), ask865.dc_number(r->>'Buyers Fee'),
      ask865.dc_number(r->>'Additional Cost'), ask865.dc_number(r->>'Total Adds'),
      ask865.dc_number(r->>'Total Packs'), ask865.dc_number(r->>'Total Write Down'),
      ask865.dc_number(r->>'Actual Flooring Cost'), ask865.dc_number(r->>'Estimated Flooring Cost'),
      ask865.dc_number(r->>'Total Cost With Estimated Flooring'), ask865.dc_number(r->>'Total Cost'),
      ask865.dc_number(r->>'Potential Gross'), ask865.dc_number(r->>'Front Gross'),
      ask865.dc_number(r->>'Back End Gross'), ask865.dc_number(r->>'Total Gross'),
      ask865.dc_number(r->>'Net Gross Amount'), ask865.dc_number(r->>'Net Profit'),
      nullif(btrim(r->>'Vehicle Purchase Source'), ''), nullif(btrim(r->>'Purchased From'), ''),
      nullif(btrim(r->>'Purchased From Vendor ID'), ''), nullif(btrim(r->>'Purchase Reference Number'), ''),
      nullif(btrim(r->>'Purchase Info Details'), ''), nullif(btrim(r->>'Purchase Info Memo'), ''),
      ordinality::integer, encode(extensions.digest(convert_to(r::text, 'UTF8'), 'sha256'), 'hex'), r
    from jsonb_array_elements(p_rows) with ordinality source_rows(r, ordinality)
    where nullif(btrim(r->>'Stock Number'), '') is not null;

  elsif p_report_key = 'ask865_price_log' then
    delete from ask865.inventory_price_history where import_run_id = v_run_id;
    insert into ask865.inventory_price_history (
      import_run_id, stock_no, vin, snapshot_at, vehicle_description, days_in_stock,
      asking_price, advertising_price, special_price, vehicle_price, reprice_values,
      source_row_number, source_row_sha256, source_data
    )
    select
      v_run_id, nullif(btrim(r->>'StockNumber'), ''), nullif(btrim(r->>'Vin'), ''), v_snapshot_at,
      nullif(btrim(r->>'Description'), ''), ask865.dc_integer(r->>'DaysInStock'),
      ask865.dc_number(r->>'AskingPrice'), ask865.dc_number(r->>'AdvertisingPrice'),
      ask865.dc_number(r->>'SpecialPrice'), ask865.dc_number(r->>'VehiclePrice'),
      to_jsonb(array_remove(array[
        nullif(btrim(r->>'Reprice1'), ''), nullif(btrim(r->>'Reprice2'), ''),
        nullif(btrim(r->>'Reprice3'), ''), nullif(btrim(r->>'Reprice4'), ''),
        nullif(btrim(r->>'Reprice5'), ''), nullif(btrim(r->>'Reprice6'), '')
      ], null)),
      ordinality::integer, encode(extensions.digest(convert_to(r::text, 'UTF8'), 'sha256'), 'hex'), r
    from jsonb_array_elements(p_rows) with ordinality source_rows(r, ordinality)
    where nullif(btrim(r->>'StockNumber'), '') is not null;
  end if;

  if p_report_key in (
    'ask865_amended_contracts', 'ask865_charge_offs',
    'ask865_deferred_down_tracking', 'ask865_open_promises',
    'ask865_reversed_payments', 'ask865_lender_buybacks'
  ) then
    delete from ask865.bhph_account_events where import_run_id = v_run_id;
    insert into ask865.bhph_account_events (
      import_run_id, source_row_number, event_type, deal_no, deal_identifier,
      account_id, account_number, stock_no, vin, lender_name, account_status,
      event_date, due_date, amount, principal_balance, interest_balance,
      total_balance, days_past_due, source_row_sha256, source_data
    )
    select
      v_run_id, ordinality::integer, replace(p_report_key, 'ask865_', ''),
      nullif(btrim(coalesce(r->>'Deal #', r->>'Deal ID', r->>'Deal Id', r->>'Deal Identifier')), ''),
      nullif(btrim(coalesce(r->>'Deal Identifier', r->>'DealIdentifier')), ''),
      nullif(btrim(coalesce(r->>'AccountId', r->>'Account ID')), ''),
      nullif(btrim(coalesce(r->>'AccountNumber', r->>'Account Number')), ''),
      nullif(btrim(coalesce(r->>'Stock #', r->>'Vehicle Stock Number', r->>'VehicleStockNumber', r->>'StockNumber')), ''),
      nullif(btrim(coalesce(r->>'VIN', r->>'Vin', r->>'Vehicle Vin')), ''),
      nullif(btrim(coalesce(r->>'Lender Name', r->>'LenderName', r->>'Lender')), ''),
      nullif(btrim(coalesce(r->>'Account Status', r->>'AccountStatus', r->>'Status', r->>'Deal Status')), ''),
      ask865.dc_date(coalesce(r->>'Charge Off Date', r->>'PromiseDate', r->>'Loan Mod Date', r->>'Paid Date', r->>'Buyback Date', r->>'Deal Date')),
      ask865.dc_date(coalesce(r->>'Deferred Down 1 Due Date', r->>'Additional Deferred Due Date', r->>'PromiseDate')),
      ask865.dc_number(coalesce(r->>'Paid Amount', r->>'PromiseAmount', r->>'Buyback Amount', r->>'Total Deferred Down', r->>'New Payment')),
      ask865.dc_number(coalesce(r->>'Principal Balance', r->>'Prev Principal Bal')),
      ask865.dc_number(r->>'Interest Balance'),
      ask865.dc_number(coalesce(r->>'Total Balance', r->>'Balance Amount', r->>'Total Remaining')),
      ask865.dc_integer(r->>'Days Past Due'),
      encode(extensions.digest(convert_to(r::text, 'UTF8'), 'sha256'), 'hex'), r
    from jsonb_array_elements(p_rows) with ordinality source_rows(r, ordinality);
  end if;

  update ask865.import_runs
  set status = case when v_warning_count > 0 then 'loaded_with_warnings' else 'loaded' end,
      loaded_row_count = v_row_count,
      rejected_row_count = 0,
      warning_count = v_warning_count,
      completed_at = now()
  where id = v_run_id;

  return jsonb_build_object(
    'import_run_id', v_run_id,
    'report_key', p_report_key,
    'file_sha256', v_file_sha,
    'row_count', v_row_count,
    'warning_count', v_warning_count,
    'status', case when v_warning_count > 0 then 'loaded_with_warnings' else 'loaded' end
  );
end
$$;


ALTER FUNCTION ask865.ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb) OWNER TO postgres;

--
-- Name: FUNCTION ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb); Type: COMMENT; Schema: ask865; Owner: postgres
--

COMMENT ON FUNCTION ask865.ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb) IS 'Idempotent n8n entry point for normalized DealerCenter CSV attachments.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bhph_account_events; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.bhph_account_events (
    id bigint NOT NULL,
    import_run_id bigint NOT NULL,
    source_row_number integer NOT NULL,
    event_type text NOT NULL,
    deal_no text,
    deal_identifier text,
    account_id text,
    account_number text,
    stock_no text,
    vin text,
    lender_name text,
    account_status text,
    event_date date,
    due_date date,
    amount numeric(14,2),
    principal_balance numeric(14,2),
    interest_balance numeric(14,2),
    total_balance numeric(14,2),
    days_past_due integer,
    source_row_sha256 text NOT NULL,
    source_data jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT bhph_account_events_source_data_check CHECK ((jsonb_typeof(source_data) = 'object'::text))
);


ALTER TABLE ask865.bhph_account_events OWNER TO postgres;

--
-- Name: bhph_account_events_id_seq; Type: SEQUENCE; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.bhph_account_events ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ask865.bhph_account_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: data_quality_issues; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.data_quality_issues (
    id bigint NOT NULL,
    import_run_id bigint,
    row_number integer,
    severity text NOT NULL,
    issue_code text NOT NULL,
    field_name text,
    issue_message text NOT NULL,
    observed_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_quality_issues_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'error'::text])))
);


ALTER TABLE ask865.data_quality_issues OWNER TO postgres;

--
-- Name: data_quality_issues_id_seq; Type: SEQUENCE; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.data_quality_issues ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ask865.data_quality_issues_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: import_audits; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.import_audits (
    import_run_id bigint NOT NULL,
    completed_at timestamp with time zone NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    stored_rows integer NOT NULL,
    normalized_rows integer,
    problems text[] NOT NULL
);


ALTER TABLE ask865.import_audits OWNER TO postgres;

--
-- Name: import_runs; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.import_runs (
    id bigint NOT NULL,
    report_key text NOT NULL,
    source_system text DEFAULT 'dealercenter'::text NOT NULL,
    source_filename text NOT NULL,
    source_message_id text,
    file_sha256 text NOT NULL,
    source_received_at timestamp with time zone,
    snapshot_at timestamp with time zone DEFAULT now() NOT NULL,
    report_period_start date,
    report_period_end date,
    status text DEFAULT 'staged'::text NOT NULL,
    header_names text[] DEFAULT '{}'::text[] NOT NULL,
    source_row_count integer DEFAULT 0 NOT NULL,
    loaded_row_count integer DEFAULT 0 NOT NULL,
    rejected_row_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_summary text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT import_runs_file_sha256_check CHECK ((file_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT import_runs_loaded_row_count_check CHECK ((loaded_row_count >= 0)),
    CONSTRAINT import_runs_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT import_runs_rejected_row_count_check CHECK ((rejected_row_count >= 0)),
    CONSTRAINT import_runs_source_row_count_check CHECK ((source_row_count >= 0)),
    CONSTRAINT import_runs_source_system_check CHECK ((source_system = 'dealercenter'::text)),
    CONSTRAINT import_runs_status_check CHECK ((status = ANY (ARRAY['staged'::text, 'loading'::text, 'loaded'::text, 'loaded_with_warnings'::text, 'failed'::text, 'rejected'::text]))),
    CONSTRAINT import_runs_warning_count_check CHECK ((warning_count >= 0))
);


ALTER TABLE ask865.import_runs OWNER TO postgres;

--
-- Name: import_runs_id_seq; Type: SEQUENCE; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.import_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ask865.import_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: inventory_cost_snapshots; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.inventory_cost_snapshots (
    import_run_id bigint NOT NULL,
    stock_no text NOT NULL,
    vin text,
    snapshot_at timestamp with time zone NOT NULL,
    status text,
    date_in_stock date,
    days_in_inventory integer,
    vehicle_cost numeric(14,2),
    purchase_amount numeric(14,2),
    buyers_fee numeric(14,2),
    additional_cost numeric(14,2),
    total_adds numeric(14,2),
    total_packs numeric(14,2),
    total_write_down numeric(14,2),
    actual_flooring_cost numeric(14,2),
    estimated_flooring_cost numeric(14,2),
    total_cost_with_estimated_flooring numeric(14,2),
    total_cost numeric(14,2),
    potential_gross numeric(14,2),
    front_gross numeric(14,2),
    back_gross numeric(14,2),
    total_gross numeric(14,2),
    net_gross numeric(14,2),
    net_profit numeric(14,2),
    vehicle_purchase_source text,
    purchased_from text,
    purchased_from_vendor_id text,
    purchase_reference_number text,
    purchase_info_details text,
    purchase_info_memo text,
    source_row_number integer NOT NULL,
    source_row_sha256 text NOT NULL,
    source_data jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_cost_snapshots_source_data_check CHECK ((jsonb_typeof(source_data) = 'object'::text))
);


ALTER TABLE ask865.inventory_cost_snapshots OWNER TO postgres;

--
-- Name: inventory_price_history; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.inventory_price_history (
    import_run_id bigint NOT NULL,
    stock_no text NOT NULL,
    vin text,
    snapshot_at timestamp with time zone NOT NULL,
    vehicle_description text,
    days_in_stock integer,
    asking_price numeric(14,2),
    advertising_price numeric(14,2),
    special_price numeric(14,2),
    vehicle_price numeric(14,2),
    reprice_values jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_row_number integer NOT NULL,
    source_row_sha256 text NOT NULL,
    source_data jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_price_history_reprice_values_check CHECK ((jsonb_typeof(reprice_values) = 'array'::text)),
    CONSTRAINT inventory_price_history_source_data_check CHECK ((jsonb_typeof(source_data) = 'object'::text))
);


ALTER TABLE ask865.inventory_price_history OWNER TO postgres;

--
-- Name: inventory_snapshots; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.inventory_snapshots (
    import_run_id bigint NOT NULL,
    stock_no text NOT NULL,
    vin text,
    snapshot_at timestamp with time zone NOT NULL,
    created_date date,
    date_in_stock date,
    status text,
    custom_status text,
    vehicle_year integer,
    vehicle_make text,
    vehicle_model text,
    vehicle_trim text,
    odometer integer,
    exterior_color text,
    interior_color text,
    asking_price numeric(14,2),
    advertising_price numeric(14,2),
    special_price numeric(14,2),
    vehicle_price numeric(14,2),
    sale_price numeric(14,2),
    days_in_inventory integer,
    days_in_stock integer,
    location text,
    vehicle_sale_type text,
    vehicle_purchase_type text,
    vehicle_purchase_source text,
    purchased_from text,
    purchase_date date,
    title_status text,
    inspection_status text,
    days_in_recon integer,
    photo_count integer,
    has_photo boolean,
    is_featured_on_website boolean,
    third_party_sites text,
    purchase_amount numeric(14,2),
    buyers_fee numeric(14,2),
    vehicle_cost numeric(14,2),
    additional_cost numeric(14,2),
    total_adds numeric(14,2),
    total_packs numeric(14,2),
    actual_flooring_cost numeric(14,2),
    estimated_flooring_cost numeric(14,2),
    amount_floored numeric(14,2),
    total_cost_with_estimated_flooring numeric(14,2),
    total_cost numeric(14,2),
    is_floored boolean,
    flooring_company text,
    flooring_rate numeric(9,5),
    flooring_fee numeric(14,2),
    date_floored date,
    days_floored integer,
    date_flooring_paid_off date,
    floor_price numeric(14,2),
    potential_gross numeric(14,2),
    wholesale_price numeric(14,2),
    msrp numeric(14,2),
    manheim_adjusted_mmr numeric(14,2),
    jd_power_retail numeric(14,2),
    jd_power_trade numeric(14,2),
    jd_power_loan numeric(14,2),
    kelley_typical_listing numeric(14,2),
    black_book_retail_avg numeric(14,2),
    black_book_wholesale_avg numeric(14,2),
    purchase_reference_number text,
    purchase_info_details text,
    purchase_info_memo text,
    import_source text,
    dealercenter_updated_at timestamp with time zone,
    source_row_number integer NOT NULL,
    source_row_sha256 text NOT NULL,
    source_data jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_snapshots_source_data_check CHECK ((jsonb_typeof(source_data) = 'object'::text))
);


ALTER TABLE ask865.inventory_snapshots OWNER TO postgres;

--
-- Name: report_definitions; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.report_definitions (
    report_key text NOT NULL,
    canonical_name text NOT NULL,
    dealercenter_report_name text NOT NULL,
    source_file_pattern text NOT NULL,
    report_domain text NOT NULL,
    expected_header_count integer NOT NULL,
    is_authoritative_snapshot boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    parser_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_definitions_canonical_name_check CHECK ((canonical_name ~~ 'Ask 865 - %'::text)),
    CONSTRAINT report_definitions_expected_header_count_check CHECK ((expected_header_count > 0)),
    CONSTRAINT report_definitions_report_domain_check CHECK ((report_domain = ANY (ARRAY['sales'::text, 'inventory'::text, 'cost'::text, 'pricing'::text, 'lender'::text, 'bhph'::text, 'post_sale'::text, 'title'::text, 'exception'::text]))),
    CONSTRAINT report_definitions_report_key_check CHECK ((report_key ~ '^ask865_[a-z0-9_]+$'::text))
);


ALTER TABLE ask865.report_definitions OWNER TO postgres;

--
-- Name: report_rows; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.report_rows (
    import_run_id bigint NOT NULL,
    row_number integer NOT NULL,
    report_key text NOT NULL,
    deal_no text,
    deal_identifier text,
    account_id text,
    account_number text,
    stock_no text,
    vin text,
    lender_name text,
    record_date date,
    row_sha256 text NOT NULL,
    data jsonb NOT NULL,
    raw_fields text[] DEFAULT '{}'::text[] NOT NULL,
    parser_warnings text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT report_rows_data_check CHECK ((jsonb_typeof(data) = 'object'::text)),
    CONSTRAINT report_rows_row_number_check CHECK ((row_number > 0)),
    CONSTRAINT report_rows_row_sha256_check CHECK ((row_sha256 ~ '^[0-9a-f]{64}$'::text))
);


ALTER TABLE ask865.report_rows OWNER TO postgres;

--
-- Name: TABLE report_rows; Type: COMMENT; Schema: ask865; Owner: postgres
--

COMMENT ON TABLE ask865.report_rows IS 'Lossless normalized DealerCenter rows; JSONB preserves every source field for future use.';


--
-- Name: shopware_closed_sales; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.shopware_closed_sales (
    shop_id bigint NOT NULL,
    ro_id bigint NOT NULL,
    ro_number text NOT NULL,
    source_import_id bigint NOT NULL,
    source_row_number integer NOT NULL,
    raw_row jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    closed_at timestamp with time zone NOT NULL,
    payment_status text NOT NULL,
    advisor text,
    label text,
    vehicle_id text,
    vehicle_vin text,
    vehicle_year text,
    vehicle_make text,
    vehicle_model text,
    labor_total numeric(16,2) NOT NULL,
    labor_discount numeric(16,2) NOT NULL,
    labor_net numeric(16,2) NOT NULL,
    parts_total numeric(16,2) NOT NULL,
    parts_cost numeric(16,2) NOT NULL,
    tires_total numeric(16,2) NOT NULL,
    tires_cost numeric(16,2) NOT NULL,
    parts_discount numeric(16,2) NOT NULL,
    parts_and_tires_net numeric(16,2) NOT NULL,
    hazmat_total numeric(16,2) NOT NULL,
    sublets_total numeric(16,2) NOT NULL,
    sublet_cost numeric(16,2) NOT NULL,
    shop_supplies numeric(16,2) NOT NULL,
    subtotal numeric(16,2) NOT NULL,
    tax_total numeric(16,2) NOT NULL,
    total_with_tax numeric(16,2) NOT NULL,
    technician_hours jsonb NOT NULL,
    customer_id text GENERATED ALWAYS AS (NULLIF(btrim((raw_row ->> 'Customer ID'::text)), ''::text)) STORED,
    billing_group text GENERATED ALWAYS AS (
CASE
    WHEN (btrim((raw_row ->> 'Customer ID'::text)) = '29495512'::text) THEN '865 Autos'::text
    WHEN (NULLIF(btrim((raw_row ->> 'Customer ID'::text)), ''::text) IS NULL) THEN 'Unclassified'::text
    ELSE 'Other customers'::text
END) STORED,
    CONSTRAINT shopware_closed_sales_check CHECK ((closed_at >= started_at)),
    CONSTRAINT shopware_closed_sales_check1 CHECK (((subtotal + tax_total) = total_with_tax)),
    CONSTRAINT shopware_closed_sales_check2 CHECK (((labor_total - labor_discount) = labor_net)),
    CONSTRAINT shopware_closed_sales_check3 CHECK ((((parts_total + tires_total) - parts_discount) = parts_and_tires_net)),
    CONSTRAINT shopware_closed_sales_check4 CHECK ((((((labor_net + parts_and_tires_net) + hazmat_total) + sublets_total) + shop_supplies) = subtotal)),
    CONSTRAINT shopware_closed_sales_payment_status_check CHECK ((payment_status = ANY (ARRAY['paid'::text, 'unpaid'::text, 'partial'::text, 'credit'::text]))),
    CONSTRAINT shopware_closed_sales_shop_id_check CHECK ((shop_id = 7070)),
    CONSTRAINT shopware_closed_sales_source_row_number_check CHECK ((source_row_number > 0))
);


ALTER TABLE ask865.shopware_closed_sales OWNER TO postgres;

--
-- Name: COLUMN shopware_closed_sales.billing_group; Type: COMMENT; Schema: ask865; Owner: postgres
--

COMMENT ON COLUMN ask865.shopware_closed_sales.billing_group IS 'Billed customer only: Shop-Ware shop 7070 customer 29495512 is 865 Autos. Missing IDs are Unclassified. Independent of payment status and job label.';


--
-- Name: shopware_import_runs; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.shopware_import_runs (
    id bigint NOT NULL,
    file_sha256 text NOT NULL,
    source_filename text NOT NULL,
    source_file bytea NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    shop_id bigint NOT NULL,
    report_from date NOT NULL,
    report_through date NOT NULL,
    source_rows integer NOT NULL,
    source_subtotal numeric(16,2) NOT NULL,
    source_tax numeric(16,2) NOT NULL,
    source_total numeric(16,2) NOT NULL,
    validation jsonb NOT NULL,
    CONSTRAINT shopware_import_runs_check CHECK ((report_through >= report_from)),
    CONSTRAINT shopware_import_runs_check1 CHECK (((source_subtotal + source_tax) = source_total)),
    CONSTRAINT shopware_import_runs_file_sha256_check CHECK ((file_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT shopware_import_runs_shop_id_check CHECK ((shop_id = 7070)),
    CONSTRAINT shopware_import_runs_source_rows_check CHECK ((source_rows > 0))
);


ALTER TABLE ask865.shopware_import_runs OWNER TO postgres;

--
-- Name: shopware_import_runs_id_seq; Type: SEQUENCE; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.shopware_import_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME ask865.shopware_import_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sold_deal_sensitive; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.sold_deal_sensitive (
    deal_no text NOT NULL,
    signer_first_name text,
    signer_last_name text,
    signer_email text,
    signer_cell_phone text,
    customer_type_id text,
    credit_score smallint,
    credit_score_type text,
    source_import_run_id bigint NOT NULL,
    source_row_number integer NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sold_deal_sensitive_credit_score_check CHECK (((credit_score IS NULL) OR ((credit_score >= 300) AND (credit_score <= 900))))
);


ALTER TABLE ask865.sold_deal_sensitive OWNER TO postgres;

--
-- Name: TABLE sold_deal_sensitive; Type: COMMENT; Schema: ask865; Owner: postgres
--

COMMENT ON TABLE ask865.sold_deal_sensitive IS 'Restricted DealerCenter customer contact and exact credit-score data.';


--
-- Name: sold_deals; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.sold_deals (
    deal_no text NOT NULL,
    deal_identifier text,
    application_no text,
    ros_number text,
    deal_status text,
    deal_date date,
    delivery_date date,
    funded_date date,
    deal_type text,
    finance_type text,
    salesperson1_name text,
    salesperson2_name text,
    salesperson1_id text,
    salesperson2_id text,
    sales_manager_name text,
    finance_manager_name text,
    sales_manager_id text,
    finance_manager_id text,
    stock_no text,
    vin text,
    vehicle_year integer,
    vehicle_make text,
    vehicle_model text,
    vehicle_trim text,
    lender_name text,
    purchase_price numeric(14,2),
    vehicle_price numeric(14,2),
    vehicle_asking_price numeric(14,2),
    advertising_price numeric(14,2),
    vehicle_cost numeric(14,2),
    vehicle_total_cost_adds numeric(14,2),
    vehicle_total_packs numeric(14,2),
    pack_cost numeric(14,2),
    total_vehicle_cost numeric(14,2),
    front_gross numeric(14,2),
    back_gross numeric(14,2),
    total_gross numeric(14,2),
    net_gross numeric(14,2),
    net_profit numeric(14,2),
    total_commissions numeric(14,2),
    gross_adjustment numeric(14,2),
    deal_source text,
    lead_source text,
    days_in_stock integer,
    vehicle_purchase_source text,
    purchased_from text,
    purchased_from_vendor_id text,
    acquisition_fee numeric(14,2),
    contract_apr numeric(9,5),
    buy_rate numeric(9,5),
    term_months integer,
    monthly_payment numeric(14,2),
    financed_amount numeric(14,2),
    cash_down numeric(14,2),
    cash_down_collected numeric(14,2),
    cash_down_balance numeric(14,2),
    reserve_amount numeric(14,2),
    lender_fees numeric(14,2),
    net_check numeric(14,2),
    total_tax numeric(14,2),
    doc_fee numeric(14,2),
    service_contract_name text,
    service_contract_cost numeric(14,2),
    service_contract_price numeric(14,2),
    service_contract_gross numeric(14,2),
    gap_name text,
    gap_cost numeric(14,2),
    gap_price numeric(14,2),
    gap_gross numeric(14,2),
    additional_products_cost numeric(14,2),
    additional_products_price numeric(14,2),
    additional_products_gross numeric(14,2),
    trade1_vin text,
    trade1_stock_no text,
    trade1_acv numeric(14,2),
    trade1_allowance numeric(14,2),
    trade1_payoff numeric(14,2),
    trade2_vin text,
    trade2_stock_no text,
    trade2_acv numeric(14,2),
    trade2_allowance numeric(14,2),
    trade2_payoff numeric(14,2),
    net_trade_in numeric(14,2),
    total_deal_costs numeric(14,2),
    total_deal_fees numeric(14,2),
    total_fees numeric(14,2),
    total_official_fees numeric(14,2),
    finance_charge numeric(14,2),
    flat_reserve numeric(14,2),
    dealer_discount_rate numeric(9,5),
    discount numeric(14,2),
    econtract_status text,
    funding_check_received text,
    stips_status text,
    dealercenter_created_at timestamp with time zone,
    dealercenter_created_by text,
    dealercenter_updated_at timestamp with time zone,
    dealercenter_updated_by text,
    deal_age integer,
    days_since_sold integer,
    source_import_run_id bigint NOT NULL,
    source_row_number integer NOT NULL,
    source_row_sha256 text NOT NULL,
    source_data jsonb NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    is_in_latest_export boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sold_deals_source_data_check CHECK ((jsonb_typeof(source_data) = 'object'::text))
);


ALTER TABLE ask865.sold_deals OWNER TO postgres;

--
-- Name: source_issue_register; Type: TABLE; Schema: ask865; Owner: postgres
--

CREATE TABLE ask865.source_issue_register (
    report_key text NOT NULL,
    issue_code text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    affected_rows integer NOT NULL,
    source_row_numbers integer[] DEFAULT '{}'::integer[] NOT NULL,
    owner_name text DEFAULT ''::text NOT NULL,
    review_status text DEFAULT 'open'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    updated_by text,
    updated_at timestamp with time zone,
    CONSTRAINT source_issue_register_review_status_check CHECK ((review_status = ANY (ARRAY['open'::text, 'in_review'::text])))
);


ALTER TABLE ask865.source_issue_register OWNER TO postgres;

--
-- Name: v_current_inventory; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_current_inventory WITH (security_barrier='true') AS
 SELECT import_run_id,
    stock_no,
    vin,
    snapshot_at,
    created_date,
    date_in_stock,
    status,
    custom_status,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vehicle_trim,
    odometer,
    exterior_color,
    interior_color,
    asking_price,
    advertising_price,
    special_price,
    vehicle_price,
    sale_price,
    days_in_inventory,
    days_in_stock,
    location,
    vehicle_sale_type,
    vehicle_purchase_type,
    vehicle_purchase_source,
    purchased_from,
    purchase_date,
    title_status,
    inspection_status,
    days_in_recon,
    photo_count,
    has_photo,
    is_featured_on_website,
    third_party_sites,
    purchase_amount,
    buyers_fee,
    vehicle_cost,
    additional_cost,
    total_adds,
    total_packs,
    actual_flooring_cost,
    estimated_flooring_cost,
    amount_floored,
    total_cost_with_estimated_flooring,
    total_cost,
    is_floored,
    flooring_company,
    flooring_rate,
    flooring_fee,
    date_floored,
    days_floored,
    date_flooring_paid_off,
    floor_price,
    potential_gross,
    wholesale_price,
    msrp,
    manheim_adjusted_mmr,
    jd_power_retail,
    jd_power_trade,
    jd_power_loan,
    kelley_typical_listing,
    black_book_retail_avg,
    black_book_wholesale_avg,
    purchase_reference_number,
    purchase_info_details,
    purchase_info_memo,
    import_source,
    dealercenter_updated_at,
    source_row_number,
    source_row_sha256,
    source_data,
    ingested_at
   FROM ask865.inventory_snapshots i
  WHERE (import_run_id = ( SELECT max(r.id) AS max
           FROM ask865.import_runs r
          WHERE ((r.report_key = 'ask865_current_inventory'::text) AND (r.status = ANY (ARRAY['loaded'::text, 'loaded_with_warnings'::text])))));


ALTER VIEW ask865.v_current_inventory OWNER TO ask865_view_owner;

--
-- Name: v_current_inventory_cost; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_current_inventory_cost WITH (security_barrier='true') AS
 SELECT import_run_id,
    stock_no,
    vin,
    snapshot_at,
    status,
    date_in_stock,
    days_in_inventory,
    vehicle_cost,
    purchase_amount,
    buyers_fee,
    additional_cost,
    total_adds,
    total_packs,
    total_write_down,
    actual_flooring_cost,
    estimated_flooring_cost,
    total_cost_with_estimated_flooring,
    total_cost,
    potential_gross,
    front_gross,
    back_gross,
    total_gross,
    net_gross,
    net_profit,
    vehicle_purchase_source,
    purchased_from,
    purchased_from_vendor_id,
    purchase_reference_number,
    purchase_info_details,
    purchase_info_memo,
    source_row_number,
    source_row_sha256,
    source_data,
    ingested_at
   FROM ask865.inventory_cost_snapshots i
  WHERE (import_run_id = ( SELECT max(r.id) AS max
           FROM ask865.import_runs r
          WHERE ((r.report_key = 'ask865_inventory_cost_detail'::text) AND (r.status = ANY (ARRAY['loaded'::text, 'loaded_with_warnings'::text])))));


ALTER VIEW ask865.v_current_inventory_cost OWNER TO ask865_view_owner;

--
-- Name: v_dashboard_inventory; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_dashboard_inventory WITH (security_barrier='true') AS
 SELECT i.stock_no,
    i.vin,
    i.vehicle_year,
    i.vehicle_make,
    i.vehicle_model,
    i.vehicle_trim,
    i.status,
    i.custom_status,
    i.purchase_date,
    i.date_in_stock,
    i.days_in_inventory,
        CASE
            WHEN (i.date_in_stock IS NULL) THEN NULL::integer
            ELSE (CURRENT_DATE - i.date_in_stock)
        END AS days_available_for_sale,
        CASE
            WHEN ((i.purchase_date IS NULL) OR (i.date_in_stock IS NULL)) THEN NULL::integer
            ELSE (i.date_in_stock - i.purchase_date)
        END AS days_from_purchase_to_sale_ready,
        CASE
            WHEN (i.days_in_inventory IS NULL) THEN 'Unknown'::text
            WHEN (i.days_in_inventory < 30) THEN '0-29 days'::text
            WHEN (i.days_in_inventory < 60) THEN '30-59 days'::text
            WHEN (i.days_in_inventory < 90) THEN '60-89 days'::text
            WHEN (i.days_in_inventory < 120) THEN '90-119 days'::text
            ELSE '120+ days'::text
        END AS aging_bucket,
        CASE
            WHEN (i.days_in_inventory IS NULL) THEN 99
            WHEN (i.days_in_inventory < 30) THEN 1
            WHEN (i.days_in_inventory < 60) THEN 2
            WHEN (i.days_in_inventory < 90) THEN 3
            WHEN (i.days_in_inventory < 120) THEN 4
            ELSE 5
        END AS aging_sort,
    i.asking_price,
    i.advertising_price,
    i.vehicle_price,
    i.vehicle_cost,
    COALESCE(c.total_adds, i.total_adds) AS total_adds,
    COALESCE(c.total_packs, i.total_packs) AS total_packs,
    COALESCE(c.actual_flooring_cost, i.actual_flooring_cost) AS actual_flooring_cost,
    COALESCE(c.total_cost, i.total_cost) AS total_cost,
    COALESCE(c.potential_gross, i.potential_gross) AS potential_gross,
    i.vehicle_purchase_source,
    i.purchased_from,
    i.title_status,
    i.inspection_status,
    i.days_in_recon,
    i.is_floored,
    i.flooring_company,
    i.amount_floored,
    i.photo_count,
    i.has_photo,
    i.snapshot_at
   FROM (ask865.v_current_inventory i
     LEFT JOIN ask865.v_current_inventory_cost c USING (stock_no));


ALTER VIEW ask865.v_dashboard_inventory OWNER TO ask865_view_owner;

--
-- Name: VIEW v_dashboard_inventory; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_dashboard_inventory IS 'Ask 865 current inventory joined to current cost detail; days in inventory measures ownership since purchase, while days available for sale measures time since date in stock.';


--
-- Name: v_sold_deals_bi_all; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_sold_deals_bi_all WITH (security_barrier='true') AS
 SELECT d.deal_no,
    d.deal_identifier,
    d.application_no,
    d.ros_number,
    d.deal_status,
    d.deal_date,
    d.delivery_date,
    d.funded_date,
    d.deal_type,
    d.finance_type,
    d.salesperson1_name,
    d.salesperson2_name,
    d.salesperson1_id,
    d.salesperson2_id,
    d.sales_manager_name,
    d.finance_manager_name,
    d.stock_no,
    d.vin,
    d.vehicle_year,
    d.vehicle_make,
    d.vehicle_model,
    d.vehicle_trim,
    d.lender_name,
    s.credit_score,
    s.credit_score_type,
        CASE
            WHEN (s.credit_score IS NULL) THEN NULL::text
            WHEN (s.credit_score >= 750) THEN '750+'::text
            WHEN (s.credit_score >= 700) THEN '700-749'::text
            WHEN (s.credit_score >= 650) THEN '650-699'::text
            WHEN (s.credit_score >= 600) THEN '600-649'::text
            WHEN (s.credit_score >= 550) THEN '550-599'::text
            ELSE 'Below 550'::text
        END AS credit_score_band,
    d.purchase_price,
    d.vehicle_price,
    d.vehicle_asking_price,
    d.advertising_price,
    d.vehicle_cost,
    d.vehicle_total_cost_adds,
    d.vehicle_total_packs,
    d.pack_cost,
    d.total_vehicle_cost,
    d.front_gross,
    d.back_gross,
    d.total_gross,
    d.net_gross,
    d.net_profit,
    d.total_commissions,
    d.gross_adjustment,
    d.deal_source,
    d.lead_source,
    d.days_in_stock,
    d.vehicle_purchase_source,
    d.purchased_from,
    d.acquisition_fee,
    d.contract_apr,
    d.buy_rate,
    d.term_months,
    d.monthly_payment,
    d.financed_amount,
    d.cash_down,
    d.cash_down_collected,
    d.cash_down_balance,
    d.reserve_amount,
    d.lender_fees,
    d.net_check,
    d.total_tax,
    d.doc_fee,
    d.service_contract_name,
    d.service_contract_cost,
    d.service_contract_price,
    d.service_contract_gross,
    d.gap_name,
    d.gap_cost,
    d.gap_price,
    d.gap_gross,
    d.additional_products_cost,
    d.additional_products_price,
    d.additional_products_gross,
    d.trade1_vin,
    d.trade1_stock_no,
    d.trade1_acv,
    d.trade1_allowance,
    d.trade1_payoff,
    d.trade2_vin,
    d.trade2_stock_no,
    d.trade2_acv,
    d.trade2_allowance,
    d.trade2_payoff,
    d.net_trade_in,
    d.total_deal_costs,
    d.total_deal_fees,
    d.total_fees,
    d.total_official_fees,
    d.finance_charge,
    d.flat_reserve,
    d.dealer_discount_rate,
    d.discount,
    d.econtract_status,
    d.funding_check_received,
    d.stips_status,
    d.dealercenter_created_at,
    d.dealercenter_updated_at,
    d.deal_age,
    d.days_since_sold,
    d.ingested_at
   FROM (ask865.sold_deals d
     LEFT JOIN ask865.sold_deal_sensitive s USING (deal_no));


ALTER VIEW ask865.v_sold_deals_bi_all OWNER TO ask865_view_owner;

--
-- Name: VIEW v_sold_deals_bi_all; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_sold_deals_bi_all IS 'Internal historical deal versions, including deals no longer present in the newest authoritative export.';


--
-- Name: v_sold_deals_bi; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_sold_deals_bi WITH (security_barrier='true') AS
 SELECT v.deal_no,
    v.deal_identifier,
    v.application_no,
    v.ros_number,
    v.deal_status,
    v.deal_date,
    v.delivery_date,
    v.funded_date,
    v.deal_type,
    v.finance_type,
    v.salesperson1_name,
    v.salesperson2_name,
    v.salesperson1_id,
    v.salesperson2_id,
    v.sales_manager_name,
    v.finance_manager_name,
    v.stock_no,
    v.vin,
    v.vehicle_year,
    v.vehicle_make,
    v.vehicle_model,
    v.vehicle_trim,
    v.lender_name,
    v.credit_score,
    v.credit_score_type,
    v.credit_score_band,
    v.purchase_price,
    v.vehicle_price,
    v.vehicle_asking_price,
    v.advertising_price,
    v.vehicle_cost,
    v.vehicle_total_cost_adds,
    v.vehicle_total_packs,
    v.pack_cost,
    v.total_vehicle_cost,
    v.front_gross,
    v.back_gross,
    v.total_gross,
    v.net_gross,
    v.net_profit,
    v.total_commissions,
    v.gross_adjustment,
    v.deal_source,
    v.lead_source,
    v.days_in_stock,
    v.vehicle_purchase_source,
    v.purchased_from,
    v.acquisition_fee,
    v.contract_apr,
    v.buy_rate,
    v.term_months,
    v.monthly_payment,
    v.financed_amount,
    v.cash_down,
    v.cash_down_collected,
    v.cash_down_balance,
    v.reserve_amount,
    v.lender_fees,
    v.net_check,
    v.total_tax,
    v.doc_fee,
    v.service_contract_name,
    v.service_contract_cost,
    v.service_contract_price,
    v.service_contract_gross,
    v.gap_name,
    v.gap_cost,
    v.gap_price,
    v.gap_gross,
    v.additional_products_cost,
    v.additional_products_price,
    v.additional_products_gross,
    v.trade1_vin,
    v.trade1_stock_no,
    v.trade1_acv,
    v.trade1_allowance,
    v.trade1_payoff,
    v.trade2_vin,
    v.trade2_stock_no,
    v.trade2_acv,
    v.trade2_allowance,
    v.trade2_payoff,
    v.net_trade_in,
    v.total_deal_costs,
    v.total_deal_fees,
    v.total_fees,
    v.total_official_fees,
    v.finance_charge,
    v.flat_reserve,
    v.dealer_discount_rate,
    v.discount,
    v.econtract_status,
    v.funding_check_received,
    v.stips_status,
    v.dealercenter_created_at,
    v.dealercenter_updated_at,
    v.deal_age,
    v.days_since_sold,
    v.ingested_at,
    d.last_seen_at
   FROM (ask865.v_sold_deals_bi_all v
     JOIN ask865.sold_deals d USING (deal_no))
  WHERE d.is_in_latest_export;


ALTER VIEW ask865.v_sold_deals_bi OWNER TO ask865_view_owner;

--
-- Name: VIEW v_sold_deals_bi; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_sold_deals_bi IS 'Current full-history sold-deal export for BI; lender and credit score included, customer contact excluded.';


--
-- Name: v_dashboard_attention_items; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_dashboard_attention_items WITH (security_barrier='true') AS
 WITH latest_bhph_runs AS (
         SELECT DISTINCT ON (r.report_key) r.id
           FROM (ask865.import_runs r
             JOIN ask865.report_definitions d USING (report_key))
          WHERE ((d.report_domain = 'bhph'::text) AND d.is_active AND (r.status = ANY (ARRAY['loaded'::text, 'loaded_with_warnings'::text])))
          ORDER BY r.report_key, r.snapshot_at DESC, r.id DESC
        )
 SELECT 1 AS priority_rank,
    'High'::text AS priority,
    'Future BHPH event date'::text AS category,
    'Deal'::text AS entity_type,
    COALESCE(e.deal_no, e.account_number, e.account_id, (e.id)::text) AS entity_id,
    e.event_date,
    e.total_balance AS amount,
    concat('DealerCenter ', replace(e.event_type, '_'::text, ' '::text), ' is dated ', e.event_date) AS summary,
    concat_ws(' · '::text, NULLIF(e.account_status, ''::text), NULLIF(e.stock_no, ''::text), NULLIF(e.lender_name, ''::text)) AS detail
   FROM ask865.bhph_account_events e
  WHERE ((e.import_run_id IN ( SELECT latest_bhph_runs.id
           FROM latest_bhph_runs)) AND (e.event_date > (CURRENT_DATE + '1 year'::interval)))
UNION ALL
 SELECT
        CASE
            WHEN ((v_sold_deals_bi.deal_date - v_sold_deals_bi.funded_date) > 30) THEN 1
            ELSE 2
        END AS priority_rank,
        CASE
            WHEN ((v_sold_deals_bi.deal_date - v_sold_deals_bi.funded_date) > 30) THEN 'High'::text
            ELSE 'Medium'::text
        END AS priority,
    'Funded before deal date'::text AS category,
    'Deal'::text AS entity_type,
    v_sold_deals_bi.deal_no AS entity_id,
    v_sold_deals_bi.deal_date AS event_date,
    v_sold_deals_bi.total_gross AS amount,
    concat('Funded ', v_sold_deals_bi.funded_date, ' before deal date ', v_sold_deals_bi.deal_date) AS summary,
    concat_ws(' · '::text, NULLIF(v_sold_deals_bi.stock_no, ''::text), NULLIF(v_sold_deals_bi.lender_name, ''::text), concat_ws(' '::text, (v_sold_deals_bi.vehicle_year)::text, v_sold_deals_bi.vehicle_make, v_sold_deals_bi.vehicle_model)) AS detail
   FROM ask865.v_sold_deals_bi
  WHERE ((v_sold_deals_bi.funded_date IS NOT NULL) AND (v_sold_deals_bi.deal_date IS NOT NULL) AND (v_sold_deals_bi.funded_date < v_sold_deals_bi.deal_date))
UNION ALL
 SELECT 2 AS priority_rank,
    'Medium'::text AS priority,
    'Inventory aged 120+ days'::text AS category,
    'Stock'::text AS entity_type,
    v_dashboard_inventory.stock_no AS entity_id,
    v_dashboard_inventory.date_in_stock AS event_date,
    v_dashboard_inventory.total_cost AS amount,
    concat_ws(' '::text, (v_dashboard_inventory.vehicle_year)::text, v_dashboard_inventory.vehicle_make, v_dashboard_inventory.vehicle_model, v_dashboard_inventory.vehicle_trim) AS summary,
    concat(v_dashboard_inventory.days_in_inventory, ' days · ', COALESCE(v_dashboard_inventory.status, 'Unknown status'::text)) AS detail
   FROM ask865.v_dashboard_inventory
  WHERE (v_dashboard_inventory.days_in_inventory >= 120)
UNION ALL
 SELECT 2 AS priority_rank,
    'Medium'::text AS priority,
    'Finance deal missing lender'::text AS category,
    'Deal'::text AS entity_type,
    v_sold_deals_bi.deal_no AS entity_id,
    v_sold_deals_bi.deal_date AS event_date,
    v_sold_deals_bi.financed_amount AS amount,
    concat_ws(' '::text, (v_sold_deals_bi.vehicle_year)::text, v_sold_deals_bi.vehicle_make, v_sold_deals_bi.vehicle_model, v_sold_deals_bi.vehicle_trim) AS summary,
    concat_ws(' · '::text, NULLIF(v_sold_deals_bi.stock_no, ''::text), NULLIF(v_sold_deals_bi.salesperson1_name, ''::text)) AS detail
   FROM ask865.v_sold_deals_bi
  WHERE ((v_sold_deals_bi.deal_type = 'FINANCE'::text) AND (v_sold_deals_bi.lender_name IS NULL));


ALTER VIEW ask865.v_dashboard_attention_items OWNER TO ask865_view_owner;

--
-- Name: VIEW v_dashboard_attention_items; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_dashboard_attention_items IS 'Actionable Ask 865 DealerCenter exceptions for the daily briefing and dashboard.';


--
-- Name: v_dashboard_bhph_summary; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_dashboard_bhph_summary WITH (security_barrier='true') AS
 WITH latest_bhph_runs AS (
         SELECT DISTINCT ON (r.report_key) r.id,
            r.report_key,
            r.snapshot_at
           FROM (ask865.import_runs r
             JOIN ask865.report_definitions d USING (report_key))
          WHERE (((d.report_domain = 'bhph'::text) OR (d.report_key = 'ask865_lender_buybacks'::text)) AND d.is_active AND (r.status = ANY (ARRAY['loaded'::text, 'loaded_with_warnings'::text])))
          ORDER BY r.report_key, r.snapshot_at DESC, r.id DESC
        )
 SELECT e.event_type,
    count(*) AS records,
    (COALESCE(sum(e.amount), (0)::numeric))::numeric(16,2) AS amount,
    (COALESCE(sum(e.total_balance), (0)::numeric))::numeric(16,2) AS balance,
    max(e.event_date) AS latest_event_date,
    max(l.snapshot_at) AS snapshot_at
   FROM (ask865.bhph_account_events e
     JOIN latest_bhph_runs l ON ((l.id = e.import_run_id)))
  GROUP BY e.event_type;


ALTER VIEW ask865.v_dashboard_bhph_summary OWNER TO ask865_view_owner;

--
-- Name: VIEW v_dashboard_bhph_summary; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_dashboard_bhph_summary IS 'Latest Ask 865 DealerCenter BHPH exception counts and balances by report type, aggregated for the private dashboard.';


--
-- Name: v_dashboard_import_health; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_dashboard_import_health WITH (security_barrier='true') AS
 WITH deadline AS (
         SELECT (((now() AT TIME ZONE 'America/New_York'::text))::date -
                CASE
                    WHEN (((now() AT TIME ZONE 'America/New_York'::text))::time without time zone < '03:00:00'::time without time zone) THEN 1
                    ELSE 0
                END) AS expected_date
        )
 SELECT d.report_key,
    d.canonical_name,
    d.report_domain,
    r.id AS import_run_id,
    r.source_received_at,
    r.completed_at,
    r.status AS import_status,
    r.source_row_count,
    r.loaded_row_count,
    r.rejected_row_count,
    r.warning_count,
    a.checked_at,
    a.stored_rows,
    a.normalized_rows,
    a.problems,
    deadline.expected_date,
        CASE
            WHEN (r.id IS NULL) THEN 'missing'::text
            WHEN (r.status = ANY (ARRAY['failed'::text, 'rejected'::text])) THEN 'failed'::text
            WHEN (r.status <> ALL (ARRAY['loaded'::text, 'loaded_with_warnings'::text])) THEN 'incomplete'::text
            WHEN ((r.source_received_at IS NULL) OR (((r.source_received_at AT TIME ZONE 'America/New_York'::text))::date < deadline.expected_date)) THEN 'stale'::text
            WHEN (r.source_received_at > (now() + '00:10:00'::interval)) THEN 'invalid_timestamp'::text
            WHEN (a.checked_at IS NULL) THEN 'unchecked'::text
            WHEN (cardinality(a.problems) > 0) THEN 'failed'::text
            WHEN (r.warning_count > 0) THEN 'warning'::text
            ELSE 'healthy'::text
        END AS health_status
   FROM (((ask865.report_definitions d
     CROSS JOIN deadline)
     LEFT JOIN LATERAL ( SELECT i.id,
            i.report_key,
            i.source_system,
            i.source_filename,
            i.source_message_id,
            i.file_sha256,
            i.source_received_at,
            i.snapshot_at,
            i.report_period_start,
            i.report_period_end,
            i.status,
            i.header_names,
            i.source_row_count,
            i.loaded_row_count,
            i.rejected_row_count,
            i.warning_count,
            i.started_at,
            i.completed_at,
            i.error_summary,
            i.metadata,
            i.created_at
           FROM ask865.import_runs i
          WHERE (i.report_key = d.report_key)
          ORDER BY i.snapshot_at DESC, i.id DESC
         LIMIT 1) r ON (true))
     LEFT JOIN ask865.import_audits a ON (((a.import_run_id = r.id) AND (a.completed_at = r.completed_at))))
  WHERE d.is_active;


ALTER VIEW ask865.v_dashboard_import_health OWNER TO ask865_view_owner;

--
-- Name: v_dashboard_lender_monthly; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_dashboard_lender_monthly WITH (security_barrier='true') AS
 SELECT (date_trunc('month'::text, (deal_date)::timestamp with time zone))::date AS month_start,
    COALESCE(NULLIF(TRIM(BOTH FROM lender_name), ''::text), '(Missing lender)'::text) AS lender_name,
    count(*) AS finance_deals,
    (COALESCE(sum(financed_amount), (0)::numeric))::numeric(14,2) AS amount_financed,
    (COALESCE(sum(back_gross), (0)::numeric))::numeric(14,2) AS back_gross,
    (COALESCE(sum(total_gross), (0)::numeric))::numeric(14,2) AS total_gross,
    (avg(credit_score))::numeric(10,2) AS average_credit_score,
    count(credit_score) AS deals_with_credit_score
   FROM ask865.v_sold_deals_bi
  WHERE ((deal_date IS NOT NULL) AND (deal_type = 'FINANCE'::text))
  GROUP BY ((date_trunc('month'::text, (deal_date)::timestamp with time zone))::date), COALESCE(NULLIF(TRIM(BOTH FROM lender_name), ''::text), '(Missing lender)'::text);


ALTER VIEW ask865.v_dashboard_lender_monthly OWNER TO ask865_view_owner;

--
-- Name: VIEW v_dashboard_lender_monthly; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_dashboard_lender_monthly IS 'Ask 865 monthly finance-deal lender mix, gross, amount financed, and credit-score coverage.';


--
-- Name: v_dashboard_sales_monthly; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_dashboard_sales_monthly WITH (security_barrier='true') AS
 SELECT (date_trunc('month'::text, (deal_date)::timestamp with time zone))::date AS month_start,
    count(*) AS units_sold,
    count(*) FILTER (WHERE (deal_type = 'FINANCE'::text)) AS finance_units,
    count(*) FILTER (WHERE (deal_type = 'CASH'::text)) AS cash_units,
    count(*) FILTER (WHERE (deal_type = 'BHPH'::text)) AS bhph_units,
    count(*) FILTER (WHERE (deal_type = 'WHOLESALE'::text)) AS wholesale_units,
    (COALESCE(sum(front_gross), (0)::numeric))::numeric(14,2) AS front_gross,
    (COALESCE(sum(back_gross), (0)::numeric))::numeric(14,2) AS back_gross,
    (COALESCE(sum(total_gross), (0)::numeric))::numeric(14,2) AS total_gross,
    (COALESCE(avg(total_gross), (0)::numeric))::numeric(14,2) AS average_total_gross,
    (COALESCE(sum(vehicle_price), (0)::numeric))::numeric(14,2) AS vehicle_sales,
    (COALESCE(sum(total_vehicle_cost), (0)::numeric))::numeric(14,2) AS total_vehicle_cost
   FROM ask865.v_sold_deals_bi
  WHERE (deal_date IS NOT NULL)
  GROUP BY ((date_trunc('month'::text, (deal_date)::timestamp with time zone))::date);


ALTER VIEW ask865.v_dashboard_sales_monthly OWNER TO ask865_view_owner;

--
-- Name: VIEW v_dashboard_sales_monthly; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_dashboard_sales_monthly IS 'Ask 865 monthly sales and gross metrics from the newest authoritative sold-deal export.';


--
-- Name: v_dashboard_salesperson_monthly; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_dashboard_salesperson_monthly WITH (security_barrier='true') AS
 SELECT (date_trunc('month'::text, (deal_date)::timestamp with time zone))::date AS month_start,
    COALESCE(NULLIF(TRIM(BOTH FROM salesperson1_name), ''::text), '(Unassigned)'::text) AS salesperson_name,
    count(*) AS units_sold,
    (COALESCE(sum(front_gross), (0)::numeric))::numeric(14,2) AS front_gross,
    (COALESCE(sum(back_gross), (0)::numeric))::numeric(14,2) AS back_gross,
    (COALESCE(sum(total_gross), (0)::numeric))::numeric(14,2) AS total_gross,
    (COALESCE(avg(total_gross), (0)::numeric))::numeric(14,2) AS average_total_gross
   FROM ask865.v_sold_deals_bi
  WHERE (deal_date IS NOT NULL)
  GROUP BY ((date_trunc('month'::text, (deal_date)::timestamp with time zone))::date), COALESCE(NULLIF(TRIM(BOTH FROM salesperson1_name), ''::text), '(Unassigned)'::text);


ALTER VIEW ask865.v_dashboard_salesperson_monthly OWNER TO ask865_view_owner;

--
-- Name: VIEW v_dashboard_salesperson_monthly; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_dashboard_salesperson_monthly IS 'Ask 865 monthly salesperson units and gross; missing salesperson values are labeled Unassigned.';


--
-- Name: v_data_freshness; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_data_freshness WITH (security_barrier='true') AS
 SELECT DISTINCT ON (r.report_key) r.report_key,
    d.canonical_name,
    r.snapshot_at,
    r.completed_at,
    r.status,
    r.source_row_count,
    r.loaded_row_count,
    r.rejected_row_count,
    r.warning_count,
    r.source_filename
   FROM (ask865.import_runs r
     JOIN ask865.report_definitions d USING (report_key))
  ORDER BY r.report_key, r.id DESC;


ALTER VIEW ask865.v_data_freshness OWNER TO ask865_view_owner;

--
-- Name: v_data_quality_summary; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_data_quality_summary WITH (security_barrier='true') AS
 SELECT r.report_key,
    d.canonical_name,
    q.severity,
    q.issue_code,
    count(*) AS affected_rows,
    max(q.created_at) AS last_observed_at
   FROM ((ask865.data_quality_issues q
     JOIN ask865.import_runs r ON ((r.id = q.import_run_id)))
     JOIN ask865.report_definitions d USING (report_key))
  GROUP BY r.report_key, d.canonical_name, q.severity, q.issue_code;


ALTER VIEW ask865.v_data_quality_summary OWNER TO ask865_view_owner;

--
-- Name: VIEW v_data_quality_summary; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_data_quality_summary IS 'Ask 865 source and ingestion issues grouped by report, severity, and rule.';


--
-- Name: v_latest_inventory_prices; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_latest_inventory_prices WITH (security_barrier='true') AS
 SELECT import_run_id,
    stock_no,
    vin,
    snapshot_at,
    vehicle_description,
    days_in_stock,
    asking_price,
    advertising_price,
    special_price,
    vehicle_price,
    reprice_values,
    source_row_number,
    source_row_sha256,
    source_data,
    ingested_at
   FROM ask865.inventory_price_history i
  WHERE (import_run_id = ( SELECT max(r.id) AS max
           FROM ask865.import_runs r
          WHERE ((r.report_key = 'ask865_price_log'::text) AND (r.status = ANY (ARRAY['loaded'::text, 'loaded_with_warnings'::text])))));


ALTER VIEW ask865.v_latest_inventory_prices OWNER TO ask865_view_owner;

--
-- Name: v_sales_daily; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_sales_daily WITH (security_barrier='true') AS
 SELECT deal_date,
    count(*) AS vehicles_sold,
    sum(front_gross) AS front_gross,
    sum(back_gross) AS back_gross,
    sum(total_gross) AS total_gross,
    sum(net_gross) AS net_gross,
    sum(net_profit) AS net_profit,
    avg(total_gross) AS average_total_gross
   FROM ask865.sold_deals
  WHERE (deal_date IS NOT NULL)
  GROUP BY deal_date;


ALTER VIEW ask865.v_sales_daily OWNER TO ask865_view_owner;

--
-- Name: v_shopware_sales_monthly; Type: VIEW; Schema: ask865; Owner: ask865_view_owner
--

CREATE VIEW ask865.v_shopware_sales_monthly WITH (security_barrier='true') AS
 SELECT (date_trunc('month'::text, (closed_at AT TIME ZONE 'America/New_York'::text)))::date AS month,
    count(*) AS closed_orders,
    sum(subtotal) AS sales_before_tax,
    sum(tax_total) AS tax,
    sum(total_with_tax) AS sales_with_tax,
    sum(labor_net) AS labor_after_discount,
    sum(parts_and_tires_net) AS parts_and_tires_after_discount,
    sum(sublets_total) AS sublets,
    sum((hazmat_total + shop_supplies)) AS fees,
    billing_group
   FROM ask865.shopware_closed_sales
  GROUP BY ((date_trunc('month'::text, (closed_at AT TIME ZONE 'America/New_York'::text)))::date), billing_group;


ALTER VIEW ask865.v_shopware_sales_monthly OWNER TO ask865_view_owner;

--
-- Name: VIEW v_shopware_sales_monthly; Type: COMMENT; Schema: ask865; Owner: ask865_view_owner
--

COMMENT ON VIEW ask865.v_shopware_sales_monthly IS 'Shop-Ware closed invoices by month AND billed customer group; keep 865 Autos separate from other customers. Not cash receipts. Parts net includes tires. No labor cost: do not infer gross profit. Not combined with Tekmetric.';


--
-- Name: bhph_account_events bhph_account_events_import_run_id_source_row_number_key; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.bhph_account_events
    ADD CONSTRAINT bhph_account_events_import_run_id_source_row_number_key UNIQUE (import_run_id, source_row_number);


--
-- Name: bhph_account_events bhph_account_events_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.bhph_account_events
    ADD CONSTRAINT bhph_account_events_pkey PRIMARY KEY (id);


--
-- Name: data_quality_issues data_quality_issues_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.data_quality_issues
    ADD CONSTRAINT data_quality_issues_pkey PRIMARY KEY (id);


--
-- Name: import_audits import_audits_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.import_audits
    ADD CONSTRAINT import_audits_pkey PRIMARY KEY (import_run_id, completed_at);


--
-- Name: import_runs import_runs_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.import_runs
    ADD CONSTRAINT import_runs_pkey PRIMARY KEY (id);


--
-- Name: import_runs import_runs_report_key_file_sha256_key; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.import_runs
    ADD CONSTRAINT import_runs_report_key_file_sha256_key UNIQUE (report_key, file_sha256);


--
-- Name: inventory_cost_snapshots inventory_cost_snapshots_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.inventory_cost_snapshots
    ADD CONSTRAINT inventory_cost_snapshots_pkey PRIMARY KEY (import_run_id, stock_no);


--
-- Name: inventory_price_history inventory_price_history_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.inventory_price_history
    ADD CONSTRAINT inventory_price_history_pkey PRIMARY KEY (import_run_id, stock_no);


--
-- Name: inventory_snapshots inventory_snapshots_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.inventory_snapshots
    ADD CONSTRAINT inventory_snapshots_pkey PRIMARY KEY (import_run_id, stock_no);


--
-- Name: report_definitions report_definitions_canonical_name_key; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.report_definitions
    ADD CONSTRAINT report_definitions_canonical_name_key UNIQUE (canonical_name);


--
-- Name: report_definitions report_definitions_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.report_definitions
    ADD CONSTRAINT report_definitions_pkey PRIMARY KEY (report_key);


--
-- Name: report_rows report_rows_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.report_rows
    ADD CONSTRAINT report_rows_pkey PRIMARY KEY (import_run_id, row_number);


--
-- Name: shopware_closed_sales shopware_closed_sales_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.shopware_closed_sales
    ADD CONSTRAINT shopware_closed_sales_pkey PRIMARY KEY (shop_id, ro_id);


--
-- Name: shopware_import_runs shopware_import_runs_file_sha256_key; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.shopware_import_runs
    ADD CONSTRAINT shopware_import_runs_file_sha256_key UNIQUE (file_sha256);


--
-- Name: shopware_import_runs shopware_import_runs_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.shopware_import_runs
    ADD CONSTRAINT shopware_import_runs_pkey PRIMARY KEY (id);


--
-- Name: sold_deal_sensitive sold_deal_sensitive_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.sold_deal_sensitive
    ADD CONSTRAINT sold_deal_sensitive_pkey PRIMARY KEY (deal_no);


--
-- Name: sold_deals sold_deals_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.sold_deals
    ADD CONSTRAINT sold_deals_pkey PRIMARY KEY (deal_no);


--
-- Name: sold_deals sold_deals_source_import_run_id_source_row_number_key; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.sold_deals
    ADD CONSTRAINT sold_deals_source_import_run_id_source_row_number_key UNIQUE (source_import_run_id, source_row_number);


--
-- Name: source_issue_register source_issue_register_pkey; Type: CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.source_issue_register
    ADD CONSTRAINT source_issue_register_pkey PRIMARY KEY (report_key, issue_code);


--
-- Name: bhph_events_account_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX bhph_events_account_idx ON ask865.bhph_account_events USING btree (account_id, account_number);


--
-- Name: bhph_events_date_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX bhph_events_date_idx ON ask865.bhph_account_events USING btree (event_date DESC);


--
-- Name: bhph_events_deal_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX bhph_events_deal_idx ON ask865.bhph_account_events USING btree (deal_no) WHERE (deal_no IS NOT NULL);


--
-- Name: data_quality_issues_natural_key; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE UNIQUE INDEX data_quality_issues_natural_key ON ask865.data_quality_issues USING btree (import_run_id, COALESCE(row_number, 0), issue_code);


--
-- Name: data_quality_issues_run_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX data_quality_issues_run_idx ON ask865.data_quality_issues USING btree (import_run_id, severity);


--
-- Name: inventory_cost_stock_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX inventory_cost_stock_idx ON ask865.inventory_cost_snapshots USING btree (stock_no, snapshot_at DESC);


--
-- Name: inventory_price_stock_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX inventory_price_stock_idx ON ask865.inventory_price_history USING btree (stock_no, snapshot_at DESC);


--
-- Name: inventory_snapshots_status_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX inventory_snapshots_status_idx ON ask865.inventory_snapshots USING btree (status, snapshot_at DESC);


--
-- Name: inventory_snapshots_stock_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX inventory_snapshots_stock_idx ON ask865.inventory_snapshots USING btree (stock_no, snapshot_at DESC);


--
-- Name: inventory_snapshots_vin_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX inventory_snapshots_vin_idx ON ask865.inventory_snapshots USING btree (vin) WHERE (vin IS NOT NULL);


--
-- Name: report_rows_account_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX report_rows_account_idx ON ask865.report_rows USING btree (account_id, account_number) WHERE ((account_id IS NOT NULL) OR (account_number IS NOT NULL));


--
-- Name: report_rows_data_gin_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX report_rows_data_gin_idx ON ask865.report_rows USING gin (data jsonb_path_ops);


--
-- Name: report_rows_deal_no_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX report_rows_deal_no_idx ON ask865.report_rows USING btree (deal_no) WHERE (deal_no IS NOT NULL);


--
-- Name: report_rows_report_key_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX report_rows_report_key_idx ON ask865.report_rows USING btree (report_key, import_run_id);


--
-- Name: report_rows_stock_no_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX report_rows_stock_no_idx ON ask865.report_rows USING btree (stock_no) WHERE (stock_no IS NOT NULL);


--
-- Name: report_rows_vin_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX report_rows_vin_idx ON ask865.report_rows USING btree (vin) WHERE (vin IS NOT NULL);


--
-- Name: shopware_closed_sales_closed_at; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX shopware_closed_sales_closed_at ON ask865.shopware_closed_sales USING btree (closed_at);


--
-- Name: shopware_closed_sales_source_import; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX shopware_closed_sales_source_import ON ask865.shopware_closed_sales USING btree (source_import_id);


--
-- Name: sold_deal_sensitive_credit_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX sold_deal_sensitive_credit_idx ON ask865.sold_deal_sensitive USING btree (credit_score) WHERE (credit_score IS NOT NULL);


--
-- Name: sold_deals_date_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX sold_deals_date_idx ON ask865.sold_deals USING btree (deal_date DESC);


--
-- Name: sold_deals_lender_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX sold_deals_lender_idx ON ask865.sold_deals USING btree (lender_name) WHERE (lender_name IS NOT NULL);


--
-- Name: sold_deals_salesperson_date_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX sold_deals_salesperson_date_idx ON ask865.sold_deals USING btree (salesperson1_name, deal_date DESC);


--
-- Name: sold_deals_stock_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX sold_deals_stock_idx ON ask865.sold_deals USING btree (stock_no) WHERE (stock_no IS NOT NULL);


--
-- Name: sold_deals_vin_idx; Type: INDEX; Schema: ask865; Owner: postgres
--

CREATE INDEX sold_deals_vin_idx ON ask865.sold_deals USING btree (vin) WHERE (vin IS NOT NULL);


--
-- Name: import_runs audit_completed_import; Type: TRIGGER; Schema: ask865; Owner: postgres
--

CREATE TRIGGER audit_completed_import AFTER UPDATE OF status ON ask865.import_runs FOR EACH ROW WHEN ((new.status = ANY (ARRAY['loaded'::text, 'loaded_with_warnings'::text]))) EXECUTE FUNCTION ask865.audit_completed_import();


--
-- Name: bhph_account_events bhph_account_events_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.bhph_account_events
    ADD CONSTRAINT bhph_account_events_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ask865.import_runs(id) ON DELETE CASCADE;


--
-- Name: data_quality_issues data_quality_issues_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.data_quality_issues
    ADD CONSTRAINT data_quality_issues_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ask865.import_runs(id) ON DELETE CASCADE;


--
-- Name: import_audits import_audits_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.import_audits
    ADD CONSTRAINT import_audits_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ask865.import_runs(id);


--
-- Name: import_runs import_runs_report_key_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.import_runs
    ADD CONSTRAINT import_runs_report_key_fkey FOREIGN KEY (report_key) REFERENCES ask865.report_definitions(report_key);


--
-- Name: inventory_cost_snapshots inventory_cost_snapshots_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.inventory_cost_snapshots
    ADD CONSTRAINT inventory_cost_snapshots_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ask865.import_runs(id) ON DELETE CASCADE;


--
-- Name: inventory_price_history inventory_price_history_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.inventory_price_history
    ADD CONSTRAINT inventory_price_history_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ask865.import_runs(id) ON DELETE CASCADE;


--
-- Name: inventory_snapshots inventory_snapshots_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.inventory_snapshots
    ADD CONSTRAINT inventory_snapshots_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ask865.import_runs(id) ON DELETE CASCADE;


--
-- Name: report_rows report_rows_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.report_rows
    ADD CONSTRAINT report_rows_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES ask865.import_runs(id) ON DELETE CASCADE;


--
-- Name: report_rows report_rows_report_key_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.report_rows
    ADD CONSTRAINT report_rows_report_key_fkey FOREIGN KEY (report_key) REFERENCES ask865.report_definitions(report_key);


--
-- Name: shopware_closed_sales shopware_closed_sales_source_import_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.shopware_closed_sales
    ADD CONSTRAINT shopware_closed_sales_source_import_id_fkey FOREIGN KEY (source_import_id) REFERENCES ask865.shopware_import_runs(id);


--
-- Name: sold_deal_sensitive sold_deal_sensitive_deal_no_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.sold_deal_sensitive
    ADD CONSTRAINT sold_deal_sensitive_deal_no_fkey FOREIGN KEY (deal_no) REFERENCES ask865.sold_deals(deal_no) ON DELETE CASCADE;


--
-- Name: sold_deal_sensitive sold_deal_sensitive_source_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.sold_deal_sensitive
    ADD CONSTRAINT sold_deal_sensitive_source_import_run_id_fkey FOREIGN KEY (source_import_run_id) REFERENCES ask865.import_runs(id);


--
-- Name: sold_deals sold_deals_source_import_run_id_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.sold_deals
    ADD CONSTRAINT sold_deals_source_import_run_id_fkey FOREIGN KEY (source_import_run_id) REFERENCES ask865.import_runs(id);


--
-- Name: source_issue_register source_issue_register_report_key_fkey; Type: FK CONSTRAINT; Schema: ask865; Owner: postgres
--

ALTER TABLE ONLY ask865.source_issue_register
    ADD CONSTRAINT source_issue_register_report_key_fkey FOREIGN KEY (report_key) REFERENCES ask865.report_definitions(report_key);


--
-- Name: source_issue_register app_issue_register_read; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY app_issue_register_read ON ask865.source_issue_register FOR SELECT TO ask865_dashboard_app USING (true);


--
-- Name: source_issue_register app_issue_register_update; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY app_issue_register_update ON ask865.source_issue_register FOR UPDATE TO ask865_dashboard_app USING (true) WITH CHECK (true);


--
-- Name: bhph_account_events ask865_ingest_all_bhph_events; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_bhph_events ON ask865.bhph_account_events TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: import_runs ask865_ingest_all_import_runs; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_import_runs ON ask865.import_runs TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: inventory_snapshots ask865_ingest_all_inventory; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_inventory ON ask865.inventory_snapshots TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: inventory_cost_snapshots ask865_ingest_all_inventory_cost; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_inventory_cost ON ask865.inventory_cost_snapshots TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: inventory_price_history ask865_ingest_all_price_history; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_price_history ON ask865.inventory_price_history TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: data_quality_issues ask865_ingest_all_quality_issues; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_quality_issues ON ask865.data_quality_issues TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: report_definitions ask865_ingest_all_report_definitions; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_report_definitions ON ask865.report_definitions TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: report_rows ask865_ingest_all_report_rows; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_report_rows ON ask865.report_rows TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: sold_deals ask865_ingest_all_sold_deals; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_sold_deals ON ask865.sold_deals TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: sold_deal_sensitive ask865_ingest_all_sold_sensitive; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_ingest_all_sold_sensitive ON ask865.sold_deal_sensitive TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: sold_deal_sensitive ask865_sensitive_reader_read_sold_sensitive; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_sensitive_reader_read_sold_sensitive ON ask865.sold_deal_sensitive FOR SELECT TO ask865_sensitive_reader USING (true);


--
-- Name: bhph_account_events ask865_view_owner_read_bhph_account_events; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_bhph_account_events ON ask865.bhph_account_events FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: import_runs ask865_view_owner_read_import_runs; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_import_runs ON ask865.import_runs FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: inventory_snapshots ask865_view_owner_read_inventory; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_inventory ON ask865.inventory_snapshots FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: inventory_cost_snapshots ask865_view_owner_read_inventory_cost; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_inventory_cost ON ask865.inventory_cost_snapshots FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: inventory_price_history ask865_view_owner_read_price_history; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_price_history ON ask865.inventory_price_history FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: data_quality_issues ask865_view_owner_read_quality_issues; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_quality_issues ON ask865.data_quality_issues FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: report_definitions ask865_view_owner_read_report_definitions; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_report_definitions ON ask865.report_definitions FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: sold_deals ask865_view_owner_read_sold_deals; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_sold_deals ON ask865.sold_deals FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: sold_deal_sensitive ask865_view_owner_read_sold_sensitive; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ask865_view_owner_read_sold_sensitive ON ask865.sold_deal_sensitive FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: bhph_account_events; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.bhph_account_events ENABLE ROW LEVEL SECURITY;

--
-- Name: data_quality_issues; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.data_quality_issues ENABLE ROW LEVEL SECURITY;

--
-- Name: import_audits; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.import_audits ENABLE ROW LEVEL SECURITY;

--
-- Name: import_runs; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.import_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: import_audits ingest_audits; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ingest_audits ON ask865.import_audits TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: source_issue_register ingest_issue_register; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY ingest_issue_register ON ask865.source_issue_register TO ask865_ingest USING (true) WITH CHECK (true);


--
-- Name: inventory_cost_snapshots; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.inventory_cost_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_price_history; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.inventory_price_history ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_snapshots; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.inventory_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: report_definitions; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.report_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: report_rows; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.report_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: shopware_closed_sales; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.shopware_closed_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: shopware_import_runs; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.shopware_import_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: shopware_import_runs shopware_runs_insert; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY shopware_runs_insert ON ask865.shopware_import_runs FOR INSERT TO ask865_ingest WITH CHECK (true);


--
-- Name: shopware_import_runs shopware_runs_read; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY shopware_runs_read ON ask865.shopware_import_runs FOR SELECT TO ask865_ingest USING (true);


--
-- Name: shopware_closed_sales shopware_sales_insert; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY shopware_sales_insert ON ask865.shopware_closed_sales FOR INSERT TO ask865_ingest WITH CHECK (true);


--
-- Name: shopware_closed_sales shopware_sales_read; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY shopware_sales_read ON ask865.shopware_closed_sales FOR SELECT TO ask865_ingest USING (true);


--
-- Name: shopware_closed_sales shopware_sales_view; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY shopware_sales_view ON ask865.shopware_closed_sales FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: sold_deal_sensitive; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.sold_deal_sensitive ENABLE ROW LEVEL SECURITY;

--
-- Name: sold_deals; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.sold_deals ENABLE ROW LEVEL SECURITY;

--
-- Name: source_issue_register; Type: ROW SECURITY; Schema: ask865; Owner: postgres
--

ALTER TABLE ask865.source_issue_register ENABLE ROW LEVEL SECURITY;

--
-- Name: import_audits view_audits; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY view_audits ON ask865.import_audits FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: source_issue_register view_issue_register; Type: POLICY; Schema: ask865; Owner: postgres
--

CREATE POLICY view_issue_register ON ask865.source_issue_register FOR SELECT TO ask865_view_owner USING (true);


--
-- Name: SCHEMA ask865; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA ask865 TO ask865_ingest;
GRANT USAGE ON SCHEMA ask865 TO ask865_reader;
GRANT USAGE ON SCHEMA ask865 TO ask865_sensitive_reader;
GRANT USAGE ON SCHEMA ask865 TO ask865_view_owner;


--
-- Name: FUNCTION audit_completed_import(); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.audit_completed_import() FROM PUBLIC;


--
-- Name: FUNCTION audit_import(p_run_id bigint); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.audit_import(p_run_id bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION ask865.audit_import(p_run_id bigint) TO ask865_ingest;


--
-- Name: FUNCTION dc_boolean(value text); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.dc_boolean(value text) FROM PUBLIC;
GRANT ALL ON FUNCTION ask865.dc_boolean(value text) TO ask865_ingest;


--
-- Name: FUNCTION dc_date(value text); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.dc_date(value text) FROM PUBLIC;
GRANT ALL ON FUNCTION ask865.dc_date(value text) TO ask865_ingest;


--
-- Name: FUNCTION dc_integer(value text); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.dc_integer(value text) FROM PUBLIC;
GRANT ALL ON FUNCTION ask865.dc_integer(value text) TO ask865_ingest;


--
-- Name: FUNCTION dc_number(value text); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.dc_number(value text) FROM PUBLIC;
GRANT ALL ON FUNCTION ask865.dc_number(value text) TO ask865_ingest;


--
-- Name: FUNCTION dc_timestamp(value text); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.dc_timestamp(value text) FROM PUBLIC;
GRANT ALL ON FUNCTION ask865.dc_timestamp(value text) TO ask865_ingest;


--
-- Name: FUNCTION ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb); Type: ACL; Schema: ask865; Owner: postgres
--

REVOKE ALL ON FUNCTION ask865.ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION ask865.ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb) TO ask865_ingest;


--
-- Name: TABLE bhph_account_events; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.bhph_account_events TO ask865_ingest;
GRANT SELECT ON TABLE ask865.bhph_account_events TO ask865_view_owner;


--
-- Name: SEQUENCE bhph_account_events_id_seq; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE ask865.bhph_account_events_id_seq TO ask865_ingest;


--
-- Name: TABLE data_quality_issues; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.data_quality_issues TO ask865_ingest;
GRANT SELECT ON TABLE ask865.data_quality_issues TO ask865_view_owner;


--
-- Name: SEQUENCE data_quality_issues_id_seq; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE ask865.data_quality_issues_id_seq TO ask865_ingest;


--
-- Name: TABLE import_audits; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE ask865.import_audits TO ask865_ingest;
GRANT SELECT ON TABLE ask865.import_audits TO ask865_view_owner;


--
-- Name: TABLE import_runs; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.import_runs TO ask865_ingest;
GRANT SELECT ON TABLE ask865.import_runs TO ask865_view_owner;


--
-- Name: SEQUENCE import_runs_id_seq; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE ask865.import_runs_id_seq TO ask865_ingest;


--
-- Name: TABLE inventory_cost_snapshots; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.inventory_cost_snapshots TO ask865_ingest;
GRANT SELECT ON TABLE ask865.inventory_cost_snapshots TO ask865_view_owner;


--
-- Name: TABLE inventory_price_history; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.inventory_price_history TO ask865_ingest;
GRANT SELECT ON TABLE ask865.inventory_price_history TO ask865_view_owner;


--
-- Name: TABLE inventory_snapshots; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.inventory_snapshots TO ask865_ingest;
GRANT SELECT ON TABLE ask865.inventory_snapshots TO ask865_view_owner;


--
-- Name: TABLE report_definitions; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.report_definitions TO ask865_ingest;
GRANT SELECT ON TABLE ask865.report_definitions TO ask865_view_owner;


--
-- Name: TABLE report_rows; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.report_rows TO ask865_ingest;


--
-- Name: TABLE shopware_closed_sales; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE ask865.shopware_closed_sales TO ask865_ingest;


--
-- Name: COLUMN shopware_closed_sales.closed_at; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(closed_at) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.labor_net; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(labor_net) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.parts_and_tires_net; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(parts_and_tires_net) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.hazmat_total; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(hazmat_total) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.sublets_total; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(sublets_total) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.shop_supplies; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(shop_supplies) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.subtotal; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(subtotal) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.tax_total; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(tax_total) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.total_with_tax; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(total_with_tax) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: COLUMN shopware_closed_sales.billing_group; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT(billing_group) ON TABLE ask865.shopware_closed_sales TO ask865_view_owner;


--
-- Name: TABLE shopware_import_runs; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE ask865.shopware_import_runs TO ask865_ingest;


--
-- Name: SEQUENCE shopware_import_runs_id_seq; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,USAGE ON SEQUENCE ask865.shopware_import_runs_id_seq TO ask865_ingest;


--
-- Name: TABLE sold_deal_sensitive; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.sold_deal_sensitive TO ask865_ingest;
GRANT SELECT ON TABLE ask865.sold_deal_sensitive TO ask865_view_owner;
GRANT SELECT ON TABLE ask865.sold_deal_sensitive TO ask865_sensitive_reader;


--
-- Name: TABLE sold_deals; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ask865.sold_deals TO ask865_ingest;
GRANT SELECT ON TABLE ask865.sold_deals TO ask865_view_owner;


--
-- Name: TABLE source_issue_register; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT SELECT,INSERT,UPDATE ON TABLE ask865.source_issue_register TO ask865_ingest;
GRANT SELECT ON TABLE ask865.source_issue_register TO ask865_view_owner;
GRANT SELECT ON TABLE ask865.source_issue_register TO ask865_dashboard_app;


--
-- Name: COLUMN source_issue_register.owner_name; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT UPDATE(owner_name) ON TABLE ask865.source_issue_register TO ask865_dashboard_app;


--
-- Name: COLUMN source_issue_register.review_status; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT UPDATE(review_status) ON TABLE ask865.source_issue_register TO ask865_dashboard_app;


--
-- Name: COLUMN source_issue_register.notes; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT UPDATE(notes) ON TABLE ask865.source_issue_register TO ask865_dashboard_app;


--
-- Name: COLUMN source_issue_register.updated_by; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT UPDATE(updated_by) ON TABLE ask865.source_issue_register TO ask865_dashboard_app;


--
-- Name: COLUMN source_issue_register.updated_at; Type: ACL; Schema: ask865; Owner: postgres
--

GRANT UPDATE(updated_at) ON TABLE ask865.source_issue_register TO ask865_dashboard_app;


--
-- Name: TABLE v_current_inventory; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_current_inventory TO ask865_reader;


--
-- Name: TABLE v_current_inventory_cost; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_current_inventory_cost TO ask865_reader;


--
-- Name: TABLE v_dashboard_inventory; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_dashboard_inventory TO ask865_reader;


--
-- Name: TABLE v_sold_deals_bi; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_sold_deals_bi TO ask865_reader;


--
-- Name: TABLE v_dashboard_attention_items; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_dashboard_attention_items TO ask865_reader;


--
-- Name: TABLE v_dashboard_bhph_summary; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_dashboard_bhph_summary TO ask865_reader;


--
-- Name: TABLE v_dashboard_import_health; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_dashboard_import_health TO ask865_reader;


--
-- Name: TABLE v_dashboard_lender_monthly; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_dashboard_lender_monthly TO ask865_reader;


--
-- Name: TABLE v_dashboard_sales_monthly; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_dashboard_sales_monthly TO ask865_reader;


--
-- Name: TABLE v_dashboard_salesperson_monthly; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_dashboard_salesperson_monthly TO ask865_reader;


--
-- Name: TABLE v_data_freshness; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_data_freshness TO ask865_reader;


--
-- Name: TABLE v_data_quality_summary; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_data_quality_summary TO ask865_reader;


--
-- Name: TABLE v_latest_inventory_prices; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_latest_inventory_prices TO ask865_reader;


--
-- Name: TABLE v_sales_daily; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_sales_daily TO ask865_reader;


--
-- Name: TABLE v_shopware_sales_monthly; Type: ACL; Schema: ask865; Owner: ask865_view_owner
--

GRANT SELECT ON TABLE ask865.v_shopware_sales_monthly TO ask865_reader;


--
-- PostgreSQL database dump complete
--


-- Every imported row is bound to the existing Atlas organization. The fixed
-- organization constraint deliberately prevents a second dealership from being
-- loaded into this legacy schema before its keys/views are made multi-tenant.
DO $organization_scope$
DECLARE
  target_org uuid;
  relation record;
BEGIN
  SELECT id INTO STRICT target_org FROM public.organizations
  WHERE slug = '865-autos' AND is_active;
  FOR relation IN SELECT tablename FROM pg_tables WHERE schemaname = 'ask865'
  LOOP
    EXECUTE format('ALTER TABLE ask865.%I ADD COLUMN organization_id uuid NOT NULL DEFAULT %L REFERENCES public.organizations(id)', relation.tablename, target_org);
    EXECUTE format('ALTER TABLE ask865.%I ADD CONSTRAINT %I CHECK (organization_id = %L::uuid)', relation.tablename, relation.tablename || '_single_organization', target_org);
  END LOOP;
END
$organization_scope$;

REVOKE CREATE ON SCHEMA ask865 FROM ask865_view_owner;
REVOKE ALL ON SCHEMA ask865 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA ask865 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ask865 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ask865 FROM PUBLIC, anon, authenticated;
COMMENT ON SCHEMA ask865 IS 'Private 865 Autos reporting. Organization-bound migration staging; no Data API access. Atlas module authorization is required before UI integration.';
