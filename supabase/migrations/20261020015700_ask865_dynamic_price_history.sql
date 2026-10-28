-- Full rollback rehearsal passed: exactly seven existing derived price arrays
-- gain 13 previously omitted entries (5922 -> 5935); 2101 rows remain.
-- All 64 Price Log imports pass. Source/import/other-field checksums and every
-- non-Price-Log health result are preserved by assertions below.
-- Only the Price Log branches of the two existing functions change; their
-- owner/signatures/ACLs stay identical. Two new pure-data helpers use INVOKER,
-- a fixed search_path, no tables, and no PUBLIC/anon/authenticated execution.
-- New functions are executable only by the existing ingest role.
-- User explicitly authorized importer + health repair and affected-history rebuild.
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Price Log has a fixed core and a variable, contiguous Reprice1..N tail.
create or replace function ask865.price_log_headers_valid(p_headers text[])
returns boolean language sql immutable security invoker set search_path = pg_catalog as $$
  select coalesce(
    p_headers @> array['Description','Vin','StockNumber','DaysInStock',
      'AskingPrice','AdvertisingPrice','SpecialPrice','VehiclePrice']::text[]
    and cardinality(p_headers) = (select count(distinct h) from unnest(p_headers) h)
    and not exists (
      select 1 from unnest(p_headers) h where h is null or
      (h <> all(array['CompanyName','Description','Vin','StockNumber','DaysInStock',
        'AskingPrice','AdvertisingPrice','SpecialPrice','VehiclePrice']::text[])
       and h !~ '^Reprice[1-9][0-9]*$')
    )
    and (select coalesce(max(substring(h from 8)::numeric),0) = count(*)
         from unnest(p_headers) h where h ~ '^Reprice[1-9][0-9]*$'),
    false);
$$;

-- Keep full original text (amount, price type and date); order 2 before 10.
create or replace function ask865.price_log_reprice_values(p_data jsonb)
returns jsonb language sql immutable security invoker set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(btrim(value) order by substring(key from 8)::numeric),'[]'::jsonb)
  from jsonb_each_text(p_data)
  where key ~ '^Reprice[1-9][0-9]*$' and nullif(btrim(value),'') is not null;
$$;
revoke all on function ask865.price_log_headers_valid(text[]),
  ask865.price_log_reprice_values(jsonb) from public,anon,authenticated;
grant execute on function ask865.price_log_headers_valid(text[]),
  ask865.price_log_reprice_values(jsonb) to ask865_ingest;

