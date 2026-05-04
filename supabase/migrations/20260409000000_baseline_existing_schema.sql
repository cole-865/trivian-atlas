


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."credit_report_status" AS ENUM (
    'queued',
    'uploaded',
    'parsing',
    'redacting',
    'scoring',
    'done',
    'failed'
);


ALTER TYPE "public"."credit_report_status" OWNER TO "postgres";


CREATE TYPE "public"."deal_workflow_status" AS ENUM (
    'draft',
    'in_progress',
    'ready_to_score',
    'scored',
    'vehicle_selected',
    'awaiting_stips',
    'submitted_conditional',
    'submitted_complete',
    'decisioned',
    'archived'
);


ALTER TYPE "public"."deal_workflow_status" OWNER TO "postgres";


CREATE TYPE "public"."housing_type" AS ENUM (
    'rent',
    'own',
    'family'
);


ALTER TYPE "public"."housing_type" OWNER TO "postgres";


CREATE TYPE "public"."income_type" AS ENUM (
    'w2',
    'self_employed',
    'fixed',
    'cash'
);


ALTER TYPE "public"."income_type" OWNER TO "postgres";


CREATE TYPE "public"."parse_status" AS ENUM (
    'pending',
    'parsed',
    'failed',
    'redacted'
);


ALTER TYPE "public"."parse_status" OWNER TO "postgres";


CREATE TYPE "public"."pay_frequency" AS ENUM (
    'weekly',
    'biweekly',
    'semimonthly',
    'monthly'
);


ALTER TYPE "public"."pay_frequency" OWNER TO "postgres";


CREATE TYPE "public"."person_role" AS ENUM (
    'primary',
    'co'
);


ALTER TYPE "public"."person_role" OWNER TO "postgres";


CREATE TYPE "public"."vehicle_option_type" AS ENUM (
    'vsc_gap',
    'vsc_only',
    'gap_only',
    'none'
);


ALTER TYPE "public"."vehicle_option_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atlas_dashboard_metrics"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result json;
begin
  select json_build_object(
    'deals_created_30d',
      (select count(*) from deals
       where created_at >= now() - interval '30 days'),

    'deals_worked_30d',
      (select count(*) from deals
       where updated_at >= now() - interval '30 days'),

    'pending_approvals',
      (select count(*) from underwriting_results
       where decision is null),

    'risk_review_queue',
      (select count(*) from underwriting_results
       where decision = 'review'),

    'vehicles_inventory',
      (select count(*) from trivian_inventory
       where status = 'IN INVENTORY'),

    'credit_reports_processing',
      (select count(*)
       from credit_report_jobs
       where lower(status::text) not in (
         'complete','completed','done','success','succeeded',
         'failed','error','errored','canceled','cancelled'
       )),

    'credit_report_status_counts',
      (select coalesce(
         jsonb_object_agg(lower(status::text), cnt),
         '{}'::jsonb
       )
       from (
         select status::text as status, count(*) as cnt
         from credit_report_jobs
         group by status::text
       ) s)

  ) into result;

  return result;
end;
$$;


ALTER FUNCTION "public"."atlas_dashboard_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atlas_has_deal_override_authority"("target_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (
      select user_override.allowed
      from public.organization_user_permission_overrides user_override
      where user_override.organization_id = target_organization_id
        and user_override.user_id = auth.uid()
        and user_override.permission_key = 'approve_overrides'
      limit 1
    ),
    (
      select role_permission.allowed
      from public.organization_users organization_user
      join public.organization_role_permissions role_permission
        on role_permission.organization_id = organization_user.organization_id
       and role_permission.role = organization_user.role
       and role_permission.permission_key = 'approve_overrides'
      where organization_user.organization_id = target_organization_id
        and organization_user.user_id = auth.uid()
        and organization_user.is_active = true
      limit 1
    ),
    false
  );
$$;


