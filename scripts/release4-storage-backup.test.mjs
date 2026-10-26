import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {encryptObject,decryptObject,sealManifest,certifyStorageBackup,
  credentialType,storageHeaders,classifyStorageStatus,storageRequest,currentInventory} from './release4-storage-backup.mjs';

const legacyKey=()=>{
  const payload=Buffer.from(JSON.stringify({role:'service_role',ref:'mvazbszenqahgqpznhhq'})).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic-signature`;
};
test('credential types use documented headers and reject public or malformed input',()=>{
  const jwt=legacyKey(),secret='sb_secret_synthetic-only';
  assert.equal(credentialType(jwt),'legacy-service-role');
  assert.equal(credentialType(secret),'secret');
  assert.deepEqual(storageHeaders(secret,'secret'),{apikey:secret});
  assert.deepEqual(storageHeaders(jwt,'legacy-service-role'),{apikey:jwt,Authorization:`Bearer ${jwt}`});
  assert.throws(()=>credentialType('sb_publishable_test'),/STORAGE_CREDENTIAL_UNSUPPORTED_PUBLIC/);
  assert.throws(()=>credentialType(' '+secret),/STORAGE_CREDENTIAL_WHITESPACE/);
  assert.throws(()=>credentialType('invalid'),/STORAGE_CREDENTIAL_UNSUPPORTED_TYPE/);
  const wrongProject=Buffer.from(JSON.stringify({role:'service_role',ref:'anotherproject'})).toString('base64url');
  assert.throws(()=>credentialType(`e30.${wrongProject}.signature`),/STORAGE_CREDENTIAL_PROJECT_MISMATCH/);
});
test('read-only credential request uses the pinned project and never prints a key',async()=>{
  const secret='sb_secret_synthetic-only';
  let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;
    assert.equal(url.origin,'https://mvazbszenqahgqpznhhq.supabase.co');
    assert.equal(url.pathname,'/storage/v1/bucket');
    assert.equal(options.method,'GET');
    assert.equal(options.headers.apikey,secret);
    assert.equal(options.headers.Authorization,undefined);
    return {status:200};
  };
  await storageRequest({endpoint:'/storage/v1/bucket',secret,type:'secret',operation:'STORAGE_BUCKET_LIST',fetchImpl});
  assert.equal(calls,1);
  await assert.rejects(storageRequest({endpoint:'https://otherproject.supabase.co/storage/v1/bucket',
    secret,type:'secret',operation:'STORAGE_BUCKET_LIST',fetchImpl}),/STORAGE_PROJECT_URL_INVALID/);
  assert.equal(calls,1);
});
test('HTTP and network categories remain distinct and redact all provider diagnostics',async()=>{
  const secret='sb_secret_synthetic-only';
  for(const [status,category] of [[400,'REQUEST_REJECTED'],[401,'HTTP_401'],[403,'HTTP_403'],[402,'HTTP_402'],
    [500,'HTTP_500'],[502,'HTTP_502'],[503,'HTTP_503'],[504,'HTTP_504']]){
    assert.equal(classifyStorageStatus(status,'STORAGE_BUCKET_LIST'),`STORAGE_BUCKET_LIST_${category}`);
    let calls=0;
    await assert.rejects(storageRequest({endpoint:'/storage/v1/bucket',secret,type:'secret',
      operation:'STORAGE_BUCKET_LIST',context:{bucket:'driver-docs',offset:100},
      fetchImpl:async()=>{calls++;return {status,headers:new Headers({'content-type':'text/html'}),privateError:'sensitive'};},
      sleepImpl:async()=>{}}),
      error=>error.message===`STORAGE_BUCKET_LIST_${category}`&&error.details.httpStatus===status&&
        error.details.bucket==='driver-docs'&&error.details.offset===100&&
        error.details.contentType==='text/html'&&!JSON.stringify(error.details).includes('sensitive'));
    assert.equal(calls,[500,502,503,504].includes(status)?3:1);
  }
  let attempts=0;
  await assert.rejects(storageRequest({endpoint:'/storage/v1/bucket',secret,type:'secret',
    operation:'STORAGE_BUCKET_LIST',fetchImpl:async()=>{attempts++;throw Error('private token');},
    sleepImpl:async()=>{}}),
    error=>error.message==='STORAGE_BUCKET_LIST_NETWORK_FAILED'&&error.details.retryCount===2);
  assert.equal(attempts,3);
  await assert.rejects(storageRequest({endpoint:'/storage/v1/bucket',secret,type:'secret',
    operation:'STORAGE_BUCKET_LIST',fetchImpl:async()=>{throw {name:'TimeoutError',message:'private'};},
    sleepImpl:async()=>{}}),
    error=>error.message==='STORAGE_BUCKET_LIST_TIMEOUT');
});
test('transient list failures retry and successful response uses correct POST body',async()=>{
  const secret='sb_secret_synthetic-only';
  let calls=0;
  const response=await storageRequest({endpoint:'/storage/v1/object/list/driver-docs',method:'POST',secret,
    type:'secret',operation:'STORAGE_OBJECT_LIST',context:{bucket:'driver-docs',offset:50},
    fetchImpl:async(url,options)=>{
      calls++;
      assert.equal(url.pathname,'/storage/v1/object/list/driver-docs');
      assert.equal(options.method,'POST');
      assert.deepEqual(JSON.parse(options.body),{prefix:'',limit:100,offset:50,sortBy:{column:'name',order:'asc'}});
      return {status:calls===1?429:calls===2?500:200};
    },body:{prefix:'',limit:100,offset:50,sortBy:{column:'name',order:'asc'}},
    sleepImpl:async()=>{}});
  assert.equal(response.status,200);
  assert.equal(calls,3);
});
test('inventory lists multiple pages, nested paths, and empty buckets without skips',async()=>{
  const root=Array.from({length:99},(_,i)=>({id:`id-${i}`,name:`file-${String(i).padStart(3,'0')}`,
    metadata:{size:2}}));
  const calls=[];
  const request=async options=>{
    calls.push(options);
    let data;
    if(options.operation==='STORAGE_BUCKET_LIST')data=[{id:'driver-docs',public:false},{id:'empty',public:false}];
    else if(options.context.bucket==='empty')data=[];
    else if(options.body.prefix==='nested')data=[{id:'child-id',name:'child',metadata:{size:3}}];
    else if(options.body.offset===0)data=[...root,{id:null,name:'nested'}];
    else if(options.body.offset===100)data=[{id:'last-id',name:'last',metadata:{size:4}}];
    else throw Error('unexpected pagination');
    return {json:async()=>data};
  };
  const inventory=await currentInventory('synthetic','secret',request);
  assert.equal(inventory.records.length,101);
  assert.equal(inventory.records.reduce((sum,item)=>sum+item.size,0),205);
  assert.ok(inventory.records.some(item=>item.name==='nested/child'));
  assert.equal(calls.filter(item=>item.operation==='STORAGE_OBJECT_LIST').length,4);
});
test('inventory rejects duplicate paths and malformed responses',async()=>{
  const bucket={json:async()=>[{id:'driver-docs',public:false}]};
  const duplicateRequest=async options=>options.operation==='STORAGE_BUCKET_LIST'?bucket:{json:async()=>[
    {id:'one',name:'same',metadata:{size:1}},{id:'two',name:'same',metadata:{size:1}}]};
  await assert.rejects(currentInventory('synthetic','secret',duplicateRequest),/STORAGE_DUPLICATE_PATH/);
  const malformedRequest=async options=>options.operation==='STORAGE_BUCKET_LIST'?bucket:
    {json:async()=>({unexpected:true})};
  await assert.rejects(currentInventory('synthetic','secret',malformedRequest),
    error=>error.message==='STORAGE_OBJECT_LIST_RESPONSE_INVALID'&&error.details.bucket==='driver-docs');
});

const parent='D:\\MOOVU Backup Tooling Test';
const withFixture=async callback=>{
  const directory=fs.mkdtempSync(path.join(parent,'storage-crypto-'));
  try{return await callback(directory);}
  finally{
    if(path.dirname(path.resolve(directory))!==path.resolve(parent)||!path.basename(directory).startsWith('storage-crypto-'))throw Error('UNSAFE_TEST_CLEANUP');
    fs.rmSync(directory,{recursive:true,force:true});
  }
};

test('object bytes encrypt and restore with exact count and checksum',async()=>withFixture(async directory=>{
  const data=Buffer.from('synthetic storage fixture only');
  const key=randomBytes(32),aad=Buffer.from('synthetic:1'),encrypted=path.join(directory,'object.enc');
  const restored=path.join(directory,'restored.txt');
  const result=await encryptObject({source:Readable.from([data]),destination:encrypted,key,aad,expectedSize:data.length});
  assert.equal(result.sha256,createHash('sha256').update(data).digest('hex'));
  assert.equal(fs.readFileSync(encrypted).includes(data),false);
  await decryptObject({source:encrypted,destination:restored,key,aad,expectedSize:data.length,expectedHash:result.sha256});
  assert.deepEqual(fs.readFileSync(restored),data);
}));

test('tampering and wrong ownership context fail authenticated restoration',async()=>withFixture(async directory=>{
  const data=Buffer.from('synthetic confidential document');
  const key=randomBytes(32),aad=Buffer.from('synthetic:1'),encrypted=path.join(directory,'object.enc');
  const result=await encryptObject({source:Readable.from([data]),destination:encrypted,key,aad,expectedSize:data.length});
  await assert.rejects(decryptObject({source:encrypted,destination:path.join(directory,'wrong-context'),key,
    aad:Buffer.from('synthetic:2'),expectedSize:data.length,expectedHash:result.sha256}));
  const bytes=fs.readFileSync(encrypted);bytes[22]^=1;fs.writeFileSync(encrypted,bytes);
  await assert.rejects(decryptObject({source:encrypted,destination:path.join(directory,'tampered'),key,
    aad,expectedSize:data.length,expectedHash:result.sha256}));
  assert.equal(fs.existsSync(path.join(directory,'wrong-context')),false);
  assert.equal(fs.existsSync(path.join(directory,'tampered')),false);
}));

test('a two-object encrypted backup restores in isolation with count and byte parity',async()=>withFixture(async directory=>{
  const passphrase='synthetic-backup-passphrase-only';
  const salt=randomBytes(16),key=scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
  const project='mvazbszenqahgqpznhhq';
  const values=[Buffer.from('one'),Buffer.from('second synthetic object')];
  const header=Buffer.from(JSON.stringify({format:'MOOVU-STORAGE-1',sourceProject:project,
    salt:salt.toString('base64'),N:32768,r:8,p:1,objectCount:values.length}));
  fs.writeFileSync(path.join(directory,'header.json'),header);
  const objects=[];
  for(const [offset,value] of values.entries()){
    const index=offset+1;
    const aad=Buffer.from(`${project}:${index}:${createHash('sha256').update(header).digest('hex')}`);
    const result=await encryptObject({source:Readable.from([value]),destination:path.join(directory,`${String(index).padStart(6,'0')}.enc`),
      key,aad,expectedSize:value.length});
    objects.push({index,size:value.length,sha256:result.sha256,bucket:'synthetic',name:`object-${index}`});
  }
  fs.writeFileSync(path.join(directory,'manifest.enc'),sealManifest({sourceProject:project,objects},key,header));
  assert.deepEqual(await certifyStorageBackup(directory,passphrase),{restored:2,bytes:values.reduce((sum,item)=>sum+item.length,0)});
  await assert.rejects(certifyStorageBackup(directory,'incorrect-synthetic-passphrase'));
}));
