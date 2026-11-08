import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const name=`moovu-broadcast-scheduler-${randomBytes(6).toString('hex')}`;
const credential=randomBytes(32).toString('hex');
const received=[];let started=false,server;
function docker(args,input) {
  const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024,
    env:{...process.env,POSTGRES_PASSWORD:randomBytes(32).toString('hex')}});
  if(r.status!==0)throw new Error(`Isolated Docker ${args[0]} failed: ${String(r.stderr).replaceAll(credential,'[redacted]').slice(-1500)}`);
  return r.stdout.trim();
}
const sql=q=>docker(['exec','-i',name,'psql','-U','supabase_admin','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],q);
try {
  server=createServer(async(req,res)=>{
    for await(const unused of req) void unused;
    if(req.headers.authorization!==`Bearer ${credential}`){res.writeHead(401).end();return;}
    received.push({path:req.url,at:Date.now()});res.writeHead(200,{'content-type':'application/json'}).end('{"ok":true}');
  });
  await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
  const port=server.address().port;
  const anonymous=await fetch(`http://127.0.0.1:${port}/api/jobs/broadcast`,{method:'POST'});
  assert.equal(anonymous.status,401);
  docker(['run','-d','--name',name,'-e','POSTGRES_PASSWORD',
    '--mount',`type=bind,source=${resolve('scripts/fixtures/scheduler-getkey.sh')},target=/tmp/moovu-scheduler-getkey.sh,readonly`,
    'public.ecr.aws/supabase/postgres:17.11.0.004','postgres','-c','shared_preload_libraries=pg_cron,pg_net,pgsodium,supabase_vault',
    '-c','cron.database_name=postgres','-c','pg_net.database_name=postgres',
    '-c','pgsodium.getkey_script=/tmp/moovu-scheduler-getkey.sh']);started=true;
  // The image briefly accepts connections during initialization, then restarts.
  await delay(12000);
  let ready=false;
  for(let i=0;i<60;i++) {
    const r=spawnSync('docker',['exec',name,'pg_isready'],{windowsHide:true,stdio:'ignore'});
    if(r.status===0){ready=true;break;}await delay(1000);
  }
  assert.ok(ready,'Dedicated scheduler database startup');
  sql(`create extension if not exists pg_cron;create extension if not exists pg_net;create extension if not exists supabase_vault;
    do $$begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
    end$$;
    create table public.driver_broadcast_requests(state text,next_run_at timestamptz,lease_until timestamptz);
    create table public.driver_offer_device_jobs(state text,next_run_at timestamptz,expires_at timestamptz,lease_until timestamptz);
    create table public.dispatch_jobs(status text,run_at timestamptz);
    select vault.create_secret('${credential}','moovu_dispatch_worker_secret');
    insert into public.driver_broadcast_requests values('PENDING',now(),null);`);
  const installation=readFileSync('supabase/operations/install-driver-broadcast-scheduler.sql','utf8');
  assert.ok(installation.includes('https://moovurides.co.za/api/jobs/'));
  // This replacement exists only in a dedicated, throw-away Docker database.
  sql(installation.replaceAll('https://moovurides.co.za/api/jobs/',`http://host.docker.internal:${port}/api/jobs/`));
  const deadline=Date.now()+70000;
  while(received.length<3&&Date.now()<deadline)await delay(500);
  assert.ok(received.length>=3,'Three actual scheduled HTTP requests');
  const gaps=received.slice(1).map((r,i)=>r.at-received[i].at);
  assert.ok(gaps.every(ms=>ms>=7000&&ms<=15000),'Observed 10-second cadence within local tolerance');
  assert.ok(received.every(r=>r.path==='/api/jobs/broadcast'),'Only the isolated broadcast endpoint invoked');
  sql('delete from public.driver_broadcast_requests;');
  await delay(12000);const drained=received.length;await delay(12000);
  assert.equal(received.length,drained,'Empty backlog does not generate recurring HTTP requests');
  console.log(JSON.stringify({status:'PASS',httpRequests:received.length,intervalMilliseconds:gaps,
    anonymousRejected:true,emptyBacklogSuppressed:true,productionChanges:0,
    scope:'Dedicated local pg_cron/pg_net to mocked HTTP receiver; NOT hosted worker certification'}));
} catch(error) {
  console.error(JSON.stringify({status:'FAIL',message:String(error.message).replaceAll(credential,'[redacted]')}));process.exitCode=1;
  if(started) {
    const diagnostics=spawnSync('docker',['logs','--tail','8',name],{windowsHide:true,encoding:'utf8'});
    console.error(String(diagnostics.stderr||diagnostics.stdout).replaceAll(credential,'[redacted]').replace(/[a-f0-9]{64}/gi,'[redacted]').slice(-1800));
  }
} finally {
  if(started)spawnSync('docker',['rm','-f',name],{windowsHide:true,stdio:'ignore'});
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