ALTER FUNCTION "public"."atlas_has_deal_override_authority"("target_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atlas_is_active_organization_member"("target_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.organization_users organization_user
    where organization_user.organization_id = target_organization_id
      and organization_user.user_id = auth.uid()
      and organization_user.is_active = true
  );
$$;


ALTER FUNCTION "public"."atlas_is_active_organization_member"("target_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bhph_evaluate_bureau"("p_deal_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  b bureau_summary%rowtype;
  r bhph_bureau_rules%rowtype;
  v_stips jsonb := '[]'::jsonb;
begin
  select * into b
  from bureau_summary
  where deal_id = p_deal_id;

  if not found then
    raise exception 'No bureau_summary row found for deal_id=%', p_deal_id;
  end if;

  -- Pick tier by score (fallback to E if missing)
  select * into r
  from bhph_bureau_rules
  where (b.score is not null)
    and b.score between min_score and max_score
  order by min_score desc
  limit 1;

  if r.id is null then
    select * into r
    from bhph_bureau_rules
    where tier = 'E'
    limit 1;
  end if;

  -- Hard stops
  if b.months_since_repo is not null and r.hard_stop_if_repo_within_months is not null
     and b.months_since_repo <= r.hard_stop_if_repo_within_months then
    update bureau_summary
    set hard_stop = true,
        hard_stop_reason = 'Recent repo'
    where deal_id = p_deal_id;
    return;
  end if;

  if b.months_since_bankruptcy is not null and r.hard_stop_if_bk_within_months is not null
     and b.months_since_bankruptcy <= r.hard_stop_if_bk_within_months then
    update bureau_summary
    set hard_stop = true,
        hard_stop_reason = 'Recent bankruptcy'
    where deal_id = p_deal_id;
    return;
  end if;

  -- Stips (basic v1)
  if b.score is null then
    v_stips := v_stips || to_jsonb('Bureau score missing - verify identity'::text);
  end if;

  if b.total_collections is not null and b.total_collections > 2000 then
    v_stips := v_stips || to_jsonb('Collections > $2,000 - require higher down or proof of payoff plan'::text);
  end if;

  if b.open_auto_trade is not true then
    v_stips := v_stips || to_jsonb('No open auto tradeline - require stronger down / references'::text);
  end if;

  if b.utilization_pct is not null and b.utilization_pct > 80 then
    v_stips := v_stips || to_jsonb('High utilization - verify budget stability'::text);
  end if;

  update bureau_summary
  set risk_tier = r.tier,
      max_term_months = r.max_term_months,
      min_cash_down = r.min_cash_down,
      hard_stop = false,
      hard_stop_reason = null,
      stips = v_stips
  where deal_id = p_deal_id;
end;
$_$;


ALTER FUNCTION "public"."bhph_evaluate_bureau"("p_deal_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text") RETURNS TABLE("deal_id" "uuid", "approval_number" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_deal_id uuid;
  v_created_at timestamptz;
  v_approval_number text;
  v_primary_person_id uuid;
  v_co_person_id uuid;
  v_name text;
  v_parts text[];
  v_first_name text;
  v_last_name text;
begin
  v_name := trim(coalesce(p_customer_name, ''));

  if v_name = '' then
    raise exception 'customer_name is required';
  end if;

  v_parts := regexp_split_to_array(v_name, '\s+');

  if coalesce(array_length(v_parts, 1), 0) = 1 then
    v_first_name := v_parts[1];
    v_last_name := null;
  else
    v_first_name := v_parts[1];
    v_last_name := array_to_string(v_parts[2:array_length(v_parts, 1)], ' ');
  end if;

  insert into public.deals (
    customer_name,
    workflow_status,
    current_step
  )
  values (
    v_name,
    'draft',
    1
  )
  returning id, created_at
  into v_deal_id, v_created_at;

  v_approval_number :=
    to_char(v_created_at, 'YYMMDD') || '-' ||
    left(replace(v_deal_id::text, '-', ''), 6);

  update public.deals
  set approval_number = v_approval_number
  where id = v_deal_id;

  insert into public.deal_people (
    deal_id,
    role,
    first_name,
    last_name
  )
  values (
    v_deal_id,
    'primary',
    nullif(v_first_name, ''),
    nullif(v_last_name, '')
  )
  returning id
  into v_primary_person_id;

  insert into public.deal_people (
    deal_id,
    role
  )
  values (
    v_deal_id,
    'co'
  )
  returning id
  into v_co_person_id;

  insert into public.income_profiles (
    deal_person_id,
    income_type
  )
  values
    (v_primary_person_id, 'w2'),
    (v_co_person_id, 'w2');

  return query
  select v_deal_id, v_approval_number;
end;
$$;


ALTER FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text", "p_organization_id" "uuid") RETURNS TABLE("deal_id" "uuid", "approval_number" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_created record;
begin
  select *
  into v_created
  from public.create_deal_with_seed_data(p_customer_name)
  limit 1;

  if v_created.deal_id is null then
    return;
  end if;

  if p_organization_id is not null then
    if not public.is_active_organization_member(p_organization_id) then
      raise exception 'User is not an active member of organization %', p_organization_id;
    end if;

    update public.deals
    set
      organization_id = p_organization_id,
      updated_at = timezone('utc', now())
    where id = v_created.deal_id;
  end if;

  return query
  select v_created.deal_id::uuid, v_created.approval_number::text;
end;
$$;


ALTER FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text", "p_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_app_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select up.role
  from public.user_profiles up
  where up.id = auth.uid()
    and up.is_active = true
  limit 1;
$$;


ALTER FUNCTION "public"."current_app_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."force_credit_job_queued"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- Worker owns the state machine. New jobs MUST start queued.
  new.status := 'queued';

  -- Clear any accidental values
  new.locked_by := null;
  new.locked_at := null;
  new.processed_at := null;
  new.error_message := null;

  return new;
end;
$$;


ALTER FUNCTION "public"."force_credit_job_queued"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_organization_role"("p_organization_id" "uuid", "p_roles" "text"[], "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.organization_users ou
    join public.organizations o
      on o.id = ou.organization_id
    where ou.organization_id = p_organization_id
      and ou.user_id = coalesce(p_user_id, auth.uid())
      and ou.is_active = true
      and o.is_active = true
      and ou.role = any(p_roles)
  );
$$;


ALTER FUNCTION "public"."has_organization_role"("p_organization_id" "uuid", "p_roles" "text"[], "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_organization_member"("p_organization_id" "uuid", "p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.organization_users ou
    join public.organizations o
      on o.id = ou.organization_id
    where ou.organization_id = p_organization_id
      and ou.user_id = coalesce(p_user_id, auth.uid())
      and ou.is_active = true
      and o.is_active = true
  );
$$;


ALTER FUNCTION "public"."is_active_organization_member"("p_organization_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;


ALTER FUNCTION "public"."set_current_timestamp_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_deal_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_deal_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_trivian_inventory_vehicle_category"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.vehicle_category :=
    case
      when new.body_type is null or btrim(new.body_type) = '' then null
      when lower(new.body_type) like '%suv%' then 'suv'
      when lower(new.body_type) like '%crossover%' then 'suv'
      when lower(new.body_type) like '%sport utility%' then 'suv'
      when lower(new.body_type) like '%truck%' then 'truck'
      when lower(new.body_type) like '%pickup%' then 'truck'
      when lower(new.body_type) like '%van%' then 'van'
      when lower(new.body_type) like '%cargo%' then 'van'
      when lower(new.body_type) like '%sedan%' then 'car'
      when lower(new.body_type) like '%coupe%' then 'car'
      when lower(new.body_type) like '%hatch%' then 'car'
      when lower(new.body_type) like '%wagon%' then 'car'
      when lower(new.body_type) like '%convertible%' then 'car'
      else null
    end;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_trivian_inventory_vehicle_category"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_amount_financed"("vehicle_price" numeric, "include_vsc" boolean DEFAULT false, "include_gap" boolean DEFAULT false, "cash_down" numeric DEFAULT 0) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  with c as (select trivian_get_config() as cfg)
  select round(
    vehicle_price
    + (c.cfg).doc_fee
    + (c.cfg).title_license
    + (case when include_vsc then (c.cfg).vsc_price else 0 end)
    + (case when include_gap then (c.cfg).gap_price else 0 end)
    + trivian_tax_amount(vehicle_price, include_vsc)
    - coalesce(cash_down, 0),
    2
  )
  from c;
$$;


ALTER FUNCTION "public"."trivian_amount_financed"("vehicle_price" numeric, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."trivian_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_cap_pct" numeric DEFAULT 0.22 NOT NULL,
    "apr" numeric DEFAULT 0.2699 NOT NULL,
    "tax_rate_main" numeric DEFAULT 0.07 NOT NULL,
    "tax_add_base" numeric DEFAULT 3200 NOT NULL,
    "tax_add_rate" numeric DEFAULT 0.0275 NOT NULL,
    "vsc_price" numeric DEFAULT 1799 NOT NULL,
    "gap_price" numeric DEFAULT 599 NOT NULL,
    "doc_fee" numeric DEFAULT 699 NOT NULL,
    "title_license" numeric DEFAULT 196.50 NOT NULL,
    "organization_id" "uuid"
);


ALTER TABLE "public"."trivian_config" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_get_config"() RETURNS "public"."trivian_config"
    LANGUAGE "sql" STABLE
    AS $$
  select * from trivian_config limit 1;
$$;


ALTER FUNCTION "public"."trivian_get_config"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_inventory_pricing"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean DEFAULT false, "p_include_gap" boolean DEFAULT false, "p_cash_down" numeric DEFAULT 0) RETURNS TABLE("age_days" integer, "stock_number" "text", "year" integer, "make" "text", "model" "text", "odometer" integer, "exterior_color" "text", "asking_price" numeric, "payment" numeric, "pti" numeric, "pti_band" "text", "max_payment" numeric, "qualified" boolean, "amount_financed" numeric, "tax_amount" numeric, "has_price_error" boolean, "has_future_stock_date" boolean, "error_notes" "text")
    LANGUAGE "sql" STABLE
    AS $$
  select
    -- Age: keep raw math (can be negative) so errors are obvious
    case
      when i.date_in_stock is null then null
      else (current_date - i.date_in_stock)::int
    end as age_days,

    i.stock_number,
    i.year,
    i.make,
    i.model,
    i.odometer,
    i.exterior_color,
    i.asking_price,

    q.payment,

    case
      when p_gross_monthly_income is null or p_gross_monthly_income <= 0 then null
      else round(q.payment / p_gross_monthly_income, 4)
    end as pti,

    case
      when p_gross_monthly_income is null or p_gross_monthly_income <= 0 then 'unknown'
      when (q.payment / p_gross_monthly_income) < 0.15 then 'green'
      when (q.payment / p_gross_monthly_income) <= 0.22 then 'yellow'
      else 'red'
    end as pti_band,

    q.max_payment,
    q.qualified,
    q.amount_financed,
    q.tax_amount,

    -- DMS error flags
    (i.asking_price is null or i.asking_price <= 0) as has_price_error,
    (i.date_in_stock is not null and i.date_in_stock > current_date) as has_future_stock_date,

    -- readable note for UI
    trim(both ';' from
      concat(
        case when (i.asking_price is null or i.asking_price <= 0) then 'Missing/zero asking price; ' else '' end,
        case when (i.date_in_stock is not null and i.date_in_stock > current_date) then 'Date in stock is in the future; ' else '' end
      )
    ) as error_notes

  from trivian_inventory i
  cross join lateral trivian_quote(
    p_gross_monthly_income,
    i.asking_price,
    p_term_months,
    p_include_vsc,
    p_include_gap,
    p_cash_down
  ) as q

  where i.asking_price is not null -- keep it if you want, or remove to show null-priced cars too
  order by
    -- put error rows at the top so you notice them
    ((i.asking_price is null or i.asking_price <= 0)
      or (i.date_in_stock is not null and i.date_in_stock > current_date)) desc,
    q.payment asc nulls last,
    i.asking_price asc;
$$;


ALTER FUNCTION "public"."trivian_inventory_pricing"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_max_amount_financed"("max_payment" numeric, "term_months" integer) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  with c as (select trivian_get_config() as cfg),
  r as (select ((c.cfg).apr / 12.0) as rate from c)
  select
    case
      when term_months <= 0 then null
      when (select rate from r) <= 0 then round(max_payment * term_months, 2)
      else round(
        max_payment * ((1 - power(1 + (select rate from r), -term_months)) / (select rate from r)),
        2
      )
    end;
$$;


ALTER FUNCTION "public"."trivian_max_amount_financed"("max_payment" numeric, "term_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_max_payment"("gross_monthly_income" numeric) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  select round(gross_monthly_income * (trivian_get_config()).payment_cap_pct, 2);
$$;


ALTER FUNCTION "public"."trivian_max_payment"("gross_monthly_income" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_monthly_payment"("amount_financed" numeric, "term_months" integer) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  with c as (select trivian_get_config() as cfg),
  r as (select ((c.cfg).apr / 12.0) as rate from c)
  select
    case
      when term_months <= 0 then null
      when (select rate from r) <= 0 then round(amount_financed / term_months, 2)
      else round(
        amount_financed * ((select rate from r) / (1 - power(1 + (select rate from r), -term_months))),
        2
      )
    end;
$$;


ALTER FUNCTION "public"."trivian_monthly_payment"("amount_financed" numeric, "term_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_qualifying_units"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean DEFAULT false, "p_include_gap" boolean DEFAULT false, "p_cash_down" numeric DEFAULT 0) RETURNS TABLE("stock_number" "text", "year" integer, "make" "text", "model" "text", "asking_price" numeric, "payment" numeric, "max_payment" numeric, "amount_financed" numeric, "tax_amount" numeric, "qualified" boolean)
    LANGUAGE "sql" STABLE
    AS $$
  select
    i.stock_number,
    i.year,
    i.make,
    i.model,
    i.asking_price,
    q.payment,
    q.max_payment,
    q.amount_financed,
    q.tax_amount,
    q.qualified
  from trivian_inventory i
  cross join lateral trivian_quote(
    p_gross_monthly_income,  -- income
    i.asking_price,          -- vehicle price
    p_term_months,
    p_include_vsc,
    p_include_gap,
    p_cash_down
  ) as q
  where i.asking_price is not null
    and q.qualified = true
  order by i.asking_price asc;
$$;


ALTER FUNCTION "public"."trivian_qualifying_units"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_quote"("gross_monthly_income" numeric, "vehicle_price" numeric, "term_months" integer, "include_vsc" boolean DEFAULT false, "include_gap" boolean DEFAULT false, "cash_down" numeric DEFAULT 0) RETURNS TABLE("max_payment" numeric, "purchase_price" numeric, "doc_fee" numeric, "title_license" numeric, "vsc" numeric, "gap" numeric, "tax_amount" numeric, "amount_financed" numeric, "payment" numeric, "qualified" boolean, "max_amount_financed" numeric)
    LANGUAGE "sql" STABLE
    AS $$
  with c as (select trivian_get_config() as cfg),
  maxp as (select trivian_max_payment(gross_monthly_income)::numeric as max_payment),
  parts as (
    select
      vehicle_price::numeric as purchase_price,
      (c.cfg).doc_fee::numeric as doc_fee,
      (c.cfg).title_license::numeric as title_license,
      (case when include_vsc then (c.cfg).vsc_price else 0 end)::numeric as vsc,
      (case when include_gap then (c.cfg).gap_price else 0 end)::numeric as gap,
      trivian_tax_amount(vehicle_price, include_vsc)::numeric as tax_amount
    from c
  ),
  amt as (
    select trivian_amount_financed(vehicle_price, include_vsc, include_gap, cash_down)::numeric as amount_financed
  ),
  pay as (
    select trivian_monthly_payment((select amount_financed from amt), term_months::int)::numeric as payment
  )
  select
    (select max_payment from maxp),

    (select purchase_price from parts),
    (select doc_fee from parts),
    (select title_license from parts),
    (select vsc from parts),
    (select gap from parts),
    (select tax_amount from parts),

    (select amount_financed from amt),
    (select payment from pay),
    ((select payment from pay) <= (select max_payment from maxp)) as qualified,
    trivian_max_amount_financed((select max_payment from maxp), term_months::int)::numeric as max_amount_financed;
$$;


ALTER FUNCTION "public"."trivian_quote"("gross_monthly_income" numeric, "vehicle_price" numeric, "term_months" integer, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select round(greatest(vehicle_price - 320, 0) * 0.07, 2);
$$;


ALTER FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric, "include_vsc" boolean DEFAULT false) RETURNS numeric
    LANGUAGE "sql" STABLE
    AS $$
  with c as (select trivian_get_config() as cfg)
  select round(
    (
      (
        vehicle_price
        + (c.cfg).doc_fee
        + (case when include_vsc then (c.cfg).vsc_price else 0 end)
      ) * (c.cfg).tax_rate_main
    )
    + ((c.cfg).tax_add_base * (c.cfg).tax_add_rate),
    2
  )
  from c;
$$;


ALTER FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric, "include_vsc" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."update_timestamp"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "deal_id" "uuid",
    "override_request_id" "uuid",
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "link_href" "text",
    "metadata_json" "jsonb",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "app_notifications_type_check" CHECK (("type" = ANY (ARRAY['deal_funded'::"text", 'deal_funding_rejected'::"text", 'deal_funding_review'::"text", 'deal_override_requested'::"text", 'deal_override_approved'::"text", 'deal_override_denied'::"text", 'deal_override_countered'::"text", 'deal_override_stale'::"text"])))
);


ALTER TABLE "public"."app_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value_json" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid",
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    "changed_by_user_id" "uuid",
    "change_type" "text",
    "entity_type" "text",
    "before" "jsonb",
    "after" "jsonb"
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bhph_bureau_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier" "text" NOT NULL,
    "min_score" integer,
    "max_score" integer,
    "max_term_months" integer NOT NULL,
    "min_cash_down" numeric NOT NULL,
    "hard_stop_if_repo_within_months" integer,
    "hard_stop_if_bk_within_months" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bhph_bureau_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bureau_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bureau_summary_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "message_type" "text",
    "code" "text",
    "message_text" "text" NOT NULL,
    "severity" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    "applicant_role" "text" DEFAULT 'primary'::"text" NOT NULL,
    CONSTRAINT "bureau_messages_applicant_role_check" CHECK (("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))
);


ALTER TABLE "public"."bureau_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bureau_public_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bureau_summary_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "court_name" "text",
    "record_type" "text",
    "plaintiff" "text",
    "amount" numeric,
    "status" "text",
    "filed_date" "date",
    "resolved_date" "date",
    "no_effect" boolean DEFAULT false,
    "good" boolean DEFAULT false,
    "bad" boolean DEFAULT false,
    "raw_segment" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    "applicant_role" "text" DEFAULT 'primary'::"text" NOT NULL,
    CONSTRAINT "bureau_public_records_applicant_role_check" CHECK (("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))
);


ALTER TABLE "public"."bureau_public_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bureau_summary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "bureau_source" "text" DEFAULT 'equifax'::"text",
    "score" integer,
    "total_tradelines" integer,
    "open_tradelines" integer,
    "open_auto_trade" boolean,
    "months_since_repo" integer,
    "months_since_bankruptcy" integer,
    "total_collections" numeric,
    "total_chargeoffs" numeric,
    "past_due_amount" numeric,
    "utilization_pct" numeric,
    "oldest_trade_months" integer,
    "risk_tier" "text",
    "max_term_months" integer,
    "min_cash_down" numeric,
    "max_pti" numeric DEFAULT 0.22,
    "hard_stop" boolean DEFAULT false,
    "hard_stop_reason" "text",
    "stips" "jsonb" DEFAULT '[]'::"jsonb",
    "bureau_raw" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "credit_report_id" "uuid",
    "job_id" "uuid",
    "autos_on_bureau" integer,
    "open_auto_trades" integer,
    "paid_auto_trades" integer,
    "repo_count" integer,
    "organization_id" "uuid",
    "applicant_role" "text" DEFAULT 'primary'::"text" NOT NULL,
    CONSTRAINT "bureau_summary_applicant_role_check" CHECK (("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))
);


ALTER TABLE "public"."bureau_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bureau_tradelines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bureau_summary_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "creditor_name" "text",
    "account_type" "text",
    "account_status" "text",
    "condition_code" "text",
    "amount" numeric,
    "balance" numeric,
    "credit_limit" numeric,
    "monthly_payment" numeric,
    "past_due_amount" numeric,
    "high_balance" numeric,
    "opened_date" "date",
    "last_activity_date" "date",
    "last_payment_date" "date",
    "no_effect" boolean DEFAULT false,
    "good" boolean DEFAULT false,
    "bad" boolean DEFAULT false,
    "auto_repo" boolean DEFAULT false,
    "unpaid_collection" boolean DEFAULT false,
    "unpaid_chargeoff" boolean DEFAULT false,
    "is_auto" boolean DEFAULT false,
    "is_revolving" boolean DEFAULT false,
    "is_installment" boolean DEFAULT false,
    "raw_segment" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    "applicant_role" "text" DEFAULT 'primary'::"text" NOT NULL,
    CONSTRAINT "bureau_tradelines_applicant_role_check" CHECK (("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))
);


ALTER TABLE "public"."bureau_tradelines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_report_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "bureau" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "raw_bucket" "text" DEFAULT 'credit_reports_raw'::"text" NOT NULL,
    "raw_path" "text" NOT NULL,
    "extracted_text" "text",
    "redacted_text" "text",
    "status" "public"."credit_report_status" DEFAULT 'queued'::"public"."credit_report_status" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "redacted_bucket" "text",
    "redacted_path" "text",
    "organization_id" "uuid",
    "applicant_role" "text" DEFAULT 'primary'::"text" NOT NULL,
    CONSTRAINT "credit_report_jobs_applicant_role_check" CHECK (("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))
);


ALTER TABLE "public"."credit_report_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "latest_job_id" "uuid",
    "bureau" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "raw_bucket" "text" DEFAULT 'credit_reports_raw'::"text" NOT NULL,
    "raw_path" "text" NOT NULL,
    "redacted_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "redacted_bucket" "text",
    "redacted_path" "text",
    "organization_id" "uuid",
    "applicant_role" "text" DEFAULT 'primary'::"text" NOT NULL,
    CONSTRAINT "credit_reports_applicant_role_check" CHECK (("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))
);


ALTER TABLE "public"."credit_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "doc_type" "text" NOT NULL,
    "storage_bucket" "text" DEFAULT 'deal-docs'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "original_name" "text",
    "mime_type" "text",
    "size_bytes" bigint,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    "applicant_role" "text",
    CONSTRAINT "deal_documents_applicant_role_check" CHECK ((("applicant_role" IS NULL) OR ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))),
    CONSTRAINT "deal_documents_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['credit_app'::"text", 'credit_bureau'::"text", 'proof_of_income'::"text", 'proof_of_residence'::"text", 'driver_license'::"text", 'insurance'::"text", 'references'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."deal_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_funding_stip_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "doc_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "rejection_reason" "text",
    "structure_fingerprint" "text" NOT NULL,
    "verified_by" "uuid",
    "verified_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "verified_monthly_income" numeric,
    CONSTRAINT "deal_funding_stip_verifications_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['proof_of_income'::"text", 'proof_of_residence'::"text", 'driver_license'::"text"]))),
    CONSTRAINT "deal_funding_stip_verifications_status_check" CHECK (("status" = ANY (ARRAY['verified'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."deal_funding_stip_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_management_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "note" "text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deal_management_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_override_counter_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_override_request_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "counter_type" "text" NOT NULL,
    "review_note" "text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "base_structure_fingerprint" "text" NOT NULL,
    "proposal_structure_fingerprint" "text" NOT NULL,
    "inputs_json" "jsonb" NOT NULL,
    "outputs_snapshot_json" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "stale_reason" "text",
    "rejection_reason" "text",
    "accepted_at" timestamp with time zone,
    "accepted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deal_override_counter_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_override_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "blocker_code" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_by" "uuid",
    "requested_note" "text",
    "requested_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "reviewed_by" "uuid",
    "review_note" "text",
    "reviewed_at" timestamp with time zone,
    "vehicle_id" "uuid",
    "cash_down_snapshot" numeric,
    "amount_financed_snapshot" numeric,
    "monthly_payment_snapshot" numeric,
    "term_months_snapshot" integer,
    "ltv_snapshot" numeric,
    "pti_snapshot" numeric,
    "structure_fingerprint" "text" NOT NULL,
    "stale_reason" "text",
    "status_changed_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "deal_override_requests_blocker_code_check" CHECK (("blocker_code" = ANY (ARRAY['LTV'::"text", 'PTI'::"text", 'AMOUNT_FINANCED'::"text", 'VEHICLE_PRICE'::"text"]))),
    CONSTRAINT "deal_override_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'denied'::"text", 'cancelled'::"text", 'stale'::"text"])))
);


ALTER TABLE "public"."deal_override_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_people" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "role" "public"."person_role" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "email" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "zip" "text",
    "housing" "public"."housing_type",
    "residence_months" integer,
    "banking_checking" boolean DEFAULT false NOT NULL,
    "banking_savings" boolean DEFAULT false NOT NULL,
    "banking_prepaid" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "move_in_date" "date",
    "organization_id" "uuid",
    CONSTRAINT "deal_people_role_check" CHECK (("role" = ANY (ARRAY['primary'::"public"."person_role", 'co'::"public"."person_role"])))
);


ALTER TABLE "public"."deal_people" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_structure" (
    "deal_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "option_label" "text" NOT NULL,
    "include_vsc" boolean DEFAULT false NOT NULL,
    "include_gap" boolean DEFAULT false NOT NULL,
    "sale_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "cash_down" numeric(12,2),
    "trade_payoff" numeric(12,2),
    "jd_power_retail_book" numeric(12,2),
    "taxable_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "sales_tax" numeric(12,2) DEFAULT 0 NOT NULL,
    "doc_fee" numeric(12,2) DEFAULT 0 NOT NULL,
    "title_license" numeric(12,2) DEFAULT 0 NOT NULL,
    "fees_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "product_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "vsc_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "gap_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "amount_financed" numeric(12,2) DEFAULT 0 NOT NULL,
    "apr" numeric(8,4) DEFAULT 0 NOT NULL,
    "term_months" integer DEFAULT 0 NOT NULL,
    "monthly_payment" numeric(12,2) DEFAULT 0 NOT NULL,
    "ltv" numeric(10,6),
    "fits_program" boolean DEFAULT false NOT NULL,
    "fail_reasons" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "snapshot_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    CONSTRAINT "deal_structure_option_label_check" CHECK (("option_label" = ANY (ARRAY['NONE'::"text", 'VSC'::"text", 'GAP'::"text", 'VSC+GAP'::"text"])))
);


ALTER TABLE "public"."deal_structure" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_structure_inputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "option_label" "text" NOT NULL,
    "include_vsc" boolean DEFAULT false NOT NULL,
    "include_gap" boolean DEFAULT false NOT NULL,
    "term_months" integer NOT NULL,
    "cash_down" numeric,
    "sale_price" numeric DEFAULT 0 NOT NULL,
    "tax_rate_main" numeric DEFAULT 0 NOT NULL,
    "tax_add_base" numeric DEFAULT 0 NOT NULL,
    "tax_add_rate" numeric DEFAULT 0 NOT NULL,
    "doc_fee" numeric DEFAULT 0 NOT NULL,
    "title_license" numeric DEFAULT 0 NOT NULL,
    "vsc_price" numeric DEFAULT 0 NOT NULL,
    "gap_price" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."deal_structure_inputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deal_vehicle_selection" (
    "deal_id" "uuid" NOT NULL,
    "vehicle_id" "uuid" NOT NULL,
    "option_label" "text" NOT NULL,
    "include_vsc" boolean DEFAULT false NOT NULL,
    "include_gap" boolean DEFAULT false NOT NULL,
    "term_months" integer NOT NULL,
    "monthly_payment" numeric NOT NULL,
    "cash_down" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    CONSTRAINT "deal_vehicle_selection_option_label_check" CHECK (("option_label" = ANY (ARRAY['NONE'::"text", 'VSC'::"text", 'GAP'::"text", 'VSC+GAP'::"text"])))
);


ALTER TABLE "public"."deal_vehicle_selection" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "customer_name" "text" NOT NULL,
    "vehicle_description" "text",
    "status" "text" DEFAULT 'draft'::"text",
    "approval_number" "text",
    "current_step" integer DEFAULT 1 NOT NULL,
    "workflow_status" "public"."deal_workflow_status" DEFAULT 'draft'::"public"."deal_workflow_status" NOT NULL,
    "has_trade" boolean DEFAULT false NOT NULL,
    "cash_down" numeric,
    "trade_payoff" numeric,
    "vehicle_type" "text",
    "max_payment" numeric,
    "min_down" numeric,
    "household_income" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "trade_value" numeric,
    "funding_notes" "text",
    "internal_notes" "text",
    "submitted_at" timestamp with time zone,
    "submitted_by" "uuid",
    "submit_status" "text",
    "funded_at" timestamp with time zone,
    "funded_by" "uuid",
    "funding_status" "text",
    "funding_decision_notes" "text",
    "organization_id" "uuid"
);


ALTER TABLE "public"."deals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deal_id" "uuid",
    "user_id" "uuid",
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "document_type" "text" NOT NULL,
    "person_role" "public"."person_role",
    "parse_status" "public"."parse_status" DEFAULT 'pending'::"public"."parse_status" NOT NULL,
    "extracted_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sha256" "text"
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."income_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_person_id" "uuid" NOT NULL,
    "income_type" "public"."income_type" DEFAULT 'w2'::"public"."income_type" NOT NULL,
    "monthly_gross_manual" numeric,
    "manual_notes" "text",
    "hire_date" "date",
    "pay_frequency" "public"."pay_frequency",
    "gross_per_pay" numeric,
    "gross_ytd" numeric,
    "pay_date" "date",
    "pay_period_end" "date",
    "monthly_gross_calculated" numeric,
    "ytd_start_date" "date",
    "ytd_end_date" "date",
    "calc_flags" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "applied_to_deal" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid"
);


ALTER TABLE "public"."income_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" NOT NULL,
    "invited_by_user_id" "uuid",
    "token_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "accepted_by_user_id" "uuid",
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "organization_invitations_role_check" CHECK (("role" = ANY (ARRAY['sales'::"text", 'management'::"text", 'admin'::"text"]))),
    CONSTRAINT "organization_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'expired'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."organization_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_profile_settings" (
    "organization_id" "uuid" NOT NULL,
    "legal_business_name" "text",
    "dba_name" "text",
    "phone" "text",
    "website" "text",
    "main_email" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "postal_code" "text",
    "country" "text" DEFAULT 'US'::"text",
    "timezone" "text" DEFAULT 'America/New_York'::"text",
    "logo_storage_path" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."organization_profile_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_role_permissions" (
    "organization_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "permission_key" "text" NOT NULL,
    "allowed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "organization_role_permissions_permission_key_check" CHECK (("permission_key" = ANY (ARRAY['view_deals'::"text", 'edit_deals'::"text", 'submit_deals'::"text", 'fund_deals'::"text", 'approve_overrides'::"text", 'manage_users'::"text", 'manage_underwriting_settings'::"text", 'manage_workflow_settings'::"text", 'view_audit_logs'::"text", 'manage_integrations'::"text", 'export_reports'::"text"]))),
    CONSTRAINT "organization_role_permissions_role_check" CHECK (("role" = ANY (ARRAY['sales'::"text", 'management'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."organization_role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_settings" (
    "organization_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "value_json" "jsonb",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."organization_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_user_permission_overrides" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL,
    "allowed" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "organization_user_permission_overrides_permission_key_check" CHECK (("permission_key" = ANY (ARRAY['view_deals'::"text", 'edit_deals'::"text", 'submit_deals'::"text", 'fund_deals'::"text", 'approve_overrides'::"text", 'manage_users'::"text", 'manage_underwriting_settings'::"text", 'manage_workflow_settings'::"text", 'view_audit_logs'::"text", 'manage_integrations'::"text", 'export_reports'::"text"])))
);


ALTER TABLE "public"."organization_user_permission_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_users" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    CONSTRAINT "organization_users_role_check" CHECK (("role" = ANY (ARRAY['sales'::"text", 'management'::"text", 'admin'::"text", 'dev'::"text"])))
);


ALTER TABLE "public"."organization_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'sales'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trivian_inventory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "stock_number" "text" NOT NULL,
    "vin" "text",
    "year" integer,
    "make" "text",
    "model" "text",
    "odometer" integer,
    "exterior_color" "text",
    "date_in_stock" "date",
    "status" "text",
    "asking_price" numeric,
    "advertising_price" numeric,
    "vehicle_cost" numeric,
    "total_cost_with_estimated_flooring" numeric,
    "jd_power_retail_book" numeric,
    "jd_power_trade_book" numeric,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "body_type" "text",
    "vehicle_category" "text",
    "organization_id" "uuid",
    CONSTRAINT "trivian_inventory_vehicle_category_check" CHECK (("vehicle_category" = ANY (ARRAY['car'::"text", 'suv'::"text", 'truck'::"text", 'van'::"text"])))
);


ALTER TABLE "public"."trivian_inventory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."underwriting_inputs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deal_id" "uuid",
    "user_id" "uuid",
    "gross_monthly_income" numeric,
    "other_monthly_income" numeric DEFAULT 0,
    "total_monthly_income" numeric GENERATED ALWAYS AS ((COALESCE("gross_monthly_income", (0)::numeric) + COALESCE("other_monthly_income", (0)::numeric))) STORED,
    "monthly_housing" numeric,
    "monthly_debt" numeric,
    "max_payment_pct" numeric DEFAULT 0.22,
    "interest_rate_apr" numeric DEFAULT 0.2699,
    "term_months" integer,
    "include_vsc" boolean DEFAULT false,
    "include_gap" boolean DEFAULT false,
    "vsc_price" numeric DEFAULT 1799,
    "gap_price" numeric DEFAULT 599,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid"
);


ALTER TABLE "public"."underwriting_inputs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."underwriting_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "deal_id" "uuid",
    "user_id" "uuid",
    "max_payment" numeric,
    "max_amount_financed" numeric,
    "score_total" numeric,
    "decision" "text",
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "tier" "text",
    "max_term_months" integer,
    "min_cash_down" numeric,
    "max_pti" numeric,
    "hard_stop" boolean DEFAULT false NOT NULL,
    "hard_stop_reason" "text",
    "score_factors" "jsonb" DEFAULT '[]'::"jsonb",
    "stage" "text" DEFAULT 'bureau_precheck'::"text",
    "min_down_pct" numeric,
    "max_vehicle_price" numeric,
    "max_ltv" numeric,
    "apr" numeric,
    "organization_id" "uuid"
);


ALTER TABLE "public"."underwriting_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."underwriting_tier_policy" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tier" "text" NOT NULL,
    "max_vehicle_price" numeric NOT NULL,
    "max_amount_financed" numeric NOT NULL,
    "max_ltv" numeric NOT NULL,
    "max_term_months" integer NOT NULL,
    "max_pti" numeric NOT NULL,
    "min_cash_down" numeric NOT NULL,
    "min_down_pct" numeric NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "apr" numeric,
    "organization_id" "uuid"
);


ALTER TABLE "public"."underwriting_tier_policy" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_profiles_role_check" CHECK (("role" = ANY (ARRAY['sales'::"text", 'management'::"text", 'admin'::"text", 'dev'::"text"])))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "option_type" "public"."vehicle_option_type" NOT NULL,
    "includes_vsc" boolean DEFAULT false NOT NULL,
    "includes_gap" boolean DEFAULT false NOT NULL,
    "vsc_price" numeric DEFAULT 1799 NOT NULL,
    "gap_price" numeric DEFAULT 599 NOT NULL,
    "term_months" integer NOT NULL,
    "payment" numeric NOT NULL,
    "additional_down" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vehicle_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_selection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deal_id" "uuid" NOT NULL,
    "vehicle_option_id" "uuid" NOT NULL,
    "selected_by" "uuid",
    "selected_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vehicle_selection" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_term_policy" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "min_mileage" integer,
    "max_mileage" integer,
    "min_vehicle_age" integer,
    "max_vehicle_age" integer,
    "max_term_months" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid"
);


ALTER TABLE "public"."vehicle_term_policy" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_notifications"
    ADD CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bhph_bureau_rules"
    ADD CONSTRAINT "bhph_bureau_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bureau_messages"
    ADD CONSTRAINT "bureau_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bureau_public_records"
    ADD CONSTRAINT "bureau_public_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bureau_summary"
    ADD CONSTRAINT "bureau_summary_credit_report_id_unique" UNIQUE ("credit_report_id");



ALTER TABLE ONLY "public"."bureau_summary"
    ADD CONSTRAINT "bureau_summary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bureau_tradelines"
    ADD CONSTRAINT "bureau_tradelines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_report_jobs"
    ADD CONSTRAINT "credit_report_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_reports"
    ADD CONSTRAINT "credit_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_documents"
    ADD CONSTRAINT "deal_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_funding_stip_verifications"
    ADD CONSTRAINT "deal_funding_stip_verificatio_organization_id_deal_id_doc_t_key" UNIQUE ("organization_id", "deal_id", "doc_type");



ALTER TABLE ONLY "public"."deal_funding_stip_verifications"
    ADD CONSTRAINT "deal_funding_stip_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_management_notes"
    ADD CONSTRAINT "deal_management_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_override_counter_offers"
    ADD CONSTRAINT "deal_override_counter_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_override_requests"
    ADD CONSTRAINT "deal_override_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_people"
    ADD CONSTRAINT "deal_people_deal_role_unique" UNIQUE ("deal_id", "role");



ALTER TABLE ONLY "public"."deal_people"
    ADD CONSTRAINT "deal_people_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_structure_inputs"
    ADD CONSTRAINT "deal_structure_inputs_deal_id_key" UNIQUE ("deal_id");



ALTER TABLE ONLY "public"."deal_structure_inputs"
    ADD CONSTRAINT "deal_structure_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deal_structure"
    ADD CONSTRAINT "deal_structure_pkey" PRIMARY KEY ("deal_id");



ALTER TABLE ONLY "public"."deal_vehicle_selection"
    ADD CONSTRAINT "deal_vehicle_selection_pkey" PRIMARY KEY ("deal_id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."income_profiles"
    ADD CONSTRAINT "income_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."organization_profile_settings"
    ADD CONSTRAINT "organization_profile_settings_pkey" PRIMARY KEY ("organization_id");



ALTER TABLE ONLY "public"."organization_role_permissions"
    ADD CONSTRAINT "organization_role_permissions_pkey" PRIMARY KEY ("organization_id", "role", "permission_key");



ALTER TABLE ONLY "public"."organization_settings"
    ADD CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("organization_id", "key");



ALTER TABLE ONLY "public"."organization_user_permission_overrides"
    ADD CONSTRAINT "organization_user_permission_overrides_pkey" PRIMARY KEY ("organization_id", "user_id", "permission_key");



ALTER TABLE ONLY "public"."organization_users"
    ADD CONSTRAINT "organization_users_pkey" PRIMARY KEY ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."trivian_config"
    ADD CONSTRAINT "trivian_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trivian_inventory"
    ADD CONSTRAINT "trivian_inventory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trivian_inventory"
    ADD CONSTRAINT "trivian_inventory_stock_number_key" UNIQUE ("stock_number");



ALTER TABLE ONLY "public"."underwriting_inputs"
    ADD CONSTRAINT "underwriting_inputs_deal_id_key" UNIQUE ("deal_id");



ALTER TABLE ONLY "public"."underwriting_inputs"
    ADD CONSTRAINT "underwriting_inputs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."underwriting_results"
    ADD CONSTRAINT "underwriting_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."underwriting_tier_policy"
    ADD CONSTRAINT "underwriting_tier_policy_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_options"
    ADD CONSTRAINT "vehicle_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_selection"
    ADD CONSTRAINT "vehicle_selection_deal_id_key" UNIQUE ("deal_id");



ALTER TABLE ONLY "public"."vehicle_selection"
    ADD CONSTRAINT "vehicle_selection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_term_policy"
    ADD CONSTRAINT "vehicle_term_policy_pkey" PRIMARY KEY ("id");



CREATE INDEX "app_notifications_organization_user_read_idx" ON "public"."app_notifications" USING "btree" ("organization_id", "user_id", "read_at", "created_at" DESC);



CREATE INDEX "audit_log_deal_idx" ON "public"."audit_log" USING "btree" ("deal_id");



CREATE INDEX "audit_log_organization_created_idx" ON "public"."audit_log" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "bureau_messages_organization_deal_created_at_idx" ON "public"."bureau_messages" USING "btree" ("organization_id", "deal_id", "created_at");



CREATE INDEX "bureau_messages_organization_deal_role_created_at_idx" ON "public"."bureau_messages" USING "btree" ("organization_id", "deal_id", "applicant_role", "created_at");



CREATE INDEX "bureau_messages_organization_summary_idx" ON "public"."bureau_messages" USING "btree" ("organization_id", "bureau_summary_id");



CREATE INDEX "bureau_public_records_organization_deal_created_at_idx" ON "public"."bureau_public_records" USING "btree" ("organization_id", "deal_id", "created_at");



CREATE INDEX "bureau_public_records_organization_deal_role_created_at_idx" ON "public"."bureau_public_records" USING "btree" ("organization_id", "deal_id", "applicant_role", "created_at");



CREATE INDEX "bureau_public_records_organization_summary_idx" ON "public"."bureau_public_records" USING "btree" ("organization_id", "bureau_summary_id");



CREATE INDEX "bureau_summary_organization_credit_report_idx" ON "public"."bureau_summary" USING "btree" ("organization_id", "credit_report_id");



CREATE INDEX "bureau_summary_organization_deal_created_at_idx" ON "public"."bureau_summary" USING "btree" ("organization_id", "deal_id", "created_at" DESC);



CREATE INDEX "bureau_summary_organization_deal_role_created_at_idx" ON "public"."bureau_summary" USING "btree" ("organization_id", "deal_id", "applicant_role", "created_at" DESC);



CREATE INDEX "bureau_tradelines_organization_deal_created_at_idx" ON "public"."bureau_tradelines" USING "btree" ("organization_id", "deal_id", "created_at");



CREATE INDEX "bureau_tradelines_organization_deal_role_created_at_idx" ON "public"."bureau_tradelines" USING "btree" ("organization_id", "deal_id", "applicant_role", "created_at");



CREATE INDEX "bureau_tradelines_organization_summary_idx" ON "public"."bureau_tradelines" USING "btree" ("organization_id", "bureau_summary_id");



CREATE INDEX "credit_report_jobs_organization_deal_created_at_idx" ON "public"."credit_report_jobs" USING "btree" ("organization_id", "deal_id", "created_at" DESC);



CREATE INDEX "credit_report_jobs_organization_deal_role_created_at_idx" ON "public"."credit_report_jobs" USING "btree" ("organization_id", "deal_id", "applicant_role", "created_at" DESC);



CREATE INDEX "credit_report_jobs_organization_status_created_at_idx" ON "public"."credit_report_jobs" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE UNIQUE INDEX "credit_reports_organization_deal_role_uidx" ON "public"."credit_reports" USING "btree" ("organization_id", "deal_id", "applicant_role");



CREATE INDEX "credit_reports_organization_latest_job_idx" ON "public"."credit_reports" USING "btree" ("organization_id", "latest_job_id");



CREATE INDEX "deal_documents_deal_id_idx" ON "public"."deal_documents" USING "btree" ("deal_id");



CREATE INDEX "deal_documents_deal_id_type_idx" ON "public"."deal_documents" USING "btree" ("deal_id", "doc_type");



CREATE INDEX "deal_documents_organization_deal_created_at_idx" ON "public"."deal_documents" USING "btree" ("organization_id", "deal_id", "created_at" DESC);



CREATE INDEX "deal_documents_organization_deal_doc_role_created_at_idx" ON "public"."deal_documents" USING "btree" ("organization_id", "deal_id", "doc_type", "applicant_role", "created_at" DESC);



CREATE INDEX "deal_funding_stip_verifications_deal_idx" ON "public"."deal_funding_stip_verifications" USING "btree" ("organization_id", "deal_id");



CREATE INDEX "deal_override_counter_offers_lookup_idx" ON "public"."deal_override_counter_offers" USING "btree" ("organization_id", "deal_id", "deal_override_request_id", "status", "version_number" DESC);



CREATE UNIQUE INDEX "deal_override_counter_offers_request_version_idx" ON "public"."deal_override_counter_offers" USING "btree" ("deal_override_request_id", "version_number");



CREATE INDEX "deal_override_requests_organization_deal_idx" ON "public"."deal_override_requests" USING "btree" ("organization_id", "deal_id");



CREATE INDEX "deal_override_requests_organization_status_idx" ON "public"."deal_override_requests" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE UNIQUE INDEX "deal_override_requests_pending_fingerprint_uidx" ON "public"."deal_override_requests" USING "btree" ("organization_id", "deal_id", "blocker_code", "structure_fingerprint") WHERE ("status" = 'pending'::"text");



CREATE INDEX "deal_people_deal_id_idx" ON "public"."deal_people" USING "btree" ("deal_id");



CREATE INDEX "deal_people_organization_deal_created_at_idx" ON "public"."deal_people" USING "btree" ("organization_id", "deal_id", "created_at");



CREATE INDEX "deal_people_organization_deal_role_idx" ON "public"."deal_people" USING "btree" ("organization_id", "deal_id", "role");



CREATE UNIQUE INDEX "deal_people_unique_role_per_deal" ON "public"."deal_people" USING "btree" ("deal_id", "role");



CREATE INDEX "deal_structure_inputs_org_idx" ON "public"."deal_structure_inputs" USING "btree" ("organization_id", "deal_id");



CREATE INDEX "deal_structure_organization_deal_idx" ON "public"."deal_structure" USING "btree" ("organization_id", "deal_id");



CREATE INDEX "deal_vehicle_selection_organization_deal_idx" ON "public"."deal_vehicle_selection" USING "btree" ("organization_id", "deal_id");



CREATE UNIQUE INDEX "deals_approval_number_unique" ON "public"."deals" USING "btree" ("approval_number");



CREATE INDEX "deals_organization_id_idx" ON "public"."deals" USING "btree" ("organization_id");



CREATE INDEX "deals_organization_updated_at_idx" ON "public"."deals" USING "btree" ("organization_id", "updated_at" DESC);



CREATE INDEX "documents_deal_id_idx" ON "public"."documents" USING "btree" ("deal_id");



CREATE INDEX "documents_type_idx" ON "public"."documents" USING "btree" ("document_type");



CREATE INDEX "idx_bureau_messages_bureau_summary_id" ON "public"."bureau_messages" USING "btree" ("bureau_summary_id");



CREATE INDEX "idx_bureau_messages_deal_id" ON "public"."bureau_messages" USING "btree" ("deal_id");



CREATE INDEX "idx_bureau_public_records_bureau_summary_id" ON "public"."bureau_public_records" USING "btree" ("bureau_summary_id");



CREATE INDEX "idx_bureau_public_records_deal_id" ON "public"."bureau_public_records" USING "btree" ("deal_id");



CREATE INDEX "idx_bureau_summary_credit_report_id" ON "public"."bureau_summary" USING "btree" ("credit_report_id");



CREATE INDEX "idx_bureau_summary_deal_id" ON "public"."bureau_summary" USING "btree" ("deal_id");



CREATE INDEX "idx_bureau_summary_job_id" ON "public"."bureau_summary" USING "btree" ("job_id");



CREATE INDEX "idx_bureau_tradelines_bureau_summary_id" ON "public"."bureau_tradelines" USING "btree" ("bureau_summary_id");



CREATE INDEX "idx_bureau_tradelines_deal_id" ON "public"."bureau_tradelines" USING "btree" ("deal_id");



CREATE INDEX "idx_credit_jobs_deal_id" ON "public"."credit_report_jobs" USING "btree" ("deal_id");



CREATE INDEX "idx_credit_jobs_locked_at" ON "public"."credit_report_jobs" USING "btree" ("locked_at");



CREATE INDEX "idx_credit_jobs_status" ON "public"."credit_report_jobs" USING "btree" ("status");



CREATE INDEX "idx_credit_reports_deal_id" ON "public"."credit_reports" USING "btree" ("deal_id");



CREATE INDEX "idx_credit_reports_latest_job_id" ON "public"."credit_reports" USING "btree" ("latest_job_id");



CREATE INDEX "idx_deal_vehicle_selection_vehicle_id" ON "public"."deal_vehicle_selection" USING "btree" ("vehicle_id");



CREATE INDEX "idx_trivian_inventory_stock" ON "public"."trivian_inventory" USING "btree" ("stock_number");



CREATE INDEX "income_profiles_organization_deal_person_created_at_idx" ON "public"."income_profiles" USING "btree" ("organization_id", "deal_person_id", "created_at");



CREATE INDEX "income_profiles_person_idx" ON "public"."income_profiles" USING "btree" ("deal_person_id");



CREATE UNIQUE INDEX "one_co_per_deal" ON "public"."deal_people" USING "btree" ("deal_id") WHERE ("role" = 'co'::"public"."person_role");



CREATE UNIQUE INDEX "one_primary_per_deal" ON "public"."deal_people" USING "btree" ("deal_id") WHERE ("role" = 'primary'::"public"."person_role");



CREATE INDEX "organization_invitations_organization_status_idx" ON "public"."organization_invitations" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE UNIQUE INDEX "organization_invitations_pending_email_uidx" ON "public"."organization_invitations" USING "btree" ("organization_id", "lower"("email")) WHERE ("status" = 'pending'::"text");



CREATE INDEX "organization_invitations_token_hash_idx" ON "public"."organization_invitations" USING "btree" ("token_hash");



CREATE INDEX "organization_profile_settings_updated_idx" ON "public"."organization_profile_settings" USING "btree" ("organization_id", "updated_at" DESC);



CREATE INDEX "organization_settings_key_idx" ON "public"."organization_settings" USING "btree" ("organization_id", "key");



CREATE INDEX "organization_user_permission_overrides_user_idx" ON "public"."organization_user_permission_overrides" USING "btree" ("organization_id", "user_id");



CREATE UNIQUE INDEX "organization_users_organization_user_uidx" ON "public"."organization_users" USING "btree" ("organization_id", "user_id");



CREATE INDEX "organization_users_role_idx" ON "public"."organization_users" USING "btree" ("organization_id", "role") WHERE ("is_active" = true);



CREATE INDEX "organization_users_user_id_idx" ON "public"."organization_users" USING "btree" ("user_id");



CREATE UNIQUE INDEX "organizations_slug_uidx" ON "public"."organizations" USING "btree" ("slug");



CREATE INDEX "trivian_config_organization_created_at_idx" ON "public"."trivian_config" USING "btree" ("organization_id", "created_at" DESC);



CREATE UNIQUE INDEX "trivian_config_organization_uidx" ON "public"."trivian_config" USING "btree" ("organization_id") WHERE ("organization_id" IS NOT NULL);



CREATE INDEX "trivian_inventory_organization_date_in_stock_idx" ON "public"."trivian_inventory" USING "btree" ("organization_id", "date_in_stock", "id");



CREATE INDEX "trivian_inventory_organization_status_date_in_stock_idx" ON "public"."trivian_inventory" USING "btree" ("organization_id", "status", "date_in_stock");



CREATE UNIQUE INDEX "trivian_inventory_stock_number_uq" ON "public"."trivian_inventory" USING "btree" ("stock_number");



CREATE INDEX "underwriting_inputs_organization_deal_idx" ON "public"."underwriting_inputs" USING "btree" ("organization_id", "deal_id");



CREATE UNIQUE INDEX "underwriting_results_deal_id_stage_uidx" ON "public"."underwriting_results" USING "btree" ("deal_id", "stage");



CREATE INDEX "underwriting_results_organization_deal_stage_idx" ON "public"."underwriting_results" USING "btree" ("organization_id", "deal_id", "stage");



CREATE INDEX "underwriting_tier_policy_organization_tier_active_sort_idx" ON "public"."underwriting_tier_policy" USING "btree" ("organization_id", "tier", "active", "sort_order");



CREATE UNIQUE INDEX "underwriting_tier_policy_organization_tier_uidx" ON "public"."underwriting_tier_policy" USING "btree" ("organization_id", "tier");



CREATE UNIQUE INDEX "uq_bureau_summary_credit_report_id" ON "public"."bureau_summary" USING "btree" ("credit_report_id") WHERE ("credit_report_id" IS NOT NULL);



CREATE INDEX "vehicle_options_deal_idx" ON "public"."vehicle_options" USING "btree" ("deal_id");



CREATE INDEX "vehicle_selection_option_idx" ON "public"."vehicle_selection" USING "btree" ("vehicle_option_id");



CREATE INDEX "vehicle_term_policy_organization_active_sort_idx" ON "public"."vehicle_term_policy" USING "btree" ("organization_id", "active", "sort_order");



CREATE OR REPLACE TRIGGER "deal_vehicle_selection_updated_at" BEFORE UPDATE ON "public"."deal_vehicle_selection" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "deals_updated_at" BEFORE UPDATE ON "public"."deals" FOR EACH ROW EXECUTE FUNCTION "public"."update_timestamp"();



CREATE OR REPLACE TRIGGER "income_profiles_updated_at" BEFORE UPDATE ON "public"."income_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "organization_users_set_updated_at" BEFORE UPDATE ON "public"."organization_users" FOR EACH ROW EXECUTE FUNCTION "public"."set_current_timestamp_updated_at"();



CREATE OR REPLACE TRIGGER "organizations_set_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_current_timestamp_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bureau_summary_updated" BEFORE UPDATE ON "public"."bureau_summary" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_credit_jobs_updated_at" BEFORE UPDATE ON "public"."credit_report_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_credit_reports_updated_at" BEFORE UPDATE ON "public"."credit_reports" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_deal_structure_set_updated_at" BEFORE UPDATE ON "public"."deal_structure" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_force_credit_job_queued" BEFORE INSERT ON "public"."credit_report_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."force_credit_job_queued"();



CREATE OR REPLACE TRIGGER "trg_set_deal_owner" BEFORE INSERT ON "public"."deals" FOR EACH ROW EXECUTE FUNCTION "public"."set_deal_owner"();



CREATE OR REPLACE TRIGGER "trg_set_trivian_inventory_vehicle_category" BEFORE INSERT OR UPDATE OF "body_type" ON "public"."trivian_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."set_trivian_inventory_vehicle_category"();



CREATE OR REPLACE TRIGGER "trg_trivian_config_updated" BEFORE UPDATE ON "public"."trivian_config" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_trivian_inventory_updated" BEFORE UPDATE ON "public"."trivian_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_underwriting_inputs_updated_at" BEFORE UPDATE ON "public"."underwriting_inputs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "user_profiles_set_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "vehicle_selection_updated_at" BEFORE UPDATE ON "public"."vehicle_selection" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."app_notifications"
    ADD CONSTRAINT "app_notifications_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_notifications"
    ADD CONSTRAINT "app_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_notifications"
    ADD CONSTRAINT "app_notifications_override_request_id_fkey" FOREIGN KEY ("override_request_id") REFERENCES "public"."deal_override_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_notifications"
    ADD CONSTRAINT "app_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bureau_messages"
    ADD CONSTRAINT "bureau_messages_bureau_summary_id_fkey" FOREIGN KEY ("bureau_summary_id") REFERENCES "public"."bureau_summary"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bureau_messages"
    ADD CONSTRAINT "bureau_messages_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bureau_messages"
    ADD CONSTRAINT "bureau_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."bureau_public_records"
    ADD CONSTRAINT "bureau_public_records_bureau_summary_id_fkey" FOREIGN KEY ("bureau_summary_id") REFERENCES "public"."bureau_summary"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bureau_public_records"
    ADD CONSTRAINT "bureau_public_records_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bureau_public_records"
    ADD CONSTRAINT "bureau_public_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."bureau_summary"
    ADD CONSTRAINT "bureau_summary_credit_report_id_fkey" FOREIGN KEY ("credit_report_id") REFERENCES "public"."credit_reports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bureau_summary"
    ADD CONSTRAINT "bureau_summary_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bureau_summary"
    ADD CONSTRAINT "bureau_summary_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."credit_report_jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bureau_summary"
    ADD CONSTRAINT "bureau_summary_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."bureau_tradelines"
    ADD CONSTRAINT "bureau_tradelines_bureau_summary_id_fkey" FOREIGN KEY ("bureau_summary_id") REFERENCES "public"."bureau_summary"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bureau_tradelines"
    ADD CONSTRAINT "bureau_tradelines_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bureau_tradelines"
    ADD CONSTRAINT "bureau_tradelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."credit_report_jobs"
    ADD CONSTRAINT "credit_report_jobs_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_report_jobs"
    ADD CONSTRAINT "credit_report_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."credit_report_jobs"
    ADD CONSTRAINT "credit_report_jobs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."credit_reports"
    ADD CONSTRAINT "credit_reports_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credit_reports"
    ADD CONSTRAINT "credit_reports_latest_job_id_fkey" FOREIGN KEY ("latest_job_id") REFERENCES "public"."credit_report_jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."credit_reports"
    ADD CONSTRAINT "credit_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."deal_documents"
    ADD CONSTRAINT "deal_documents_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_documents"
    ADD CONSTRAINT "deal_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."deal_funding_stip_verifications"
    ADD CONSTRAINT "deal_funding_stip_verifications_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_funding_stip_verifications"
    ADD CONSTRAINT "deal_funding_stip_verifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_funding_stip_verifications"
    ADD CONSTRAINT "deal_funding_stip_verifications_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deal_management_notes"
    ADD CONSTRAINT "deal_management_notes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_override_counter_offers"
    ADD CONSTRAINT "deal_override_counter_offers_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_override_counter_offers"
    ADD CONSTRAINT "deal_override_counter_offers_deal_override_request_id_fkey" FOREIGN KEY ("deal_override_request_id") REFERENCES "public"."deal_override_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_override_counter_offers"
    ADD CONSTRAINT "deal_override_counter_offers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_override_requests"
    ADD CONSTRAINT "deal_override_requests_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_override_requests"
    ADD CONSTRAINT "deal_override_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_override_requests"
    ADD CONSTRAINT "deal_override_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deal_override_requests"
    ADD CONSTRAINT "deal_override_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deal_people"
    ADD CONSTRAINT "deal_people_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_people"
    ADD CONSTRAINT "deal_people_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."deal_structure"
    ADD CONSTRAINT "deal_structure_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_structure_inputs"
    ADD CONSTRAINT "deal_structure_inputs_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_structure_inputs"
    ADD CONSTRAINT "deal_structure_inputs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_structure_inputs"
    ADD CONSTRAINT "deal_structure_inputs_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."trivian_inventory"("id");



ALTER TABLE ONLY "public"."deal_structure"
    ADD CONSTRAINT "deal_structure_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."deal_vehicle_selection"
    ADD CONSTRAINT "deal_vehicle_selection_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deal_vehicle_selection"
    ADD CONSTRAINT "deal_vehicle_selection_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."deal_vehicle_selection"
    ADD CONSTRAINT "deal_vehicle_selection_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."trivian_inventory"("id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."income_profiles"
    ADD CONSTRAINT "income_profiles_deal_person_id_fkey" FOREIGN KEY ("deal_person_id") REFERENCES "public"."deal_people"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."income_profiles"
    ADD CONSTRAINT "income_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_profile_settings"
    ADD CONSTRAINT "organization_profile_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_role_permissions"
    ADD CONSTRAINT "organization_role_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_settings"
    ADD CONSTRAINT "organization_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_user_permission_overrides"
    ADD CONSTRAINT "organization_user_permission_overrides_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_user_permission_overrides"
    ADD CONSTRAINT "organization_user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_users"
    ADD CONSTRAINT "organization_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_users"
    ADD CONSTRAINT "organization_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trivian_config"
    ADD CONSTRAINT "trivian_config_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."trivian_inventory"
    ADD CONSTRAINT "trivian_inventory_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."underwriting_inputs"
    ADD CONSTRAINT "underwriting_inputs_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."underwriting_inputs"
    ADD CONSTRAINT "underwriting_inputs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."underwriting_inputs"
    ADD CONSTRAINT "underwriting_inputs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."underwriting_results"
    ADD CONSTRAINT "underwriting_results_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."underwriting_results"
    ADD CONSTRAINT "underwriting_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."underwriting_results"
    ADD CONSTRAINT "underwriting_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."underwriting_tier_policy"
    ADD CONSTRAINT "underwriting_tier_policy_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_options"
    ADD CONSTRAINT "vehicle_options_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_selection"
    ADD CONSTRAINT "vehicle_selection_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_selection"
    ADD CONSTRAINT "vehicle_selection_selected_by_fkey" FOREIGN KEY ("selected_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vehicle_selection"
    ADD CONSTRAINT "vehicle_selection_vehicle_option_id_fkey" FOREIGN KEY ("vehicle_option_id") REFERENCES "public"."vehicle_options"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."vehicle_term_policy"
    ADD CONSTRAINT "vehicle_term_policy_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



CREATE POLICY "Admins can manage underwriting results" ON "public"."underwriting_results" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can read all profiles" ON "public"."profiles" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can update all deals" ON "public"."deals" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Admins can update all documents" ON "public"."documents" FOR UPDATE USING ("public"."is_admin"());



CREATE POLICY "Admins can view all deals" ON "public"."deals" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can view all documents" ON "public"."documents" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Users can insert own documents" ON "public"."documents" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own deals" ON "public"."deals" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own underwriting inputs" ON "public"."underwriting_inputs" USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"())) WITH CHECK ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "Users can read own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own deals" ON "public"."deals" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own documents" ON "public"."documents" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own underwriting results" ON "public"."underwriting_results" FOR SELECT USING ((("auth"."uid"() = "user_id") OR "public"."is_admin"()));



CREATE POLICY "Users can view their own deals" ON "public"."deals" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "admin and dev can insert app settings" ON "public"."app_settings" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_app_role"() = ANY (ARRAY['admin'::"text", 'dev'::"text"])));



CREATE POLICY "admin and dev can insert user profiles" ON "public"."user_profiles" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_app_role"() = ANY (ARRAY['admin'::"text", 'dev'::"text"])));



CREATE POLICY "admin and dev can read all user profiles" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING (("public"."current_app_role"() = ANY (ARRAY['admin'::"text", 'dev'::"text"])));



CREATE POLICY "admin and dev can update app settings" ON "public"."app_settings" FOR UPDATE TO "authenticated" USING (("public"."current_app_role"() = ANY (ARRAY['admin'::"text", 'dev'::"text"]))) WITH CHECK (("public"."current_app_role"() = ANY (ARRAY['admin'::"text", 'dev'::"text"])));



CREATE POLICY "admin and dev can update user profiles" ON "public"."user_profiles" FOR UPDATE TO "authenticated" USING (("public"."current_app_role"() = ANY (ARRAY['admin'::"text", 'dev'::"text"]))) WITH CHECK (("public"."current_app_role"() = ANY (ARRAY['admin'::"text", 'dev'::"text"])));



ALTER TABLE "public"."app_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_notifications_select_owner" ON "public"."app_notifications" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."atlas_is_active_organization_member"("organization_id")));



CREATE POLICY "app_notifications_update_owner" ON "public"."app_notifications" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."atlas_is_active_organization_member"("organization_id"))) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."atlas_is_active_organization_member"("organization_id")));



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_all_authenticated" ON "public"."audit_log" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "audit_log_select_org_members" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((("organization_id" IS NULL) OR "public"."atlas_is_active_organization_member"("organization_id")));



CREATE POLICY "authenticated users can read app settings" ON "public"."app_settings" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."bureau_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bureau_messages_delete_active_members" ON "public"."bureau_messages" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_messages_insert_active_members" ON "public"."bureau_messages" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."bureau_summary" "bs"
  WHERE (("bs"."id" = "bureau_messages"."bureau_summary_id") AND ("bs"."deal_id" = "bureau_messages"."deal_id") AND ("bs"."organization_id" = "bureau_messages"."organization_id") AND ("bs"."applicant_role" = "bureau_messages"."applicant_role"))))));



CREATE POLICY "bureau_messages_select_active_members" ON "public"."bureau_messages" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_messages_update_active_members" ON "public"."bureau_messages" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."bureau_summary" "bs"
  WHERE (("bs"."id" = "bureau_messages"."bureau_summary_id") AND ("bs"."deal_id" = "bureau_messages"."deal_id") AND ("bs"."organization_id" = "bureau_messages"."organization_id") AND ("bs"."applicant_role" = "bureau_messages"."applicant_role"))))));



