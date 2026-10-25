// Reuse the established synthetic payout setup, replacing only its old single-transfer assertions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'scripts/release4-online-payout-approval-connected-test.sql'), 'utf8');
const marker = '  insert into auth.users(id) values(v_importer),(v_reviewer);';
const index = source.indexOf(marker);
if (index < 0 || source.indexOf(marker, index + 1) >= 0) throw new Error('Synthetic payout setup changed.');
const prefix = source.slice(0, index).replaceAll('release4_final_cert_20261021', 'release4_manual_cert_20261023');
if (process.argv.includes('--concurrency-setup')) {
  process.stdout.write(prefix + '\nend $$;\ncommit;\n');
  process.exit(0);
}
const tail = `
  insert into auth.users(id) values(v_importer),(v_reviewer);
  insert into public.profiles(id,role) values(v_importer,'admin'),(v_reviewer,'owner')
    on conflict(id) do update set role=excluded.role;
  <<declare_test>>
  declare v_first uuid; v_second uuid; v_first_evidence uuid; v_second_evidence uuid;
      v_net bigint; v_first_amount bigint; v_second_amount bigint; v_result jsonb;
  begin
      select net_payout_cents into v_net from public.online_payout_batches where id=v_batch;
      v_first_amount:=v_net/2; v_second_amount:=v_net-v_first_amount;
      v_first:=public.release4_record_manual_payment(v_batch,v_actor,
        'a4500000-0000-4000-8000-000000000011',v_first_amount,now(),
        'EFT','synthetic-manual-ref-001',null);
      if public.release4_record_manual_payment(v_batch,v_actor,
        'a4500000-0000-4000-8000-000000000011',v_first_amount,now(),
        'EFT','synthetic-manual-ref-001',null)<>v_first then
        raise exception 'Manual payment retry duplicated the record'; end if;
      begin
        perform public.release4_record_manual_payment(v_batch,v_actor,
          'a4500000-0000-4000-8000-000000000012',v_net,now(),
          'PAYSHAP','synthetic-overpay-ref',null);
        raise exception 'Overpayment accepted';
      exception when others then
        if sqlerrm<>'Manual payment would exceed remaining payout' then raise; end if;
      end;
      v_second:=public.release4_record_manual_payment(v_batch,v_actor,
        'a4500000-0000-4000-8000-000000000013',v_second_amount,now(),
        'PAYSHAP','synthetic-manual-ref-002','synthetic-proof-002');
      if (select status from public.online_payout_batches where id=v_batch)<>'PAYMENT_RECORDED'
        or (select sum(amount_cents) from public.online_payout_manual_payments
            where batch_id=v_batch)<>v_net
        then raise exception 'Recorded partial-payment totals disagree'; end if;
      begin
        perform public.release4_verify_manual_payment(v_first,v_reviewer);
        raise exception 'Payment verified without bank evidence';
      exception when others then
        if sqlerrm<>'Independent bank evidence and reviewer required' then raise; end if;
      end;
      begin
        perform public.release4_import_manual_bank_evidence(v_first,v_importer,
          'synthetic-bank-wrong-ref','wrong-recorded-reference',v_first_amount,repeat('a',64),0,
          'LOCAL_SYNTHETIC',repeat('3',64),'SETTLED');
        raise exception 'Mismatched bank reference accepted';
      exception when others then
        if sqlerrm<>'Bank evidence does not match recorded payment' then raise; end if;
      end;
      v_first_evidence:=public.release4_import_manual_bank_evidence(v_first,v_importer,
        'synthetic-bank-txn-part-001','synthetic-manual-ref-001',v_first_amount,repeat('a',64),100,
        'LOCAL_SYNTHETIC',repeat('1',64),'SETTLED');
      begin
        perform public.release4_verify_manual_payment(v_first,v_actor);
        raise exception 'Recording Admin verified own payment';
      exception when others then
        if sqlerrm<>'Independent bank evidence and reviewer required' then raise; end if;
      end;
      v_result:=public.release4_verify_manual_payment(v_first,v_reviewer);
      if v_result->>'status'<>'VERIFIED'
        or (select status from public.online_payout_batches where id=v_batch)<>'PAYMENT_RECORDED'
        or (select count(*) from public.financial_transactions where
          idempotency_key='online_payout_manual:'||v_first::text)<>1
        then raise exception 'First partial verification failed'; end if;
      if (public.release4_verify_manual_payment(v_first,v_reviewer)->>'replayed')<>'true'
        then raise exception 'Verified payment replay was not idempotent'; end if;
      v_second_evidence:=public.release4_import_manual_bank_evidence(v_second,v_importer,
        'synthetic-bank-txn-part-002','synthetic-manual-ref-002',v_second_amount,repeat('a',64),0,
        'LOCAL_SYNTHETIC',repeat('2',64),'FAILED');
      if (public.release4_verify_manual_payment(v_second,v_reviewer)->>'status')<>'FAILED'
        or (select count(*) from public.financial_transactions where
          idempotency_key='online_payout_manual:'||v_second::text)<>0
        then raise exception 'Failed bank transfer posted a payout'; end if;
      v_second:=public.release4_record_manual_payment(v_batch,v_actor,
        'a4500000-0000-4000-8000-000000000015',v_second_amount,now(),
        'PAYSHAP','synthetic-manual-ref-003',null);
      v_second_evidence:=public.release4_import_manual_bank_evidence(v_second,v_importer,
        'synthetic-bank-txn-part-003','synthetic-manual-ref-003',v_second_amount,repeat('a',64),150,
        'LOCAL_SYNTHETIC',repeat('4',64),'SETTLED');
      v_result:=public.release4_verify_manual_payment(v_second,v_reviewer);
      if v_result->>'batch_status'<>'PAID'
        or (select status from public.online_payout_batches where id=v_batch)<>'PAID'
        or (select count(*) from public.online_payout_manual_payments
          where batch_id=v_batch and state='VERIFIED')<>2
        or (select count(*) from public.online_payout_manual_payments
          where batch_id=v_batch and state='FAILED')<>1
        or (select count(*) from public.online_driver_payables where id=v_payable and state='PAID')<>1
        then raise exception 'Final payment did not settle exactly once'; end if;
      if exists(select 1 from public.financial_ledger_entries e
        join public.financial_transactions t on t.id=e.transaction_id
        where t.idempotency_key in ('online_payout_manual:'||v_first::text,
          'online_payout_manual:'||v_second::text,'online_payout_final:'||v_batch::text)
        group by t.id having sum(case when e.entry_side='DEBIT' then e.amount_cents
          else -e.amount_cents end)<>0)
        then raise exception 'Manual payout ledger is unbalanced'; end if;
      if has_table_privilege('authenticated','public.online_payout_manual_payments','SELECT')
        or has_function_privilege('authenticated',
          'public.release4_record_manual_payment(uuid,uuid,uuid,bigint,timestamptz,text,text,text)',
          'EXECUTE')
        then raise exception 'Authenticated role has direct payout access'; end if;
      perform set_config('request.jwt.claim.role','authenticated',true);
      begin
        perform public.release4_record_manual_payment(v_batch,v_actor,
          'a4500000-0000-4000-8000-000000000014',100,now(),
          'EFT','unauthorized-reference',null);
        raise exception 'Untrusted role recorded payout';
      exception when others then
        if sqlerrm<>'Trusted server role required' then raise; end if;
      end;
      perform set_config('request.jwt.claim.role','service_role',true);
  end;
end $$;
rollback;
`;
process.stdout.write(prefix + tail);
