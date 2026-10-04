-- Remove inherited Supabase default privileges before granting the required set.
revoke all on table public.nurimap_sync_status from service_role;
grant select, insert, update on table public.nurimap_sync_status to service_role;