ALTER TABLE "public"."bureau_public_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bureau_public_records_delete_active_members" ON "public"."bureau_public_records" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_public_records_insert_active_members" ON "public"."bureau_public_records" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."bureau_summary" "bs"
  WHERE (("bs"."id" = "bureau_public_records"."bureau_summary_id") AND ("bs"."deal_id" = "bureau_public_records"."deal_id") AND ("bs"."organization_id" = "bureau_public_records"."organization_id") AND ("bs"."applicant_role" = "bureau_public_records"."applicant_role"))))));



CREATE POLICY "bureau_public_records_select_active_members" ON "public"."bureau_public_records" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_public_records_update_active_members" ON "public"."bureau_public_records" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."bureau_summary" "bs"
  WHERE (("bs"."id" = "bureau_public_records"."bureau_summary_id") AND ("bs"."deal_id" = "bureau_public_records"."deal_id") AND ("bs"."organization_id" = "bureau_public_records"."organization_id") AND ("bs"."applicant_role" = "bureau_public_records"."applicant_role"))))));



ALTER TABLE "public"."bureau_summary" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bureau_summary_delete_active_members" ON "public"."bureau_summary" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_summary_insert_active_members" ON "public"."bureau_summary" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."credit_reports" "cr"
  WHERE (("cr"."id" = "bureau_summary"."credit_report_id") AND ("cr"."deal_id" = "bureau_summary"."deal_id") AND ("cr"."organization_id" = "bureau_summary"."organization_id") AND ("cr"."applicant_role" = "bureau_summary"."applicant_role")))) AND (("job_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."credit_report_jobs" "crj"
  WHERE (("crj"."id" = "bureau_summary"."job_id") AND ("crj"."deal_id" = "bureau_summary"."deal_id") AND ("crj"."organization_id" = "bureau_summary"."organization_id") AND ("crj"."applicant_role" = "bureau_summary"."applicant_role")))))));



