-- Supabase's default service_role table grants include DELETE and TRUNCATE.
-- Matching windows need only bounded read/create/update authority.
revoke all on public.dispatch_matching_windows from service_role;
grant select, insert, update on public.dispatch_matching_windows to service_role;
revoke all on function public.guard_dispatch_matching_offer() from public, anon, authenticated;
