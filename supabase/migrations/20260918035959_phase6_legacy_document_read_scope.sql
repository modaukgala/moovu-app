-- Close broad legacy staff document reads; preserve owner-bound Driver reads.
-- Additive authorization changes only. No object or historical record deletion.
do $$ declare p record;begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='driver_documents' and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'is_staff' loop
  execute format('drop policy %I on public.driver_documents',p.policyname);
 end loop;
end $$;
create policy phase6_authorized_legacy_document_review on public.driver_documents for select to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
revoke insert,update,delete,truncate,trigger,references on public.driver_accounts from public,anon,authenticated;