CREATE POLICY "bureau_summary_select_active_members" ON "public"."bureau_summary" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_summary_update_active_members" ON "public"."bureau_summary" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."credit_reports" "cr"
  WHERE (("cr"."id" = "bureau_summary"."credit_report_id") AND ("cr"."deal_id" = "bureau_summary"."deal_id") AND ("cr"."organization_id" = "bureau_summary"."organization_id") AND ("cr"."applicant_role" = "bureau_summary"."applicant_role")))) AND (("job_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."credit_report_jobs" "crj"
  WHERE (("crj"."id" = "bureau_summary"."job_id") AND ("crj"."deal_id" = "bureau_summary"."deal_id") AND ("crj"."organization_id" = "bureau_summary"."organization_id") AND ("crj"."applicant_role" = "bureau_summary"."applicant_role")))))));



ALTER TABLE "public"."bureau_tradelines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bureau_tradelines_delete_active_members" ON "public"."bureau_tradelines" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_tradelines_insert_active_members" ON "public"."bureau_tradelines" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."bureau_summary" "bs"
  WHERE (("bs"."id" = "bureau_tradelines"."bureau_summary_id") AND ("bs"."deal_id" = "bureau_tradelines"."deal_id") AND ("bs"."organization_id" = "bureau_tradelines"."organization_id") AND ("bs"."applicant_role" = "bureau_tradelines"."applicant_role"))))));



