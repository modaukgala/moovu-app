// Sixth Release 4 migration only. Dry run never opens a database connection.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMigrations } from './release4-stage2-migrate.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const version='20261027150000';
const filename='release4-forward-only-payout-activation.sql';
const hash='B7A519A8EC4D61DDD350FD26D17701DC87C21373EC0AC71DE99D1166B7506055';
const stage1=['20261022120000','20261022123000','20261022182716'];
const image='public.ecr.aws/supabase/postgres:17.11.0.004';
const fail=category=>{throw Error(category);};
const sqlFile=join(root,'docs',filename);
const raw=readFileSync(sqlFile);
if(createHash('sha256').update(raw).digest('hex').toUpperCase()!==hash)fail('SIXTH_FILE_HASH_MISMATCH');
const five=planMigrations();
const sql=raw.toString('utf8');
const body=sql.replace(/^\s*--.*$/gm,'').trim();
if(!/^begin\s*;/i.test(body)||! /commit\s*;$/i.test(body)||
  [...sql.matchAll(/^\s*begin\s*;/gim)].length!==1||
  [...sql.matchAll(/^\s*commit\s*;/gim)].length!==1)fail('SIXTH_FILE_TRANSACTION_SHAPE');
const mode=process.argv[2]??'--dry-run';
if(process.argv.length>3||!['--dry-run','--execute-production','--execute-fixture'].includes(mode))fail('INVALID_MODE');
const run=(statement,category)=>{
  const env=process.env;
  let args;
  if(mode==='--execute-fixture'){
    if(env.MOOVU_FORWARD_ONLY_FIXTURE!=='true'||!/^moovu-forward-only-fixture$/.test(env.MOOVU_FORWARD_ONLY_FIXTURE_CONTAINER??'')||
      env.PGDATABASE!=='moovu_forward_fixture')fail('FIXTURE_DESTINATION_BLOCKED');
    args=['exec','-i',env.MOOVU_FORWARD_ONLY_FIXTURE_CONTAINER,'psql','-U','supabase_admin','-d',env.PGDATABASE,'-X','-qAt','-v','ON_ERROR_STOP=1'];
  } else {
    if(env.MOOVU_FORWARD_ONLY_EXECUTION_APPROVED!=='true'||env.PGHOST!=='aws-1-eu-west-1.pooler.supabase.com'||
      env.PGPORT!=='5432'||env.PGUSER!=='postgres.mvazbszenqahgqpznhhq'||env.PGDATABASE!=='postgres'||
      env.PGSSLMODE!=='verify-full'||!existsSync(env.PGSSLROOTCERT??'')||!env.PGPASSWORD)fail('PRODUCTION_DESTINATION_BLOCKED');
    args=['run','--rm','-i','--mount',`type=bind,source=${env.PGSSLROOTCERT},target=/run/ca.crt,readonly`,
      '--env','PGHOST','--env','PGPORT','--env','PGUSER','--env','PGDATABASE','--env','PGPASSWORD','--env','PGSSLMODE',
      '--env','PGSSLROOTCERT=/run/ca.crt','--entrypoint','psql',image,'-X','-qAt','-v','ON_ERROR_STOP=1'];
  }
  const result=spawnSync('docker',args,{input:statement,encoding:'utf8',timeout:180000,maxBuffer:1024*1024,windowsHide:true});
  if(result.error||result.status!==0)fail(category);
  return result.stdout.trim();
};
try {
  if(mode==='--dry-run'){
    console.log(JSON.stringify({status:'FORWARD_ONLY_DRY_RUN',productionConnected:false,version,filename,sha256:hash,
      precedingVersions:five.map(item=>item.version)}));
  } else {
    if(mode==='--execute-production'){
      const status=spawnSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',windowsHide:true});
      const ancestry=spawnSync('git',['merge-base','--is-ancestor','2165be51452c1a8f4f8c05b57cd7509eabcc950f','HEAD'],
        {cwd:root,encoding:'utf8',windowsHide:true});
      if(status.status!==0||status.stdout.trim()||ancestry.status!==0)fail('RELEASE_CHECKOUT_CHANGED');
    }
    const state=JSON.parse(run(`BEGIN READ ONLY; SELECT json_build_object(
      'role',current_user,'history',(SELECT coalesce(json_agg(version ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations),
      'payables',(SELECT count(*) FROM public.online_driver_payables),
      'policy',(SELECT count(*) FROM public.online_payout_policy WHERE policy_key='manual-online-payouts')); COMMIT;`,'PREFLIGHT_FAILED'));
    const expected=[...stage1,...five.map(item=>item.version)];
    const relevantHistory=state.history.filter(item=>item>=stage1[0]);
    if(state.role!==(mode==='--execute-production'?'postgres':'supabase_admin')||
      JSON.stringify(relevantHistory)!==JSON.stringify(expected)||state.payables!==0||state.policy!==1)fail('HISTORY_OR_PAYOUT_BASELINE_CONFLICT');
    const migration=`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n${sql.replace(/^\s*begin\s*;/im,'').replace(/commit\s*;\s*$/im,'')}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${version}','release4_forward_only_payout_activation'); COMMIT;`;
    run(migration,'FORWARD_ONLY_MIGRATION_FAILED');
    const verified=JSON.parse(run(`BEGIN READ ONLY; SELECT json_build_object(
      'history',(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${version}'),
      'guard',to_regprocedure('public.release4_post_forward_online_payable(uuid,timestamp with time zone)') IS NOT NULL,
      'oldRevoked',NOT has_function_privilege('service_role','public.phase3_post_completed_online_driver_payable(uuid)','EXECUTE'),
      'driverDenied',NOT has_function_privilege('authenticated','public.release4_post_forward_online_payable(uuid,timestamp with time zone)','EXECUTE'),
      'unbalanced',(SELECT count(*) FROM (SELECT transaction_id FROM public.financial_ledger_entries GROUP BY transaction_id HAVING sum(CASE WHEN entry_side='DEBIT' THEN amount_cents ELSE -amount_cents END)<>0)x),
      'duplicateKeys',(SELECT count(*) FROM (SELECT idempotency_key FROM public.financial_transactions GROUP BY idempotency_key HAVING count(*)>1)x),
      'duplicateEvents',(SELECT count(*) FROM (SELECT provider,provider_event_id FROM public.online_provider_events GROUP BY provider,provider_event_id HAVING count(*)>1)x),
      'duplicatePayables',(SELECT count(*) FROM (SELECT trip_id FROM public.online_driver_payables GROUP BY trip_id HAVING count(*)>1)x)); COMMIT;`,'POSTFLIGHT_FAILED'));
    if(verified.history!==1||verified.guard!==true||verified.oldRevoked!==true||verified.driverDenied!==true||
      ['unbalanced','duplicateKeys','duplicateEvents','duplicatePayables'].some(key=>verified[key]!==0))fail('POSTFLIGHT_INVARIANT_FAILED');
    console.log(JSON.stringify({status:'FORWARD_ONLY_MIGRATION_APPLIED',version,productionMutated:mode==='--execute-production',postflight:verified}));
  }
} catch(error){console.error(JSON.stringify({status:'FORWARD_ONLY_MIGRATION_BLOCKED',category:error.message}));process.exitCode=1;}
