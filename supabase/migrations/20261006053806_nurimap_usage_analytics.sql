-- Only Nurimap usage aggregates; no user, query, IP, device or location data.
create table public.nurimap_usage_daily (
  day date primary key,
  visits bigint not null default 0 check (visits >= 0),
  visitors bigint not null default 0 check (visitors >= 0),
  analyses bigint not null default 0 check (analyses >= 0),
  exports bigint not null default 0 check (exports >= 0),
  shares bigint not null default 0 check (shares >= 0),
  datasets jsonb not null default '{}'::jsonb check (jsonb_typeof(datasets) = 'object')
);

-- Day-scoped server HMACs only. Receipts expire on the next collection write.
create table public.nurimap_usage_receipts (
  day date not null,
  receipt_id text not null check (receipt_id ~ '^[a-f0-9]{64}$'),
  primary key (day, receipt_id)
);

alter table public.nurimap_usage_daily enable row level security;
alter table public.nurimap_usage_receipts enable row level security;
revoke all on table public.nurimap_usage_daily, public.nurimap_usage_receipts from public, anon, authenticated;
revoke all on table public.nurimap_usage_daily, public.nurimap_usage_receipts from service_role;
grant select, insert, update on table public.nurimap_usage_daily to service_role;
grant select, insert, delete on table public.nurimap_usage_receipts to service_role;

create function public.nurimap_record_usage(p_day date, p_visitorhash text, p_events jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event jsonb;
  v_dataset text;
  v_added integer;
  v_visits bigint := 0;
  v_visitors bigint := 0;
  v_analyses bigint := 0;
  v_exports bigint := 0;
  v_shares bigint := 0;
  v_datasets jsonb;
  v_allowed constant text[] := array[
    'resident-population', 'resident-vital', 'medical',
    'skt-living', 'skt-mobility', 'skt-daynight',
    'nh-consumption', 'nh-demographics', 'nh-hourly', 'nh-industry', 'nh-storetype',
    'kcb-credit', 'kcb-migration', 'kcb-commute', 'kcb-grid-500m', 'gn-business',
    'kosis-safety', 'kosis-welfare', 'kosis-health', 'kosis-housing',
    'kosis-finance', 'kosis-transport', 'kosis-environment', 'kosis-education'
  ];
begin
  if p_day is distinct from (now() at time zone 'Asia/Seoul')::date
    or coalesce(p_visitorhash, '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_events) is distinct from 'array'
    or jsonb_array_length(p_events) not between 1 and 20 then
    raise exception 'Invalid usage batch' using errcode = '22023';
  end if;

  -- Lock one day row so parallel requests cannot lose aggregate increments.
  insert into public.nurimap_usage_daily(day) values (p_day) on conflict (day) do nothing;
  select datasets into v_datasets from public.nurimap_usage_daily where day = p_day for update;

  delete from public.nurimap_usage_receipts where day < p_day - 1;
  insert into public.nurimap_usage_receipts(day, receipt_id) values (p_day, p_visitorhash)
    on conflict (day, receipt_id) do nothing;
  get diagnostics v_visitors = row_count;

  for v_event in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(v_event) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_event)) <> 3
      or coalesce(v_event ->> 'receipt_id', '') !~ '^[a-f0-9]{64}$'
      or coalesce(v_event ->> 'kind', '') not in ('visit', 'analysis', 'export', 'share')
      or jsonb_typeof(v_event -> 'datasets') is distinct from 'array'
      or jsonb_array_length(v_event -> 'datasets') > cardinality(v_allowed)
      or ((v_event ->> 'kind') = 'analysis' and jsonb_array_length(v_event -> 'datasets') = 0)
      or ((v_event ->> 'kind') <> 'analysis' and jsonb_array_length(v_event -> 'datasets') <> 0)
      or exists (
        select 1 from jsonb_array_elements(v_event -> 'datasets') as item(value)
        where jsonb_typeof(item.value) <> 'string'
          or not ((item.value #>> '{}') = any(v_allowed))
      ) then
      raise exception 'Invalid usage event' using errcode = '22023';
    end if;
    insert into public.nurimap_usage_receipts(day, receipt_id) values (p_day, v_event ->> 'receipt_id')
      on conflict (day, receipt_id) do nothing;
    get diagnostics v_added = row_count;
    if v_added = 0 then continue; end if;

    case v_event ->> 'kind'
      when 'visit' then v_visits := v_visits + 1;
      when 'analysis' then
        v_analyses := v_analyses + 1;
        for v_dataset in select distinct value from jsonb_array_elements_text(v_event -> 'datasets') loop
          v_datasets := jsonb_set(v_datasets, array[v_dataset],
            to_jsonb(coalesce((v_datasets ->> v_dataset)::bigint, 0) + 1), true);
        end loop;
      when 'export' then v_exports := v_exports + 1;
      when 'share' then v_shares := v_shares + 1;
    end case;
  end loop;
  update public.nurimap_usage_daily set
    visits = visits + v_visits, visitors = visitors + v_visitors,
    analyses = analyses + v_analyses, exports = exports + v_exports, shares = shares + v_shares,
    datasets = v_datasets where day = p_day;
end;
$$;

revoke all on function public.nurimap_record_usage(date, text, jsonb) from public, anon, authenticated;
grant execute on function public.nurimap_record_usage(date, text, jsonb) to service_role;
comment on table public.nurimap_usage_daily is 'Nurimap KST daily aggregates. Weekly/monthly visitors are visitor-days, not distinct people.';
comment on table public.nurimap_usage_receipts is 'Short-lived day-scoped HMAC dedup receipts. No raw browser or event IDs.';