CREATE POLICY "bureau_tradelines_select_active_members" ON "public"."bureau_tradelines" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "bureau_tradelines_update_active_members" ON "public"."bureau_tradelines" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."bureau_summary" "bs"
  WHERE (("bs"."id" = "bureau_tradelines"."bureau_summary_id") AND ("bs"."deal_id" = "bureau_tradelines"."deal_id") AND ("bs"."organization_id" = "bureau_tradelines"."organization_id") AND ("bs"."applicant_role" = "bureau_tradelines"."applicant_role"))))));



CREATE POLICY "config_read" ON "public"."trivian_config" FOR SELECT USING ((("auth"."jwt"() ->> 'role'::"text") = ANY (ARRAY['admin'::"text", 'manager'::"text"])));



CREATE POLICY "config_update" ON "public"."trivian_config" FOR UPDATE USING ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text")) WITH CHECK ((("auth"."jwt"() ->> 'role'::"text") = 'admin'::"text"));



ALTER TABLE "public"."credit_report_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_report_jobs_delete_active_members" ON "public"."credit_report_jobs" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "credit_report_jobs_insert_active_members" ON "public"."credit_report_jobs" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "credit_report_jobs"."deal_id") AND ("d"."organization_id" = "credit_report_jobs"."organization_id"))))));



