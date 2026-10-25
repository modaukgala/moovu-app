import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const source="supabase_db_moovu-critical-reliability-fixture";
const database=`registration_cert_${randomBytes(6).toString("hex")}`;
const network="supabase_network_moovu-critical-reliability-fixture";
const secrets=[];const containers=[];let next,browser,gateway;let assertions=0;
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
  assert.equal(r.status,0,"Start isolated service; raw output withheld");containers.push(name);
}
async function api(path,body,token) {
  const r=await fetch(`http://127.0.0.1:18435${path}`,{method:body===undefined?"GET":"POST",headers:{...(body===undefined?{}:{"Content-Type":"application/json"}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  return {status:r.status,body:await r.json().catch(()=>null)};
}
const password=keep(randomBytes(24).toString("base64url")+"Aa1");
const form=(email,phone)=>({first_name:"Synthetic",last_name:"Registration",email,phone,password,acceptedTerms:true,acceptedPrivacy:true,termsVersion:"2026-06-23",privacyVersion:"2026-06-23"});
try {
  const inspected=JSON.parse(docker(["inspect",source]))[0];
  const env=Object.fromEntries(inspected.Config.Env.map(item=>{const i=item.indexOf("=");return [item.slice(0,i),item.slice(i+1)];}));
  const dbPassword=keep(env.POSTGRES_PASSWORD??env.PGPASSWORD);
  assert.ok(dbPassword,"Existing local database password unavailable");
  docker(["exec",source,"psql","-U","postgres","-d","postgres","-c",`create database ${database}`]);
  const schema=docker(["exec",source,"pg_dump","-U","postgres","-d","postgres","--schema-only","--no-publications","--no-subscriptions","--exclude-schema=_realtime","--exclude-schema=realtime"]);
  sql(schema,"supabase_admin");
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
  nodeEnv.NODE_ENV="production";
  const built=spawnSync(process.execPath,["node_modules/next/dist/bin/next","build","--webpack"],{env:nodeEnv,windowsHide:true,encoding:"utf8",timeout:300000,maxBuffer:10*1024*1024});
  check("Isolated production build",built.status===0);
  next=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port","18435"],{env:nodeEnv,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  next.stdout.on("data",()=>{});next.stderr.on("data",()=>{});
  ready=false;for(let i=0;i<90;i++){try{if((await api("/api/customer/me")).status===401){ready=true;break;}}catch{}if(next.exitCode!==null)break;await delay(1000);}check("Actual Next API ready",ready);
  const email=`customer-${suffix}@example.invalid`;
  check("Invalid cellphone rejected",(await api("/api/customer/register",form(email,"064606857312"))).status===400);
  check("Missing required fields rejected",(await api("/api/customer/register",{...form(email,"0646000001"),last_name:""})).status===400);
  const registered=await api("/api/customer/register",form(email,"+27646000001"));
  check("New cellphone customer registration succeeds",registered.body?.ok===true);
  const session=await login(email);check("New customer password login succeeds",!session.error);
  const token=session.data.session.access_token;
  check("Customer profile resolves through actual API",(await api("/api/customer/me",undefined,token)).body?.ok===true);
  for(const phone of ["0646000001","+27646000001","27646000001"]){check("Equivalent phone finds same existing account",(await api("/api/customer/check-phone",{identifier:phone})).body?.exists===true);}
  check("Duplicate signup does not create another customer",(await api("/api/customer/register",form(email,"0646000002"))).status===409&&count("customers")===1);
  check("Registration did not verify phone ownership",sql(`select phone_confirmed_at is null from auth.users where id='${session.data.user.id}'`)==="t");
  const disconnected=await login(email);const logout=await disconnected.client.auth.signOut({scope:"local"});check("Customer logs out and signs in again",!logout.error&&!(await login(email)).error);
  const older=await admin.auth.admin.createUser({email:`older-${suffix}@example.invalid`,password,email_confirm:true,user_metadata:{first_name:"Synthetic",last_name:"Older",phone:"0646000003",customer_email:`older-${suffix}@example.invalid`}});
  assert.ok(!older.error);const olderId=older.data.user.id;
  sql(`update auth.users set created_at=now()-interval '2 days' where id='${olderId}'`);
  // Clone a real synthetic GoTrue row, not incomplete hand-written Auth rows.
  // Generated columns are excluded. All copied values stay inside this local DB.
  const columns=sql("select string_agg(quote_ident(attname),',' order by attnum) from pg_attribute where attrelid='auth.users'::regclass and attnum>0 and not attisdropped and attgenerated=''");
  const projected=columns.split(",").map(column=>`clone.${column}`).join(",");
  sql(`insert into auth.users(${columns}) select ${projected} from auth.users template cross join generate_series(1,2002) g cross join lateral jsonb_populate_record(null::auth.users,to_jsonb(template)||jsonb_build_object('id',gen_random_uuid(),'email','padding-'||g||'-${suffix}@example.invalid','created_at',case when g<=1001 then now()-interval '3 days' else now() end,'updated_at',now())) clone where template.id='${olderId}'`);
  const pageOne=await admin.auth.admin.listUsers();
  assert.ok(!pageOne.error,`Real Auth pagination must succeed (code ${pageOne.error?.code??"none"}, status ${pageOne.error?.status??0})`);
  console.log(JSON.stringify({diagnostic:"pagination-fixture",databaseAuthRows:Number(sql("select count(*) from auth.users")),defaultPageUsers:pageOne.data.users.length}));
  check("Late-page test identity really absent from default page",!pageOne.data.users.some(u=>u.id===olderId));
  check("Test identity requires the second explicit page",!(await admin.auth.admin.listUsers({page:1,perPage:1000})).data.users.some(u=>u.id===olderId));
  const lookup=await api("/api/customer/check-phone",{identifier:`older-${suffix}@example.invalid`});
  check("Email identity beyond first page routes to sign-in",lookup.body?.exists===true);
  check("Late-page duplicate returns conflict, not generic 500",(await api("/api/customer/register",form(`older-${suffix}@example.invalid`,"0646000003"))).status===409);
  const oldSession=await login(`older-${suffix}@example.invalid`);
  check("Authenticated orphan customer repairs its own profile",(await api("/api/customer/me",undefined,oldSession.data.session.access_token)).body?.ok===true);
  check("Partial recovery is idempotent",(await api("/api/customer/me",undefined,oldSession.data.session.access_token)).body?.ok===true&&count("customers")===2);
  const failureEmail=`failure-${suffix}@example.invalid`;
  sql(`create function public.registration_test_failure() returns trigger language plpgsql as $$ begin if new.email='${failureEmail}' then raise exception 'Isolated profile fault'; end if; return new; end $$; create trigger registration_test_failure before insert on public.customers for each row execute function public.registration_test_failure();`);
  check("Real profile persistence fault returns safe retry guidance",(await api("/api/customer/register",form(failureEmail,"0646000005"))).status===503);
  check("Failed profile creation retains exactly one Auth identity",sql(`select count(*) from auth.users where email='${failureEmail}'`)==="1");
  sql("drop trigger registration_test_failure on public.customers; drop function public.registration_test_failure()");
  const recovered=await login(failureEmail);
  check("Actual profile fault recovers after authenticated login",!recovered.error&&(await api("/api/customer/me",undefined,recovered.data.session.access_token)).body?.ok===true);
  check("Retry cannot reset existing identity password",(await api("/api/customer/register",{...form(failureEmail,"0646000005"),password:"DifferentPassword123"})).status===409&&!(await login(failureEmail)).error);
  const raceEmail=`race-${suffix}@example.invalid`;
  const raced=await Promise.all([api("/api/customer/register",form(raceEmail,"0646000007")),api("/api/customer/register",form(raceEmail,"0646000007"))]);
  console.log(JSON.stringify({diagnostic:"concurrent-signup",responses:raced.map(r=>({status:r.status,code:r.body?.code??null}))}));
  check("Concurrent signup has one identity and a safe conflict or retry state",raced.filter(r=>r.body?.ok===true).length===1&&raced.filter(r=>[409,503].includes(r.status)).length===1&&sql(`select count(*) from auth.users where email='${raceEmail}'`)==="1");
  check("Retry after concurrent completion is a duplicate conflict",(await api("/api/customer/register",form(raceEmail,"0646000007"))).status===409);
  const unverified=await admin.auth.admin.createUser({email:`verify-${suffix}@example.invalid`,password,email_confirm:false});assert.ok(!unverified.error);
  const verificationAttempt=await login(`verify-${suffix}@example.invalid`);
  console.log(JSON.stringify({diagnostic:"verification",code:verificationAttempt.error?.code??null,status:verificationAttempt.error?.status??null,emailConfirmed:sql(`select email_confirmed_at is not null from auth.users where id='${unverified.data.user.id}'`)}));
  check("Unverified email cannot sign in",verificationAttempt.error?.code==="email_not_confirmed");
  for(const role of ["admin","driver"]){
    const identity=await admin.auth.admin.createUser({email:`${role}-${suffix}@example.invalid`,password,email_confirm:true,user_metadata:{first_name:"Synthetic",last_name:role,phone:"0646000004"}});assert.ok(!identity.error);
    sql(`insert into public.profiles(id,role) values('${identity.data.user.id}','${role}')`);
    const signed=await login(`${role}-${suffix}@example.invalid`);check(`${role} existing Auth login unchanged`,!signed.error);
    check(`${role} cannot acquire a customer profile through recovery`,(await api("/api/customer/me",undefined,signed.data.session.access_token)).status===403);
  }
  const own=client();await own.auth.setSession({access_token:token,refresh_token:session.data.session.refresh_token});
  const rows=await own.from("customers").select("auth_user_id");check("Direct customer table access exposes no other profile",rows.error?rows.error.code==="42501":rows.data.every(row=>row.auth_user_id===session.data.user.id));
  const ownProfile=(await api("/api/customer/me",undefined,token)).body?.customer?.id;
  const guessed=await api(`/api/customer/me?auth_user_id=${olderId}`,undefined,token);
  check("Guessed profile identifiers cannot override authenticated ownership",typeof ownProfile==="string"&&guessed.status===200&&guessed.body?.customer?.id===ownProfile);
  check("Unauthenticated profile recovery rejected",(await api("/api/customer/me")).status===401);
  const require=createRequire("C:/Users/kgala/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/package.json");
  const {chromium}=require("playwright");browser=await chromium.launch({channel:"msedge",headless:true});
  const context=await browser.newContext();await context.route("**/*",r=>["127.0.0.1","localhost"].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  const page=await context.newPage();await page.goto("http://127.0.0.1:18435/customer/auth?next=/book",{timeout:90000});
  await page.getByPlaceholder("Email address or cellphone number").fill(email);await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByPlaceholder("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Login",exact:true}).click();
  await page.waitForURL(url=>url.pathname==="/book",{timeout:90000,waitUntil:"domcontentloaded"});check("Real customer browser sign-in reaches booking",true);
  const signupContext=await browser.newContext();await signupContext.route("**/*",r=>["127.0.0.1","localhost"].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  const browserEmail=`browser-123456789012-${suffix}@example.invalid`;
  const signup=await signupContext.newPage();await signup.goto("http://127.0.0.1:18435/customer/auth?next=/book",{timeout:90000});
  await signup.getByPlaceholder("Email address or cellphone number").fill(browserEmail);
  const checked=signup.waitForResponse(r=>r.url().includes("/api/customer/check-phone")&&r.request().method()==="POST",{timeout:30000});
  await signup.getByRole("button",{name:"Continue",exact:true}).click();
  const checkResponse=await checked;const checkBody=await checkResponse.json();
  check("Browser email lookup permits new registration",checkResponse.status()===200&&checkBody.ok===true&&checkBody.exists===false);
  await signup.getByPlaceholder("Cellphone number",{exact:true}).fill("0646000006");
  await signup.getByPlaceholder("First name",{exact:true}).fill("Synthetic");await signup.getByPlaceholder("Surname",{exact:true}).fill("Browser");
  await signup.getByPlaceholder("Password",{exact:true}).fill(password);await signup.getByRole("checkbox").check();
  await signupContext.setOffline(true);
  await signup.getByRole("button",{name:"Create account",exact:true}).click();
  await signup.getByRole("dialog").waitFor({state:"visible",timeout:15000});
  check("Offline submission does not create an Auth identity",sql(`select count(*) from auth.users where email='${browserEmail}'`)==="0");
  await signupContext.setOffline(false);await signup.getByRole("button",{name:"Close message",exact:true}).click();
  await signup.getByRole("button",{name:"Create account",exact:true}).click();
  await signup.waitForURL(url=>url.pathname==="/book",{timeout:90000,waitUntil:"domcontentloaded"});check("Real browser email-entry registration reaches booking",true);
  check("No trips or financial ledger entries created",count("trips")===0&&count("financial_ledger_entries")===0);
}catch(error){let message=error instanceof Error?error.message:"Registration certification failed";for(const value of secrets)message=message.replaceAll(value,"[redacted]");console.error(JSON.stringify({status:"FAIL",message:message.slice(0,1500)}));process.exitCode=1;}
finally{
  if(browser)await browser.close();
  if(next?.exitCode===null)spawnSync("taskkill",["/PID",String(next.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
  if(gateway)await new Promise(resolve=>gateway.close(resolve));
  for(const name of containers.reverse())spawnSync("docker",["rm","-f",name],{windowsHide:true,stdio:"ignore"});
  console.log(JSON.stringify({summary:true,database,assertions,productionChanges:0}));
}
