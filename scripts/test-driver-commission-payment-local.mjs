import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
const container='supabase_db_moovu-critical-reliability-fixture';
const source='phase5a_schema_1793305086063';
const database='commission_cert_'+randomBytes(6).toString('hex');
const driver=randomUUID(),policy=randomUUID();
let created=false,checks=0;
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});const constraint=String(r.stderr).match(/constraint "([a-z0-9_]+)"/)?.[1];assert.equal(r.status,0,`Isolated Docker operation failed; constraint=${constraint??'none'}; raw output withheld`);return r.stdout.trim();}
function query(sql){return docker(['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],"set search_path=public,pg_catalog;set request.jwt.claim.role='service_role';"+sql);}
function attempt(sql){return new Promise(resolve=>{const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{windowsHide:true});let code='';p.stdout.on('data',()=>{});p.stderr.on('data',v=>code+=v);p.on('error',()=>resolve({ok:false,unique:false}));p.on('close',s=>resolve({ok:s===0,unique:code.includes('23505')}));p.stdin.end("set request.jwt.claim.role='service_role';"+sql);});}
const check=(name,value)=>{assert.ok(value,name);checks++;console.log(JSON.stringify({name,status:'PASS'}));};
const snapshot={driverId:driver,obligationType:'COMMISSION_DEBT',debtCents:4245,unappliedCreditCents:0,netOwedCents:4245,policyId:policy,financeMode:'AUTHORITATIVE',currency:'ZAR'};
const version=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
const oldKey=`yoco-driver-commission:${driver}:${version}`;
function insert(id,key,state='CREATED',checkout=null){return `insert into driver_online_payment_attempts(id,driver_id,provider,obligation_type,obligation_version,obligation_snapshot,amount_cents,currency,state,idempotency_key,payload_hash,provider_checkout_id) values('${id}','${driver}','FAKE_TEST','COMMISSION_DEBT','${version}','${JSON.stringify(snapshot)}',4245,'ZAR','${state}','${key}','${'b'.repeat(64)}',${checkout?`'${checkout}'`:'null'});`;}
function event(id,checkout,payment,outcome='SUCCEEDED'){return JSON.parse(query(`select phase3_process_trusted_driver_payment_event('FAKE_TEST','${id}','payment.${outcome.toLowerCase()}','${outcome}','${'c'.repeat(64)}','${checkout}','${payment}',4245,'ZAR','${outcome}');`));}
const debt=()=>Number(query(`select phase2_driver_finance_position('${driver}')->>'net_owed_cents'`));
function seedDebt(){const id=randomUUID();query(`do $$ declare d financial_accounts;r financial_accounts;begin
 d:=phase1_ensure_financial_account('DRIVER:${driver.toUpperCase()}:COMMISSION_DEBT:ZAR','DRIVER_COMMISSION_DEBT','DRIVER','${driver}','DEBIT','ZAR');
 r:=phase1_ensure_financial_account('PLATFORM:COMMISSION_REVENUE:ZAR','COMMISSION_REVENUE','PLATFORM',null,'CREDIT','ZAR');
 perform phase1_post_financial_transaction('synthetic:${id}','${'d'.repeat(64)}','ADJUSTMENT','ADJUSTMENT','${id}','ZAR','SYSTEM',null,clock_timestamp(),jsonb_build_array(jsonb_build_object('account_id',d.id,'entry_side','DEBIT','amount_cents',4245),jsonb_build_object('account_id',r.id,'entry_side','CREDIT','amount_cents',4245)),'{}',null);end $$;`);}
try{
 docker(['exec',container,'createdb','-U','postgres',database]);created=true;
 const schema=docker(['exec',container,'pg_dump','-U','postgres','-d',source,'--schema-only','--no-publications','--no-subscriptions','--exclude-schema=realtime','--exclude-schema=_realtime']);
 docker(['exec','-i',container,'psql','-U','supabase_admin','-d',database,'-X','-q','-v','ON_ERROR_STOP=1'],schema);
 check('Production payment constraints and indexes match isolated schema',query("select md5((select string_agg(pg_get_constraintdef(oid),'|' order by conname) from pg_constraint where conrelid='driver_online_payment_attempts'::regclass)||(select string_agg(pg_get_indexdef(indexrelid),'|' order by pg_get_indexdef(indexrelid)) from pg_index where indrelid='driver_online_payment_attempts'::regclass))")==='f06eff5c7de493a4c7cd0cc1623ab46f');
 check('Actual trusted Driver payment processor matches production',query("select md5(replace(pg_get_functiondef('public.phase3_process_trusted_driver_payment_event(text,text,text,text,text,text,text,bigint,text,text)'::regprocedure),E'\\r\\n',E'\\n'))")==='3c33ffb04c453f8c69884a1a0a274278');
 query(`insert into moovu_admission_state(singleton,mode) values(true,'NORMAL');
 insert into drivers(id,first_name,last_name,phone,status,verification_status,profile_completed) values('${driver}','Synthetic','Commission','0600000000','approved','approved',true);
 insert into phase2_finance_policy(id,policy_key,mode,go_basis_points,go_xl_basis_points,debt_limit_cents,warning_cents,subscription_required,effective_from,authoritative_effective_from) values('${policy}','phase2-driver-finance','AUTHORITATIVE',1500,1500,5000,4000,false,now()-interval '1 day',now()-interval '1 day');`);
 seedDebt();check('Synthetic authoritative debt is exactly R42.45',debt()===4245);
 const old=randomUUID();query(insert(old,oldKey,'PENDING','fixture_checkout_old'));
 check('Trusted verified settlement succeeds',event('fixture_event_old','fixture_checkout_old','fixture_payment_old').result==='SUCCEEDED');
 check('Verified settlement reduces debt to zero',debt()===0);
 const prior=query(`select to_jsonb(a)::text from driver_online_payment_attempts a where id='${old}'`);
 seedDebt();check('New debt can recur at exactly R42.45',debt()===4245);
 check('Old balance-only idempotency key reproduces unique-key failure',(await attempt(insert(randomUUID(),oldKey))).unique);
 const ids=Array.from({length:8},randomUUID);
 const results=await Promise.all(ids.map(id=>attempt(insert(id,`${oldKey}:${id}`))));
 check('Eight independent PostgreSQL connections produce exactly one active reservation',results.filter(r=>r.ok).length===1&&results.filter(r=>r.unique).length===7);
 const active=query("select id from driver_online_payment_attempts where state='CREATED'");
 query(`update driver_online_payment_attempts set state='PENDING',provider_checkout_id='fixture_checkout_failed' where id='${active}';`);
 check('Failed verified event does not clear debt',event('fixture_event_failed','fixture_checkout_failed','fixture_payment_failed','FAILED').result==='FAILED'&&debt()===4245);
 const next=randomUUID();query(insert(next,`${oldKey}:${next}`,'PENDING','fixture_checkout_next'));
 check('Retry after a failed attempt can reserve again',query(`select state from driver_online_payment_attempts where id='${next}'`)==='PENDING');
 check('Second verified equal-amount payment succeeds',event('fixture_event_next','fixture_checkout_next','fixture_payment_next').result==='SUCCEEDED');
 check('Duplicate event is replayed, not recredited',event('fixture_event_next','fixture_checkout_next','fixture_payment_next').result==='REPLAYED'&&debt()===0);
 check('Duplicate payment under another event does not recredit',event('fixture_event_replayed','fixture_checkout_next','fixture_payment_next').result==='REPLAYED'&&debt()===0);
 check('Earlier successful payment evidence is unchanged',query(`select to_jsonb(a)::text from driver_online_payment_attempts a where id='${old}'`)===prior);
 check('Exactly one ledger transaction exists per verified attempt',query("select count(*) from financial_transactions where transaction_type='DRIVER_PAYMENT'")==='2');
 check('All ledger transactions remain balanced',query("select count(*) from(select transaction_id from financial_ledger_entries group by transaction_id having sum(case entry_side when 'DEBIT' then amount_cents else -amount_cents end)<>0)x")==='0');
 check('Only synthetic payment records exist',query('select count(*) from drivers')==='1');
}finally{
 if(created)docker(['exec',container,'dropdb','-U','postgres','--force',database]);
}
console.log(JSON.stringify({status:'COMMISSION_DATABASE_VALIDATION_PASS',checks,productionConnected:false,realProviderContacted:false,syntheticDatabaseDestroyed:true}));