CREATE POLICY "credit_report_jobs_select_active_members" ON "public"."credit_report_jobs" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "credit_report_jobs_update_active_members" ON "public"."credit_report_jobs" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "credit_report_jobs"."deal_id") AND ("d"."organization_id" = "credit_report_jobs"."organization_id"))))));



ALTER TABLE "public"."credit_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_reports_delete_active_members" ON "public"."credit_reports" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "credit_reports_insert_active_members" ON "public"."credit_reports" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "credit_reports"."deal_id") AND ("d"."organization_id" = "credit_reports"."organization_id")))) AND (("latest_job_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."credit_report_jobs" "crj"
  WHERE (("crj"."id" = "credit_reports"."latest_job_id") AND ("crj"."deal_id" = "credit_reports"."deal_id") AND ("crj"."organization_id" = "credit_reports"."organization_id") AND ("crj"."applicant_role" = "credit_reports"."applicant_role")))))));



CREATE POLICY "credit_reports_select_active_members" ON "public"."credit_reports" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "credit_reports_update_active_members" ON "public"."credit_reports" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "credit_reports"."deal_id") AND ("d"."organization_id" = "credit_reports"."organization_id")))) AND (("latest_job_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."credit_report_jobs" "crj"
  WHERE (("crj"."id" = "credit_reports"."latest_job_id") AND ("crj"."deal_id" = "credit_reports"."deal_id") AND ("crj"."organization_id" = "credit_reports"."organization_id") AND ("crj"."applicant_role" = "credit_reports"."applicant_role")))))));



