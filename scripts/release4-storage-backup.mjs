// Read-only production Storage export. Private object bytes are encrypted before touching disk.
import fs from 'node:fs';
import path from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createCipheriv,createDecipheriv,createHash,randomBytes,scryptSync} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mainLib=path.resolve(root,'..','moovu-kasi-rides-redesign','scripts','lib','isolated-restore-certification.mjs');
const {protectRecoveryDirectory}=await import(pathToFileURL(mainLib));
const project='mvazbszenqahgqpznhhq';
const baseUrl=`https://${project}.supabase.co`;
const backupRoot='D:\\MOOVU Secure Backups\\Storage';
const restoreRoot='D:\\MOOVU Secure Backups\\Storage Restore Certification';
const objectMagic=Buffer.from('MOOVUOBJ1');
const kdf={N:32768,r:8,p:1,maxmem:64*1024*1024};
const fail=category=>{throw Error(category);};
export const classifyStorageFailure=(error,operation)=>{
  const status=Number(error?.status);
  const serviceCode=String(error?.statusCode??'');
  if(status===401||status===403||serviceCode==='401'||serviceCode==='403')return `${operation}_AUTH_FAILED`;
  if(status===400)return `${operation}_REQUEST_REJECTED`;
  if(status===402||status===429)return `${operation}_LIMITED`;
  if(status>=500&&status<600)return `${operation}_SERVER_FAILED`;
  if(error?.name==='StorageUnknownError')return `${operation}_NETWORK_FAILED`;
  return `${operation}_FAILED`;
};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const isBackupName=name=>/^storage-backup-\d{8}T\d{6}Z-[a-f0-9]{12}$/.test(name);
const objectFile=index=>`${String(index).padStart(6,'0')}.enc`;
const derive=(passphrase,salt)=>{
  if(typeof passphrase!=='string'||passphrase.length<20)fail('ENCRYPTION_PASSPHRASE_TOO_SHORT');
  return scryptSync(passphrase,salt,32,kdf);
};
const currentInventory=async client=>{
  const {data:buckets,error:bucketError}=await client.storage.listBuckets();
  if(bucketError)fail(classifyStorageFailure(bucketError,'STORAGE_BUCKET_LIST'));
  if(!Array.isArray(buckets))fail('STORAGE_BUCKET_LIST_RESPONSE_INVALID');
  const records=[];
  const bucketInfo=buckets.map(bucket=>({id:bucket.id,public:bucket.public})).sort((a,b)=>a.id.localeCompare(b.id));
  if(bucketInfo.some(bucket=>bucket.public))fail('UNEXPECTED_PUBLIC_BUCKET');
  for(const bucket of bucketInfo){
    const visited=new Set();
    const walk=async prefix=>{
      if(visited.has(prefix))fail('STORAGE_FOLDER_CYCLE');
      visited.add(prefix);
      for(let offset=0;;offset+=100){
        const {data,error}=await client.storage.from(bucket.id).list(prefix,
          {limit:100,offset,sortBy:{column:'name',order:'asc'}});
        if(error)fail(classifyStorageFailure(error,'STORAGE_OBJECT_LIST'));
        if(!Array.isArray(data))fail('STORAGE_OBJECT_LIST_RESPONSE_INVALID');
        for(const entry of data){
          const name=prefix?`${prefix}/${entry.name}`:entry.name;
          if(!entry.name||entry.name==='.'||entry.name==='..'||entry.name.includes('/')||name.startsWith('/'))fail('STORAGE_OBJECT_PATH_INVALID');
          if(entry.id===null)await walk(name);
          else {
            const size=Number(entry.metadata?.size);
            if(!Number.isSafeInteger(size)||size<0)fail('STORAGE_OBJECT_SIZE_INVALID');
            records.push({bucket:bucket.id,name,id:entry.id,version:entry.version??null,
              updatedAt:entry.updated_at??null,size,metadata:entry.metadata??null});
          }
        }
        if(data.length<100)break;
      }
    };
    await walk('');
  }
  records.sort((a,b)=>`${a.bucket}/${a.name}`.localeCompare(`${b.bucket}/${b.name}`));
  if(new Set(records.map(item=>`${item.bucket}\0${item.name}`)).size!==records.length)fail('STORAGE_DUPLICATE_PATH');
  return {buckets:bucketInfo,records};
};
const stableIdentity=item=>[item.bucket,item.name,item.id,item.version,item.updatedAt,item.size];
const destroyPrivateDirectory=(directory,parent,prefix)=>{
  const resolved=path.resolve(directory),base=path.resolve(parent);
  if(path.dirname(resolved)!==base||!path.basename(resolved).startsWith(prefix))fail('PRIVATE_CLEANUP_TARGET_INVALID');
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:8,retryDelay:500});
  if(fs.existsSync(resolved))fail('PRIVATE_CLEANUP_FAILED');
};

