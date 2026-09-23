-- DISPOSABLE DATABASE ONLY / TEST FIXTURE / NOT FOR AUTOMATIC EXECUTION.
-- Never run against production. Apply the reviewed migration to an approved
-- disposable database first. This script deliberately attempts rejected writes
-- and finishes with ROLLBACK.

begin;

do $$
begin
  if has_table_privilege('anon', 'public.financial_transactions', 'insert')
     or has_table_privilege('authenticated', 'public.financial_ledger_entries', 'update') then
    raise exception 'client ledger mutation privilege detected';
  end if;
  if has_function_privilege('anon', 'public.phase1_post_financial_transaction(text,text,text,text,uuid,text,text,uuid,timestamptz,jsonb,jsonb,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.phase1_reverse_financial_transaction(uuid,text,text,uuid,text)', 'execute') then
    raise exception 'client privileged RPC execution detected';
  end if;
end $$;

-- The disposable harness must create anonymized valid source rows and call the
-- posting RPC as service_role. Required assertions:
-- 1. one balanced posting succeeds and stores integer cents only;
-- 2. identical idempotency-key/payload replay returns the same transaction ID;
-- 3. same key with changed payload fails and creates no entry;
-- 4. an unbalanced entry array fails atomically;
-- 5. direct anon/authenticated INSERT/UPDATE/DELETE and RPC calls fail;
-- 6. posted headers and entries cannot be updated or deleted;
-- 7. one linked reversal inverts every side and a second reversal fails;
-- 8. a missing/invalid source fails before any header or entry exists;
-- 9. concurrent identical posts yield one transaction;
-- 10. concurrent conflicting posts yield one success and one controlled failure.

do $$
begin
  if exists (
    select 1 from public.financial_ledger_entries
    where amount_cents <= 0 or amount_cents <> trunc(amount_cents)
  ) then
    raise exception 'invalid ledger amount detected';
  end if;
  if exists (
    select 1
    from public.financial_ledger_entries
    group by transaction_id
    having sum(case when entry_side='DEBIT' then amount_cents else 0 end)
        <> sum(case when entry_side='CREDIT' then amount_cents else 0 end)
  ) then
    raise exception 'unbalanced posted transaction detected';
  end if;
end $$;

rollback;
