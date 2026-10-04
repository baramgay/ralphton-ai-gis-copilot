-- Nurimap internal operations only. Other services and public data are untouched.
create table public.nurimap_sync_status (
  id text primary key check (id = 'default'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.nurimap_sync_status enable row level security;
revoke all on table public.nurimap_sync_status from public, anon, authenticated;
grant select, insert, update on table public.nurimap_sync_status to service_role;

comment on table public.nurimap_sync_status is 'Nurimap private sync status. Read via sanitized server endpoints only.';