export async function encryptObject({source,destination,key,aad,expectedSize}){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);
  const digest=createHash('sha256');
  let size=0;
  fs.writeFileSync(destination,Buffer.concat([objectMagic,iv]),{flag:'wx',mode:0o600});
  try {
    await pipeline(source,new Transform({transform(chunk,_encoding,callback){
      size+=chunk.length;digest.update(chunk);callback(null,chunk);
    }}),cipher,fs.createWriteStream(destination,{flags:'a',mode:0o600}));
    fs.appendFileSync(destination,cipher.getAuthTag());
    if(size!==expectedSize)fail('STORAGE_OBJECT_SIZE_MISMATCH');
    return {size,sha256:digest.digest('hex')};
  } catch(error) {
    fs.rmSync(destination,{force:true});
    throw error;
  }
}
export async function decryptObject({source,destination,key,aad,expectedSize,expectedHash}){
  const stat=fs.statSync(source);
  if(stat.size<objectMagic.length+12+16)fail('ENCRYPTED_OBJECT_TRUNCATED');
  const header=Buffer.alloc(objectMagic.length+12),tag=Buffer.alloc(16);
  const handle=fs.openSync(source,'r');
  try {fs.readSync(handle,header,0,header.length,0);fs.readSync(handle,tag,0,16,stat.size-16);}
  finally {fs.closeSync(handle);}
  if(!header.subarray(0,objectMagic.length).equals(objectMagic))fail('ENCRYPTED_OBJECT_FORMAT_INVALID');
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(objectMagic.length));
  decipher.setAAD(aad);decipher.setAuthTag(tag);
  const digest=createHash('sha256');let size=0;
  try {
    const input=stat.size===header.length+16?Readable.from([]):fs.createReadStream(source,{start:header.length,end:stat.size-17});
    await pipeline(input,decipher,
      new Transform({transform(chunk,_encoding,callback){size+=chunk.length;digest.update(chunk);callback(null,chunk);}}),
      fs.createWriteStream(destination,{flags:'wx',mode:0o600}));
    if(size!==expectedSize||digest.digest('hex')!==expectedHash)fail('RESTORED_OBJECT_MISMATCH');
  } catch(error) {fs.rmSync(destination,{force:true});throw error;}
}
export const sealManifest=(manifest,key,header)=>{
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(header);
  const plaintext=Buffer.from(JSON.stringify(manifest));
  return Buffer.concat([iv,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
};
const openManifest=(sealed,key,header)=>{
  if(sealed.length<28)fail('ENCRYPTED_MANIFEST_TRUNCATED');
  const decipher=createDecipheriv('aes-256-gcm',key,sealed.subarray(0,12));
  decipher.setAAD(header);decipher.setAuthTag(sealed.subarray(-16));
  try{return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(12,-16)),decipher.final()]).toString('utf8'));}
  catch{fail('ENCRYPTED_MANIFEST_AUTH_FAILED');}
};
export async function certifyStorageBackup(directory,passphrase){
  const header=fs.readFileSync(path.join(directory,'header.json'));
  const parsed=JSON.parse(header.toString('utf8'));
  if(parsed.format!=='MOOVU-STORAGE-1'||parsed.sourceProject!==project||parsed.N!==32768||parsed.r!==8||parsed.p!==1)fail('STORAGE_HEADER_INVALID');
  const key=derive(passphrase,Buffer.from(parsed.salt,'base64'));
  const manifest=openManifest(fs.readFileSync(path.join(directory,'manifest.enc')),key,header);
  if(manifest.sourceProject!==project||!Array.isArray(manifest.objects)||manifest.objects.length!==parsed.objectCount)fail('STORAGE_MANIFEST_INVALID');
  protectRecoveryDirectory(restoreRoot);
  const target=path.join(restoreRoot,`restore-check-${randomBytes(6).toString('hex')}`);
  protectRecoveryDirectory(target);
  let restored=0,bytes=0;
  try{
    for(const item of manifest.objects){
      if(!Number.isSafeInteger(item.index)||item.index!==restored+1||!Number.isSafeInteger(item.size)||item.size<0||
         !/^[a-f0-9]{64}$/.test(item.sha256))fail('STORAGE_MANIFEST_INVALID');
      const aad=Buffer.from(`${project}:${item.index}:${sha256(header)}`);
      const localFile=path.join(target,objectFile(item.index)+'.restored');
      try{await decryptObject({source:path.join(directory,objectFile(item.index)),destination:localFile,
        key,aad,expectedSize:item.size,expectedHash:item.sha256});}
      finally{fs.rmSync(localFile,{force:true});}
      restored++;bytes+=item.size;
    }
    return {restored,bytes};
  }finally{destroyPrivateDirectory(target,restoreRoot,'restore-check-');}
}

