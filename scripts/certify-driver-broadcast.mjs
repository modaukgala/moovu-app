import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, createHmac } from "node:crypto";
import { readFileSync, openSync, writeFileSync, closeSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { broadcastHttpAcceptance } from "./lib/broadcast-http-acceptance.mjs";

const source="supabase_db_moovu-critical-reliability-fixture";
const schemaDatabase=process.argv.find(value=>value.startsWith('--schema-database='))?.split('=')[1]??'postgres';
assert.match(schemaDatabase,/^(postgres|phase5a_schema_\d+)$/);
const database=`registration_cert_${randomBytes(6).toString("hex")}`;
const network="supabase_network_moovu-critical-reliability-fixture";
const secrets=[];const containers=[];let next,browser,gateway;let assertions=0;
const lockPath=join(tmpdir(),'moovu-registration-certification.lock');let lock;
const keep=value=>{if(value)secrets.push(value);return value;};
function docker(args,input) {
  const result=spawnSync("docker",args,{input,encoding:"utf8",windowsHide:true,maxBuffer:30*1024*1024});
  assert.equal(result.status,0,`Isolated Docker ${args[0]} failed; raw output withheld`);return result.stdout.trim();
}
function sql(statement,role="postgres") {
  assert.match(database,/^registration_cert_[a-f0-9]{12}$/);
  return docker(["exec","-i",source,"psql","-X","-U",role,"-d",database,"-qAt","-v","ON_ERROR_STOP=1"],statement);
}
const count=table=>Number(sql(`select count(*) from public.${table}`));
function check(name,ok) {assert.ok(ok,name);assertions++;console.log(JSON.stringify({name,status:"PASS"}));}
function jwt(role,secret) {
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const body=`${encode({alg:"HS256",typ:"JWT"})}.${encode({role,aud:"authenticated",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}`;
  return keep(`${body}.${createHmac("sha256",secret).update(body).digest("base64url")}`);
}
function launch(name,image,port,values) {
  const r=spawnSync("docker",["run","-d","--name",name,"--network",network,"-p",`127.0.0.1:${port}`,...Object.keys(values).flatMap(key=>["-e",key]),image],{env:{...process.env,...values},windowsHide:true,encoding:"utf8"});
  containers.push(name);assert.equal(r.status,0,"Start isolated service; raw output withheld");
}
async function api(path,body,token) {
  const r=await fetch(`http://127.0.0.1:18435${path}`,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  return {status:r.status,body:await r.json().catch(()=>null)};
}
const password=keep(randomBytes(24).toString("base64url")+"Aa1");
try {
  if(existsSync(lockPath)){
    const pid=Number(readFileSync(lockPath,'utf8'));let alive=false;
    if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);alive=true;}catch{}}
    assert.equal(alive,false,'Another registration certification owns the fixed local ports');
    unlinkSync(lockPath);
  }
  lock=openSync(lockPath,'wx');writeFileSync(lock,String(process.pid));
  const inspected=JSON.parse(docker(["inspect",source]))[0];
  const env=Object.fromEntries(inspected.Config.Env.map(item=>{const i=item.indexOf("=");return [item.slice(0,i),item.slice(i+1)];}));
  const dbPassword=keep(env.POSTGRES_PASSWORD??env.PGPASSWORD);
  assert.ok(dbPassword,"Existing local database password unavailable");
  docker(["exec",source,"psql","-U","postgres","-d","postgres","-c",`create database ${database}`]);
  const schema=docker(["exec",source,"pg_dump","-U","postgres","-d",schemaDatabase,"--schema-only","--no-publications","--no-subscriptions","--exclude-schema=_realtime","--exclude-schema=realtime"]);
  sql(schema,"supabase_admin");
  const broadcast=true;
  sql(readFileSync("scripts/fixtures/phase5a_reinspection_controls.sql","utf8"));
  sql(readFileSync("scripts/fixtures/phase5_account_link_hardening.sql","utf8"));
  sql(readFileSync("supabase/migrations/20261106165400_driver_offer_broadcast.sql","utf8"));
  check("Schema-only restore; no production records copied",count("customers")===0);
  const versions=docker(["exec",source,"psql","-U","postgres","-d","postgres","-At","-c","select version from auth.schema_migrations order by version"]).split(/\r?\n/);
  assert.ok(versions.every(v=>/^\d{1,20}$/.test(v)));
  sql(`insert into auth.schema_migrations(version) values ${versions.map(v=>`('${v}')`).join(",")} on conflict do nothing`,"supabase_admin");
  const secret=keep(randomBytes(48).toString("hex"));const service=jwt("service_role",secret),anon=jwt("anon",secret);
  const suffix=randomBytes(4).toString("hex");
  launch(`moovu-registration-auth-${suffix}`,"public.ecr.aws/supabase/gotrue:v2.197.0","18437:9999",{
    GOTRUE_DB_DRIVER:"postgres",GOTRUE_DB_DATABASE_URL:`postgresql://supabase_auth_admin:${encodeURIComponent(dbPassword)}@${source}:5432/${database}`,
    GOTRUE_API_HOST:"0.0.0.0",GOTRUE_API_PORT:"9999",API_EXTERNAL_URL:"http://127.0.0.1:18436/auth/v1",GOTRUE_SITE_URL:"http://127.0.0.1:18435",
    GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_ADMIN_ROLES:"service_role",GOTRUE_JWT_AUD:"authenticated",GOTRUE_JWT_DEFAULT_GROUP_NAME:"authenticated",
    GOTRUE_EXTERNAL_EMAIL_ENABLED:"true",GOTRUE_MAILER_AUTOCONFIRM:"false",GOTRUE_DISABLE_SIGNUP:"true",
  });
  launch(`moovu-registration-rest-${suffix}`,"public.ecr.aws/supabase/postgrest:v16.4","18434:3000",{
    PGRST_DB_URI:`postgresql://authenticator:${encodeURIComponent(dbPassword)}@${source}:5432/${database}`,PGRST_JWT_SECRET:secret,PGRST_DB_ANON_ROLE:"anon",PGRST_DB_SCHEMAS:"public",PGRST_DB_EXTRA_SEARCH_PATH:"extensions",
  });
  gateway=createServer(async(req,res)=>{
    const cors={"Access-Control-Allow-Origin":"http://127.0.0.1:18435","Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type,x-supabase-api-version,prefer,range","Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS","Access-Control-Expose-Headers":"X-Supabase-Api-Version,X-Request-Id"};
    if(req.method==="OPTIONS"){res.writeHead(204,cors).end();return;}
    const auth=req.url.startsWith("/auth/v1/");if(!auth&&!req.url.startsWith("/rest/v1/")){res.writeHead(404,cors).end();return;}
    try {
      const chunks=[];for await(const part of req)chunks.push(part);
      const response=await fetch(`http://127.0.0.1:${auth?18437:18434}${req.url.slice(8)}`,{method:req.method,headers:Object.fromEntries(Object.entries(req.headers).filter(([key])=>!["host","connection","content-length","origin"].includes(key))),body:["GET","HEAD"].includes(req.method)?undefined:Buffer.concat(chunks),signal:AbortSignal.timeout(30000)});
      const headers=Object.fromEntries([...response.headers].filter(([key])=>!["content-encoding","content-length","transfer-encoding","connection"].includes(key)));
      res.writeHead(response.status,{...headers,...cors});res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(502,cors).end();}
  });
  await new Promise(resolve=>gateway.listen(18436,"127.0.0.1",resolve));
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch("http://127.0.0.1:18437/health")).ok){ready=true;break;}}catch{}await delay(1000);}check("Real isolated GoTrue ready",ready);
  const admin=createClient("http://127.0.0.1:18436",service,{auth:{persistSession:false,autoRefreshToken:false}});
  const client=()=>createClient("http://127.0.0.1:18436",anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=async(email,p=password)=>{const c=client();const r=await c.auth.signInWithPassword({email,password:p});if(r.data.session){keep(r.data.session.access_token);keep(r.data.session.refresh_token);}return {...r,client:c};};
  const nodeEnv={...process.env,NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:18436",NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service};
  for(const key of Object.keys(nodeEnv))if(/FIREBASE|FCM|VAPID|GOOGLE|YOCO|SMTP|RESEND|QSTASH/.test(key))delete nodeEnv[key];
  if (broadcast) {
    nodeEnv.DISPATCH_JOB_SECRET=keep(randomBytes(32).toString("hex"));
    nodeEnv.MAPS_ROUTE_QUOTE_SECRET=keep(randomBytes(32).toString("hex"));
    nodeEnv.MOOVU_PHASE2_FINANCE_MODE='AUTHORITATIVE';
  }
  nodeEnv.NODE_ENV="production";
  const reuseBroadcastBuild=broadcast&&process.argv.includes('--broadcast-reuse-build');
  if(reuseBroadcastBuild)assert.ok(existsSync('.next/BUILD_ID'),'A previously validated local production build is required');
  const built=reuseBroadcastBuild?{status:0}:spawnSync(process.execPath,["node_modules/next/dist/bin/next","build",...(broadcast?[]:["--webpack"])],{env:nodeEnv,windowsHide:true,encoding:"utf8",timeout:broadcast?600000:300000,maxBuffer:10*1024*1024});
  if(built.status!==0)throw new Error(`Isolated production build failed (${built.error?.code??built.status}): ${String(built.stderr||built.stdout).slice(-2000)}`);
  check(reuseBroadcastBuild?'Reusing existing isolated build (not a fresh build check)':"Isolated production build",built.status===0);
  next=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","18435"],{env:nodeEnv,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  next.stdout.on("data",()=>{});next.stderr.on("data",()=>{});
  ready=false;for(let i=0;i<90;i++){try{if((await api("/api/customer/me")).status===401){ready=true;break;}}catch{}if(next.exitCode!==null)break;await delay(1000);}check("Actual Next API ready",ready);
  await broadcastHttpAcceptance({api,admin,login,sql,check,password,suffix,nodeEnv});
}catch(error){let message=error instanceof Error?error.message:"Registration certification failed";for(const value of secrets)message=message.replaceAll(value,"[redacted]");console.error(JSON.stringify({status:"FAIL",message:message.slice(0,1500)}));process.exitCode=1;}
finally{
  if(browser)await browser.close();
  if(next?.exitCode===null)spawnSync("taskkill",["/PID",String(next.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
  if(gateway)await new Promise(resolve=>gateway.close(resolve));
  for(const name of containers.reverse())spawnSync("docker",["rm","-f",name],{windowsHide:true,stdio:"ignore"});
  if (process.argv.includes('--broadcast') && /^registration_cert_[a-f0-9]{12}$/.test(database)) {
    spawnSync('docker',['exec',source,'dropdb','-U','postgres','--if-exists','--force',database],{windowsHide:true,stdio:'ignore'});
  }
  if(lock!==undefined){closeSync(lock);unlinkSync(lockPath);}
  console.log(JSON.stringify({summary:true,database,assertions,productionChanges:0}));
}