ALTER TABLE "public"."deal_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_documents_delete_active_members" ON "public"."deal_documents" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."atlas_is_active_organization_member"("organization_id")));



CREATE POLICY "deal_documents_insert_active_members" ON "public"."deal_documents" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."atlas_is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_documents"."deal_id") AND ("d"."organization_id" = "deal_documents"."organization_id")))) AND (("doc_type" <> 'credit_bureau'::"text") OR ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))));



CREATE POLICY "deal_documents_select_active_members" ON "public"."deal_documents" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."atlas_is_active_organization_member"("organization_id")));



CREATE POLICY "deal_documents_update_active_members" ON "public"."deal_documents" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."atlas_is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."atlas_is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_documents"."deal_id") AND ("d"."organization_id" = "deal_documents"."organization_id")))) AND (("doc_type" <> 'credit_bureau'::"text") OR ("applicant_role" = ANY (ARRAY['primary'::"text", 'co'::"text"])))));



ALTER TABLE "public"."deal_funding_stip_verifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_funding_stip_verifications_select_org_members" ON "public"."deal_funding_stip_verifications" FOR SELECT TO "authenticated" USING ("public"."atlas_is_active_organization_member"("organization_id"));



ALTER TABLE "public"."deal_override_counter_offers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_override_counter_offers_select_org_members" ON "public"."deal_override_counter_offers" FOR SELECT TO "authenticated" USING ("public"."atlas_is_active_organization_member"("organization_id"));



ALTER TABLE "public"."deal_override_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_override_requests_insert_org_members" ON "public"."deal_override_requests" FOR INSERT TO "authenticated" WITH CHECK (("public"."atlas_is_active_organization_member"("organization_id") AND ("requested_by" = "auth"."uid"())));



CREATE POLICY "deal_override_requests_select_org_members" ON "public"."deal_override_requests" FOR SELECT TO "authenticated" USING ("public"."atlas_is_active_organization_member"("organization_id"));



CREATE POLICY "deal_override_requests_update_override_authority" ON "public"."deal_override_requests" FOR UPDATE TO "authenticated" USING ("public"."atlas_has_deal_override_authority"("organization_id")) WITH CHECK ("public"."atlas_has_deal_override_authority"("organization_id"));



ALTER TABLE "public"."deal_people" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_people_all_authenticated" ON "public"."deal_people" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "deal_people_delete_active_members" ON "public"."deal_people" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deal_people_insert_active_members" ON "public"."deal_people" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_people"."deal_id") AND ("d"."organization_id" = "deal_people"."organization_id"))))));



CREATE POLICY "deal_people_insert_anon_dev" ON "public"."deal_people" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "deal_people_insert_auth" ON "public"."deal_people" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "deal_people_select_active_members" ON "public"."deal_people" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deal_people_select_auth" ON "public"."deal_people" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "deal_people_update_active_members" ON "public"."deal_people" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_people"."deal_id") AND ("d"."organization_id" = "deal_people"."organization_id"))))));



CREATE POLICY "deal_people_update_auth" ON "public"."deal_people" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."deal_structure" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_structure_delete_active_members" ON "public"."deal_structure" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deal_structure_insert_active_members" ON "public"."deal_structure" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_structure"."deal_id") AND ("d"."organization_id" = "deal_structure"."organization_id"))))));



CREATE POLICY "deal_structure_select_active_members" ON "public"."deal_structure" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deal_structure_update_active_members" ON "public"."deal_structure" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_structure"."deal_id") AND ("d"."organization_id" = "deal_structure"."organization_id"))))));



ALTER TABLE "public"."deal_vehicle_selection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deal_vehicle_selection_delete_active_members" ON "public"."deal_vehicle_selection" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deal_vehicle_selection_insert_active_members" ON "public"."deal_vehicle_selection" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_vehicle_selection"."deal_id") AND ("d"."organization_id" = "deal_vehicle_selection"."organization_id"))))));



CREATE POLICY "deal_vehicle_selection_select_active_members" ON "public"."deal_vehicle_selection" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deal_vehicle_selection_update_active_members" ON "public"."deal_vehicle_selection" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "deal_vehicle_selection"."deal_id") AND ("d"."organization_id" = "deal_vehicle_selection"."organization_id"))))));



ALTER TABLE "public"."deals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deals_all_authenticated" ON "public"."deals" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "deals_delete_active_members" ON "public"."deals" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deals_insert_active_members" ON "public"."deals" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deals_insert_anon_dev" ON "public"."deals" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "deals_insert_auth" ON "public"."deals" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "deals_select_active_members" ON "public"."deals" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deals_select_auth" ON "public"."deals" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "deals_update_active_members" ON "public"."deals" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "deals_update_auth" ON "public"."deals" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "documents_all_authenticated" ON "public"."documents" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."income_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "income_profiles_all_authenticated" ON "public"."income_profiles" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "income_profiles_delete_active_members" ON "public"."income_profiles" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "income_profiles_insert_active_members" ON "public"."income_profiles" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM ("public"."deal_people" "dp"
     JOIN "public"."deals" "d" ON (("d"."id" = "dp"."deal_id")))
  WHERE (("dp"."id" = "income_profiles"."deal_person_id") AND ("d"."organization_id" = "income_profiles"."organization_id"))))));



CREATE POLICY "income_profiles_insert_anon_dev" ON "public"."income_profiles" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "income_profiles_insert_auth" ON "public"."income_profiles" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "income_profiles_select_active_members" ON "public"."income_profiles" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "income_profiles_select_auth" ON "public"."income_profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "income_profiles_update_active_members" ON "public"."income_profiles" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM ("public"."deal_people" "dp"
     JOIN "public"."deals" "d" ON (("d"."id" = "dp"."deal_id")))
  WHERE (("dp"."id" = "income_profiles"."deal_person_id") AND ("d"."organization_id" = "income_profiles"."organization_id"))))));



CREATE POLICY "income_profiles_update_auth" ON "public"."income_profiles" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "insert_own_credit_jobs" ON "public"."credit_report_jobs" FOR INSERT TO "authenticated" WITH CHECK ((("uploaded_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "credit_report_jobs"."deal_id") AND ("d"."user_id" = "auth"."uid"()))))));



CREATE POLICY "insert_own_deals" ON "public"."deals" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."organization_invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_invitations_select_self" ON "public"."organization_invitations" FOR SELECT TO "authenticated" USING (("lower"("email") = "lower"(COALESCE(("auth"."jwt"() ->> 'email'::"text"), ''::"text"))));



ALTER TABLE "public"."organization_profile_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_profile_settings_select_org_members" ON "public"."organization_profile_settings" FOR SELECT TO "authenticated" USING ("public"."atlas_is_active_organization_member"("organization_id"));



ALTER TABLE "public"."organization_role_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_role_permissions_select_org_members" ON "public"."organization_role_permissions" FOR SELECT TO "authenticated" USING ("public"."atlas_is_active_organization_member"("organization_id"));



ALTER TABLE "public"."organization_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_settings_manage_admins" ON "public"."organization_settings" TO "authenticated" USING ("public"."has_organization_role"("organization_id", ARRAY['admin'::"text", 'dev'::"text"])) WITH CHECK ("public"."has_organization_role"("organization_id", ARRAY['admin'::"text", 'dev'::"text"]));



CREATE POLICY "organization_settings_select_active_members" ON "public"."organization_settings" FOR SELECT TO "authenticated" USING ("public"."is_active_organization_member"("organization_id"));



CREATE POLICY "organization_settings_select_org_members" ON "public"."organization_settings" FOR SELECT TO "authenticated" USING ("public"."atlas_is_active_organization_member"("organization_id"));



ALTER TABLE "public"."organization_user_permission_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_user_permission_overrides_select_org_members" ON "public"."organization_user_permission_overrides" FOR SELECT TO "authenticated" USING ("public"."atlas_is_active_organization_member"("organization_id"));



ALTER TABLE "public"."organization_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_users_manage_org_admins" ON "public"."organization_users" TO "authenticated" USING ("public"."has_organization_role"("organization_id", ARRAY['admin'::"text", 'dev'::"text"])) WITH CHECK ("public"."has_organization_role"("organization_id", ARRAY['admin'::"text", 'dev'::"text"]));



CREATE POLICY "organization_users_select_self_or_org_admins" ON "public"."organization_users" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."has_organization_role"("organization_id", ARRAY['admin'::"text", 'dev'::"text"])));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_select_active_memberships" ON "public"."organizations" FOR SELECT TO "authenticated" USING ((("is_active" = true) AND "public"."is_active_organization_member"("id")));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "select_own_credit_jobs" ON "public"."credit_report_jobs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "credit_report_jobs"."deal_id") AND ("d"."user_id" = "auth"."uid"())))));