async function main(){
  const mode=process.argv[2]??'--preflight';
  if(!['--preflight','--backup','--certify'].includes(mode)||process.argv.length>(mode==='--backup'?5:4))fail('INVALID_MODE');
  if(!fs.existsSync('D:\\'))fail('BACKUP_D_DRIVE_UNAVAILABLE');
  fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});
  protectRecoveryDirectory(backupRoot);
  const free=fs.statfsSync(backupRoot);if(BigInt(free.bavail)*BigInt(free.bsize)<4n*1024n*1024n*1024n)fail('BACKUP_D_SPACE_INSUFFICIENT');
  if(mode==='--preflight')return {status:'STORAGE_BACKUP_PREFLIGHT_PASS_PRIVATE_SECRETS_REQUIRED',productionConnected:false,project};
  if(mode==='--certify'){
    const archive=process.argv.find(value=>value.startsWith('--archive='))?.slice(10);
    const passphrase=process.env.MOOVU_STORAGE_BACKUP_PASSPHRASE;
    delete process.env.MOOVU_STORAGE_BACKUP_PASSPHRASE;
    if(!isBackupName(archive??'')||!passphrase)fail('PRIVATE_CERTIFICATION_INPUT_REQUIRED');
    const result=await certifyStorageBackup(path.join(backupRoot,archive),passphrase);
    return {status:'STORAGE_RESTORE_CERTIFIED',archive,objects:result.restored,bytes:result.bytes,
      isolatedRestore:true,temporaryPlaintextRemoved:true,productionConnected:false};
  }
  const secret=process.env.MOOVU_STORAGE_SERVICE_ROLE_KEY;
  const passphrase=process.env.MOOVU_STORAGE_BACKUP_PASSPHRASE;
  delete process.env.MOOVU_STORAGE_SERVICE_ROLE_KEY;
  delete process.env.MOOVU_STORAGE_BACKUP_PASSPHRASE;
  if(!secret||!passphrase)fail('PRIVATE_SECRETS_REQUIRED');
  const expectedCount=Number(process.argv.find(value=>value.startsWith('--expected-count='))?.slice(17));
  const expectedBytes=Number(process.argv.find(value=>value.startsWith('--expected-bytes='))?.slice(17));
  if(!Number.isSafeInteger(expectedCount)||expectedCount<1||!Number.isSafeInteger(expectedBytes)||expectedBytes<1)fail('STORAGE_EXPECTED_INVENTORY_REQUIRED');
  const keySalt=randomBytes(16),key=derive(passphrase,keySalt);
  const client=createClient(baseUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const before=await currentInventory(client);
  const totalBytes=before.records.reduce((sum,item)=>sum+item.size,0);
  if(before.records.length!==expectedCount||totalBytes!==expectedBytes)fail('STORAGE_LIVE_INVENTORY_DIFFERS_FROM_READONLY_CATALOG');
  const backupName=`storage-backup-${new Date().toISOString().replace(/[-:]/g,'').slice(0,15)}Z-${randomBytes(6).toString('hex')}`;
  if(!isBackupName(backupName))fail('STORAGE_BACKUP_NAME_INVALID');
  const directory=path.join(backupRoot,backupName);protectRecoveryDirectory(directory);
  let completed=false;
  try{
    const header=Buffer.from(JSON.stringify({format:'MOOVU-STORAGE-1',sourceProject:project,
      createdAt:new Date().toISOString(),salt:keySalt.toString('base64'),N:32768,r:8,p:1,
      objectCount:before.records.length,totalBytes}));
    const objects=[];
    for(const [offset,item] of before.records.entries()){
      const index=offset+1;
      const encodedPath=item.name.split('/').map(encodeURIComponent).join('/');
      const url=`${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(item.bucket)}/${encodedPath}`;
      let response;
      try{response=await fetch(url,{method:'GET',redirect:'manual',headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Accept-Encoding':'identity'},signal:AbortSignal.timeout(120000)});}
      catch{fail('STORAGE_NETWORK_OR_TIMEOUT_FAILED');}
      if(response.status===401||response.status===403)fail('STORAGE_READ_AUTH_FAILED');
      if(response.status===404)fail('STORAGE_OBJECT_MISSING');
      if(response.status===429)fail('STORAGE_RATE_LIMITED');
      if(response.status>=500)fail('STORAGE_SERVER_ERROR');
      if(response.status!==200||!response.body)fail('STORAGE_DOWNLOAD_FAILED');
      const aad=Buffer.from(`${project}:${index}:${sha256(header)}`);
      const downloaded=await encryptObject({source:Readable.fromWeb(response.body),
        destination:path.join(directory,objectFile(index)),key,aad,expectedSize:item.size});
      objects.push({...item,index,sha256:downloaded.sha256});
    }
    const after=await currentInventory(client);
    if(JSON.stringify(before.buckets)!==JSON.stringify(after.buckets)||
       JSON.stringify(before.records.map(stableIdentity))!==JSON.stringify(after.records.map(stableIdentity)))fail('STORAGE_INVENTORY_CHANGED_DURING_BACKUP');
    fs.writeFileSync(path.join(directory,'header.json'),header,{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(directory,'manifest.enc'),sealManifest({sourceProject:project,buckets:before.buckets,objects},key,header),{flag:'wx',mode:0o600});
    const verified=await certifyStorageBackup(directory,passphrase);
    if(verified.restored!==objects.length||verified.bytes!==totalBytes)fail('STORAGE_RESTORE_PARITY_FAILED');
    completed=true;
    return {status:'STORAGE_BACKUP_AND_RESTORE_CERTIFIED',project,archive:backupName,
      objects:objects.length,bytes:totalBytes,manifestSha256:sha256(fs.readFileSync(path.join(directory,'manifest.enc'))),
      encrypted:true,restoreCertified:true,storageWritesRequested:false};
  }finally{
    if(!completed)destroyPrivateDirectory(directory,backupRoot,'storage-backup-');
  }
}

if(process.argv[1]&&fileURLToPath(import.meta.url).toLowerCase()===process.argv[1].toLowerCase()){
  try{console.log(JSON.stringify(await main()));}
  catch(error){const category=error.message;console.error(JSON.stringify({status:'STORAGE_BACKUP_BLOCKED',category:/^(STORAGE_|BACKUP_|PRIVATE_|ENCRYPTED_|ENCRYPTION_|RESTORED_)/.test(category)?category:'STORAGE_BACKUP_FAILED'}));process.exitCode=1;}
}