CREATE OR REPLACE FUNCTION ask865.ingest_dealercenter_report(p_report_key text, p_filename text, p_message_id text, p_received_at timestamp with time zone, p_raw_csv text, p_headers jsonb, p_rows jsonb, p_raw_rows jsonb, p_row_warnings jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'ask865', 'extensions', 'pg_catalog'
AS $function$
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

  if p_report_key = 'ask865_price_log' and not ask865.price_log_headers_valid(
    array(select jsonb_array_elements_text(p_headers))) then
    raise exception 'Invalid Price Log headers: required core plus contiguous Reprice1..N expected';
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
      ask865.price_log_reprice_values(r),
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
$function$
;

CREATE OR REPLACE FUNCTION ask865.audit_import(p_run_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'ask865'
AS $function$
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
  if r.report_key = 'ask865_price_log' then
    if not ask865.price_log_headers_valid(r.header_names) then
      problems := array_append(problems,'price_log_header_mismatch');
    end if;
    if exists (
      select 1 from ask865.report_rows rr
      left join ask865.inventory_price_history p
        on p.import_run_id=rr.import_run_id and p.source_row_number=rr.row_number
      where rr.import_run_id=r.id and (
        p.source_row_number is null
        or p.source_data is distinct from rr.data
        or p.reprice_values is distinct from ask865.price_log_reprice_values(rr.data)
        or (rr.data ? '__extra_fields' and rr.data->'__extra_fields'
          not in ('[]'::jsonb,'null'::jsonb,'""'::jsonb,'"[]"'::jsonb))
      )
    ) then
      problems := array_append(problems,'price_history_source_mismatch');
    end if;
  elsif cardinality(r.header_names) <> expected then
    problems := array_append(problems,'header_count_mismatch');
  end if;
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
end $function$
;


-- Authorized scope: Price Log only. Seven existing derived arrays differ from saved
-- source; 64 Price Log audits are refreshed. This transaction must abort if any
-- original report row, import metadata, non-history price field or other report
-- health result changes. No existing function ACL, RLS policy or role is changed.
do $repair$
declare
  before_sources text;
  before_imports text;
  before_fields text;
  before_other jsonb;
  changed integer;
  run record;
begin
  select md5(string_agg(to_jsonb(r)::text,'' order by import_run_id,row_number))
    into before_sources from ask865.report_rows r where report_key='ask865_price_log';
  select md5(string_agg(to_jsonb(r)::text,'' order by id))
    into before_imports from ask865.import_runs r where report_key='ask865_price_log';
  select md5(string_agg((to_jsonb(p)-'reprice_values')::text,'' order by import_run_id,stock_no))
    into before_fields from ask865.inventory_price_history p;
  select jsonb_agg(to_jsonb(h) order by report_key) into before_other
    from ask865.v_dashboard_import_health h where report_key<>'ask865_price_log';

  if exists(select 1 from ask865.import_runs
      where report_key='ask865_price_log' and status in ('loaded','loaded_with_warnings')
      and not ask865.price_log_headers_valid(header_names)) then
    raise exception 'Historical Price Log contains an unrecognized schema; abort repair';
  end if;
  if exists(select 1 from ask865.inventory_price_history p
      left join ask865.report_rows rr
        on rr.import_run_id=p.import_run_id and rr.row_number=p.source_row_number
      where rr.row_number is null or rr.report_key<>'ask865_price_log'
        or p.source_data is distinct from rr.data) then
    raise exception 'Saved price source differs from report rows; abort repair';
  end if;

  update ask865.inventory_price_history p
  set reprice_values=ask865.price_log_reprice_values(rr.data)
  from ask865.report_rows rr
  where rr.report_key='ask865_price_log' and p.import_run_id=rr.import_run_id
    and p.source_row_number=rr.row_number
    and p.reprice_values is distinct from ask865.price_log_reprice_values(rr.data);
  get diagnostics changed = row_count;
  if changed <> 7 then
    raise exception 'Expected seven derived rows, found %; abort for review', changed;
  end if;

  for run in select id from ask865.import_runs
    where report_key='ask865_price_log' and status in ('loaded','loaded_with_warnings')
    order by snapshot_at,id
  loop
    perform ask865.audit_import(run.id);
  end loop;
  if exists(select 1 from ask865.import_audits a join ask865.import_runs r
      on r.id=a.import_run_id and r.completed_at=a.completed_at
      where r.report_key='ask865_price_log' and cardinality(a.problems)>0) then
    raise exception 'Price history audit failed after rebuild';
  end if;

  if before_sources is distinct from
      (select md5(string_agg(to_jsonb(r)::text,'' order by import_run_id,row_number))
       from ask865.report_rows r where report_key='ask865_price_log')
    or before_imports is distinct from
      (select md5(string_agg(to_jsonb(r)::text,'' order by id))
       from ask865.import_runs r where report_key='ask865_price_log')
    or before_fields is distinct from
      (select md5(string_agg((to_jsonb(p)-'reprice_values')::text,'' order by import_run_id,stock_no))
       from ask865.inventory_price_history p)
    or before_other is distinct from
      (select jsonb_agg(to_jsonb(h) order by report_key)
       from ask865.v_dashboard_import_health h where report_key<>'ask865_price_log')
  then
    raise exception 'Preservation checks failed; abort repair';
  end if;
end $repair$;

