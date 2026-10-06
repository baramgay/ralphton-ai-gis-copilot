begin;
set local role service_role;
do $test$
declare
  d date := (now() at time zone 'Asia/Seoul')::date;
  before_row public.nurimap_usage_daily%rowtype;
  after_row public.nurimap_usage_daily%rowtype;
  batch jsonb := '[{"receipt_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"visit","datasets":[]},{"receipt_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","kind":"analysis","datasets":["medical","medical","resident-population"]},{"receipt_id":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","kind":"export","datasets":[]},{"receipt_id":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","kind":"share","datasets":[]}]';
begin
  select * into before_row from public.nurimap_usage_daily where day=d;
  insert into public.nurimap_usage_receipts(day,receipt_id) values(d-2, repeat('0',64));
  perform public.nurimap_record_usage(d,repeat('1',64),batch);
  perform public.nurimap_record_usage(d,repeat('1',64),batch);
  perform public.nurimap_record_usage(d,repeat('2',64),'[{"receipt_id":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","kind":"visit","datasets":[]},{"receipt_id":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","kind":"analysis","datasets":["medical"]}]');
  select * into after_row from public.nurimap_usage_daily where day=d;
  if after_row.visits-coalesce(before_row.visits,0) <> 2 or after_row.visitors-coalesce(before_row.visitors,0) <> 2
    or after_row.analyses-coalesce(before_row.analyses,0) <> 2 or after_row.exports-coalesce(before_row.exports,0) <> 1 or after_row.shares-coalesce(before_row.shares,0) <> 1
    or (after_row.datasets->>'medical')::bigint-coalesce((before_row.datasets->>'medical')::bigint,0) <> 2
    or (after_row.datasets->>'resident-population')::bigint-coalesce((before_row.datasets->>'resident-population')::bigint,0) <> 1 then raise exception 'Aggregate or dedup mismatch'; end if;
  if exists(select 1 from public.nurimap_usage_receipts where day=d-2 and receipt_id=repeat('0',64)) then raise exception 'Retention failed'; end if;
  begin
    perform public.nurimap_record_usage(d,repeat('3',64),'[{"receipt_id":"9999999999999999999999999999999999999999999999999999999999999999","kind":"analysis","datasets":[]}]');
    raise exception 'Empty analysis accepted';
  exception when invalid_parameter_value then null; end;
end $test$;
select 'PASS atomic increments, event replay, visitor dedup, dataset dedup, retention and invalid analysis' as verification;
rollback;
select c.relname,c.relrowsecurity,
  has_table_privilege('anon',c.oid,'SELECT') as anon_read,
  has_table_privilege('anon',c.oid,'INSERT') as anon_write,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_read
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('nurimap_usage_daily','nurimap_usage_receipts');
select prosecdef as security_definer, has_function_privilege('anon',oid,'EXECUTE') as anon_execute, has_function_privilege('authenticated',oid,'EXECUTE') as authenticated_execute, has_function_privilege('service_role',oid,'EXECUTE') as service_execute from pg_proc where proname='nurimap_record_usage';
select count(*) as persisted_test_rows from public.nurimap_usage_daily;