CREATE POLICY "select_own_credit_reports" ON "public"."credit_reports" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "credit_reports"."deal_id") AND ("d"."user_id" = "auth"."uid"())))));



CREATE POLICY "select_own_deals" ON "public"."deals" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."trivian_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trivian_config_delete_active_members" ON "public"."trivian_config" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "trivian_config_insert_active_members" ON "public"."trivian_config" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "trivian_config_select_active_members" ON "public"."trivian_config" FOR SELECT TO "authenticated" USING ((("organization_id" IS NULL) OR "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "trivian_config_update_active_members" ON "public"."trivian_config" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



ALTER TABLE "public"."trivian_inventory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trivian_inventory_delete_active_members" ON "public"."trivian_inventory" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "trivian_inventory_insert_active_members" ON "public"."trivian_inventory" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "trivian_inventory_select_active_members" ON "public"."trivian_inventory" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "trivian_inventory_update_active_members" ON "public"."trivian_inventory" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



ALTER TABLE "public"."underwriting_inputs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "underwriting_inputs_delete_active_members" ON "public"."underwriting_inputs" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "underwriting_inputs_insert_active_members" ON "public"."underwriting_inputs" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "underwriting_inputs"."deal_id") AND ("d"."organization_id" = "underwriting_inputs"."organization_id"))))));



CREATE POLICY "underwriting_inputs_select_active_members" ON "public"."underwriting_inputs" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "underwriting_inputs_update_active_members" ON "public"."underwriting_inputs" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "underwriting_inputs"."deal_id") AND ("d"."organization_id" = "underwriting_inputs"."organization_id"))))));



ALTER TABLE "public"."underwriting_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "underwriting_results_delete_active_members" ON "public"."underwriting_results" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "underwriting_results_insert_active_members" ON "public"."underwriting_results" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "underwriting_results"."deal_id") AND ("d"."organization_id" = "underwriting_results"."organization_id"))))));



CREATE POLICY "underwriting_results_select_active_members" ON "public"."underwriting_results" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "underwriting_results_update_active_members" ON "public"."underwriting_results" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id") AND (EXISTS ( SELECT 1
   FROM "public"."deals" "d"
  WHERE (("d"."id" = "underwriting_results"."deal_id") AND ("d"."organization_id" = "underwriting_results"."organization_id"))))));



ALTER TABLE "public"."underwriting_tier_policy" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "underwriting_tier_policy_delete_active_members" ON "public"."underwriting_tier_policy" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "underwriting_tier_policy_insert_active_members" ON "public"."underwriting_tier_policy" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "underwriting_tier_policy_select_active_members" ON "public"."underwriting_tier_policy" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "underwriting_tier_policy_update_active_members" ON "public"."underwriting_tier_policy" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "update_own_credit_jobs" ON "public"."credit_report_jobs" FOR UPDATE TO "authenticated" USING (("uploaded_by" = "auth"."uid"())) WITH CHECK (("uploaded_by" = "auth"."uid"()));



ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users can read own user profile" ON "public"."user_profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."vehicle_options" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicle_options_all_authenticated" ON "public"."vehicle_options" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."vehicle_selection" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicle_selection_all_authenticated" ON "public"."vehicle_selection" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."vehicle_term_policy" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vehicle_term_policy_delete_active_members" ON "public"."vehicle_term_policy" FOR DELETE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "vehicle_term_policy_insert_active_members" ON "public"."vehicle_term_policy" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "vehicle_term_policy_select_active_members" ON "public"."vehicle_term_policy" FOR SELECT TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



CREATE POLICY "vehicle_term_policy_update_active_members" ON "public"."vehicle_term_policy" FOR UPDATE TO "authenticated" USING ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id"))) WITH CHECK ((("organization_id" IS NOT NULL) AND "public"."is_active_organization_member"("organization_id")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."atlas_dashboard_metrics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."atlas_dashboard_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."atlas_dashboard_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."atlas_dashboard_metrics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."atlas_has_deal_override_authority"("target_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."atlas_has_deal_override_authority"("target_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atlas_has_deal_override_authority"("target_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."atlas_is_active_organization_member"("target_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."atlas_is_active_organization_member"("target_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atlas_is_active_organization_member"("target_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."bhph_evaluate_bureau"("p_deal_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."bhph_evaluate_bureau"("p_deal_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bhph_evaluate_bureau"("p_deal_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text", "p_organization_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text", "p_organization_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_deal_with_seed_data"("p_customer_name" "text", "p_organization_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."current_app_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_app_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_app_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."force_credit_job_queued"() TO "anon";
GRANT ALL ON FUNCTION "public"."force_credit_job_queued"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."force_credit_job_queued"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_organization_role"("p_organization_id" "uuid", "p_roles" "text"[], "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."has_organization_role"("p_organization_id" "uuid", "p_roles" "text"[], "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_organization_role"("p_organization_id" "uuid", "p_roles" "text"[], "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_organization_member"("p_organization_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_organization_member"("p_organization_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_organization_member"("p_organization_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_current_timestamp_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_current_timestamp_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_current_timestamp_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_deal_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_deal_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_deal_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_trivian_inventory_vehicle_category"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_trivian_inventory_vehicle_category"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_trivian_inventory_vehicle_category"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_amount_financed"("vehicle_price" numeric, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_amount_financed"("vehicle_price" numeric, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_amount_financed"("vehicle_price" numeric, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) TO "service_role";



GRANT ALL ON TABLE "public"."trivian_config" TO "anon";
GRANT ALL ON TABLE "public"."trivian_config" TO "authenticated";
GRANT ALL ON TABLE "public"."trivian_config" TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_get_config"() TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_get_config"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_get_config"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_inventory_pricing"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_inventory_pricing"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_inventory_pricing"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_max_amount_financed"("max_payment" numeric, "term_months" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_max_amount_financed"("max_payment" numeric, "term_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_max_amount_financed"("max_payment" numeric, "term_months" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_max_payment"("gross_monthly_income" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_max_payment"("gross_monthly_income" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_max_payment"("gross_monthly_income" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_monthly_payment"("amount_financed" numeric, "term_months" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_monthly_payment"("amount_financed" numeric, "term_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_monthly_payment"("amount_financed" numeric, "term_months" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_qualifying_units"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_qualifying_units"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_qualifying_units"("p_gross_monthly_income" numeric, "p_term_months" integer, "p_include_vsc" boolean, "p_include_gap" boolean, "p_cash_down" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_quote"("gross_monthly_income" numeric, "vehicle_price" numeric, "term_months" integer, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_quote"("gross_monthly_income" numeric, "vehicle_price" numeric, "term_months" integer, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_quote"("gross_monthly_income" numeric, "vehicle_price" numeric, "term_months" integer, "include_vsc" boolean, "include_gap" boolean, "cash_down" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric, "include_vsc" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric, "include_vsc" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."trivian_tax_amount"("vehicle_price" numeric, "include_vsc" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_timestamp"() TO "service_role";



GRANT ALL ON TABLE "public"."app_notifications" TO "anon";
GRANT ALL ON TABLE "public"."app_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."app_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."bhph_bureau_rules" TO "anon";
GRANT ALL ON TABLE "public"."bhph_bureau_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."bhph_bureau_rules" TO "service_role";



GRANT ALL ON TABLE "public"."bureau_messages" TO "anon";
GRANT ALL ON TABLE "public"."bureau_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."bureau_messages" TO "service_role";



GRANT ALL ON TABLE "public"."bureau_public_records" TO "anon";
GRANT ALL ON TABLE "public"."bureau_public_records" TO "authenticated";
GRANT ALL ON TABLE "public"."bureau_public_records" TO "service_role";



GRANT ALL ON TABLE "public"."bureau_summary" TO "anon";
GRANT ALL ON TABLE "public"."bureau_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."bureau_summary" TO "service_role";



GRANT ALL ON TABLE "public"."bureau_tradelines" TO "anon";
GRANT ALL ON TABLE "public"."bureau_tradelines" TO "authenticated";
GRANT ALL ON TABLE "public"."bureau_tradelines" TO "service_role";



GRANT ALL ON TABLE "public"."credit_report_jobs" TO "anon";
GRANT ALL ON TABLE "public"."credit_report_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_report_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."credit_reports" TO "anon";
GRANT ALL ON TABLE "public"."credit_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_reports" TO "service_role";



GRANT ALL ON TABLE "public"."deal_documents" TO "anon";
GRANT ALL ON TABLE "public"."deal_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_documents" TO "service_role";



GRANT ALL ON TABLE "public"."deal_funding_stip_verifications" TO "anon";
GRANT ALL ON TABLE "public"."deal_funding_stip_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_funding_stip_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."deal_management_notes" TO "anon";
GRANT ALL ON TABLE "public"."deal_management_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_management_notes" TO "service_role";



GRANT ALL ON TABLE "public"."deal_override_counter_offers" TO "anon";
GRANT ALL ON TABLE "public"."deal_override_counter_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_override_counter_offers" TO "service_role";



GRANT ALL ON TABLE "public"."deal_override_requests" TO "anon";
GRANT ALL ON TABLE "public"."deal_override_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_override_requests" TO "service_role";



GRANT ALL ON TABLE "public"."deal_people" TO "anon";
GRANT ALL ON TABLE "public"."deal_people" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_people" TO "service_role";



GRANT ALL ON TABLE "public"."deal_structure" TO "anon";
GRANT ALL ON TABLE "public"."deal_structure" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_structure" TO "service_role";



GRANT ALL ON TABLE "public"."deal_structure_inputs" TO "anon";
GRANT ALL ON TABLE "public"."deal_structure_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_structure_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."deal_vehicle_selection" TO "anon";
GRANT ALL ON TABLE "public"."deal_vehicle_selection" TO "authenticated";
GRANT ALL ON TABLE "public"."deal_vehicle_selection" TO "service_role";



GRANT ALL ON TABLE "public"."deals" TO "anon";
GRANT ALL ON TABLE "public"."deals" TO "authenticated";
GRANT ALL ON TABLE "public"."deals" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."income_profiles" TO "anon";
GRANT ALL ON TABLE "public"."income_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."income_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."organization_invitations" TO "anon";
GRANT ALL ON TABLE "public"."organization_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."organization_profile_settings" TO "anon";
GRANT ALL ON TABLE "public"."organization_profile_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_profile_settings" TO "service_role";



GRANT ALL ON TABLE "public"."organization_role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."organization_role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."organization_settings" TO "anon";
GRANT ALL ON TABLE "public"."organization_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_settings" TO "service_role";



GRANT ALL ON TABLE "public"."organization_user_permission_overrides" TO "anon";
GRANT ALL ON TABLE "public"."organization_user_permission_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_user_permission_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."organization_users" TO "anon";
GRANT ALL ON TABLE "public"."organization_users" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_users" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."trivian_inventory" TO "anon";
GRANT ALL ON TABLE "public"."trivian_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."trivian_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."underwriting_inputs" TO "anon";
GRANT ALL ON TABLE "public"."underwriting_inputs" TO "authenticated";
GRANT ALL ON TABLE "public"."underwriting_inputs" TO "service_role";



GRANT ALL ON TABLE "public"."underwriting_results" TO "anon";
GRANT ALL ON TABLE "public"."underwriting_results" TO "authenticated";
GRANT ALL ON TABLE "public"."underwriting_results" TO "service_role";



GRANT ALL ON TABLE "public"."underwriting_tier_policy" TO "anon";
GRANT ALL ON TABLE "public"."underwriting_tier_policy" TO "authenticated";
GRANT ALL ON TABLE "public"."underwriting_tier_policy" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_options" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_options" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_options" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_selection" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_selection" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_selection" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_term_policy" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_term_policy" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_term_policy" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







