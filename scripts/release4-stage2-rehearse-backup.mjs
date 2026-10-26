// Local-only, owner-run data-backed rehearsal. No network path to production.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backupLib=path.resolve(repository,'..','moovu-kasi-rides-redesign','scripts','lib');
const {withPrivateRestoreArchive}=await import(pathToFileURL(path.join(backupLib,'private-restore-archive.mjs')));
const {withDockerRecoveryCluster}=await import(pathToFileURL(path.join(backupLib,'docker-recovery-cluster.mjs')));
const {protectRecoveryDirectory,prepareArchiveSchemas,prepareRecoveryExtensions}=await import(pathToFileURL(path.join(backupLib,'isolated-restore-certification.mjs')));
const backupRoot='D:\\MOOVU Secure Backups';
const name='moovu-mvazbszenqahgqpznhhq-1793002143679.moovubak';
const file=path.join(backupRoot,name);
const expectedSize=10504835;
const expectedSha='1A8E63E716F7AABD67012925AC7C3D29EF306049EF285CF0E28BBEA99CA4A7A2';
const image='public.ecr.aws/supabase/postgres:17.11.0.004';
const privateRoot='D:\\MOOVU Secure Backups\\Stage2 Data Rehearsal';
const fail=category=>{throw Error(category);};
const literal=value=>`'${value.replaceAll("'","''")}'`;
const ident=value=>`"${value.replaceAll('"','""')}"`;
const native=(args,category,timeout=120000)=>{
  const result=spawnSync('docker',args,{encoding:'utf8',timeout,maxBuffer:16*1024*1024,windowsHide:true});
  if(result.status!==0||result.error)fail(category);
  return result.stdout.trim();
};

try {
  if(!fs.existsSync(file)||fs.statSync(file).size!==expectedSize)fail('EXACT_BACKUP_SIZE_MISMATCH');
  const actual=createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
  if(actual!==expectedSha)fail('EXACT_BACKUP_HASH_MISMATCH');
  const sidecar=JSON.parse(fs.readFileSync(file+'.metadata.json','utf8'));
  if(sidecar.sourceProject!=='mvazbszenqahgqpznhhq'||sidecar.safeFilename!==name||
     sidecar.sha256?.toUpperCase()!==expectedSha||sidecar.size!==expectedSize||
     sidecar.productionMutated!==false||!sidecar.sourceCounts)fail('BACKUP_METADATA_MISMATCH');
  if(process.argv.includes('--preflight')) {
    console.log(JSON.stringify({status:'STAGE2_BACKUP_REHEARSAL_PREFLIGHT_PASS_PRIVATE_PASSPHRASE_REQUIRED',productionConnected:false,archiveSha256:expectedSha}));
  } else {
    if(process.argv.length!==2)fail('INVALID_MODE');
    const passphrase=process.env.MOOVU_STAGE2_BACKUP_PASSPHRASE;
    delete process.env.MOOVU_STAGE2_BACKUP_PASSPHRASE;
    if(!passphrase)fail('PRIVATE_PASSPHRASE_REQUIRED');
    fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});
    const result=await withPrivateRestoreArchive({file,passphrase,root:privateRoot,image,protectRecoveryDirectory},
      async({directory,toc,metadata})=>{
        if(metadata.sourceProject!=='mvazbszenqahgqpznhhq'||
           JSON.stringify(metadata.sourceCounts)!==JSON.stringify(sidecar.sourceCounts))fail('AUTHENTICATED_METADATA_MISMATCH');
        return withDockerRecoveryCluster({image,root:privateRoot,protectRecoveryDirectory,archiveDirectory:directory},
          async({query,directory:clusterDirectory,dockerContainer,target})=>{
            prepareArchiveSchemas(toc,query);
            const roles=new Set(['anon','authenticated','service_role','authenticator','supabase_admin',
              'supabase_auth_admin','supabase_storage_admin','supabase_realtime_admin','supabase_functions_admin',
              'supabase_replication_admin','supabase_privileged_role','supabase_read_only_user','supabase_etl_admin',
              'dashboard_user','pgbouncer']);
            for(const line of toc.split(/\r?\n/)){
              const role=line.match(/^\d+;.* ([a-z_][a-z0-9_]*)$/)?.[1];
              if(role&&role!=='postgres')roles.add(role);
            }
            for(const role of roles)query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${literal(role)}) THEN CREATE ROLE ${ident(role)} NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;`);
            const entries=toc.split(/\r?\n/).filter(line=>/^\d+;/.test(line));
            const namespaces=entries.filter(line=>/^\d+; \d+ \d+ SCHEMA /.test(line));
            const remaining=entries.filter(line=>!namespaces.includes(line));
            fs.writeFileSync(path.join(clusterDirectory,'namespace.list'),namespaces.join('\n')+'\n',{mode:0o600,flag:'wx'});
            fs.writeFileSync(path.join(clusterDirectory,'remaining.list'),remaining.join('\n')+'\n',{mode:0o600,flag:'wx'});
            const restore=(list,sections=[])=>native(['exec',dockerContainer,'pg_restore','-U','supabase_admin','-d',target.database,
              '--no-owner','--exit-on-error','--single-transaction','--use-list',`/recovery/${list}`,
              ...sections.map(section=>`--section=${section}`),'/archive/archive.dump'],'ISOLATED_RESTORE_FAILED',300000);
            if(namespaces.length)restore('namespace.list');
            const available=JSON.parse(query("select coalesce(jsonb_agg(name),'[]') from pg_available_extensions;"));
            const requiredExtensions=[...toc.matchAll(/^\d+;.* EXTENSION - ([^ ]+) /gm)].map(match=>match[1]);
            prepareRecoveryExtensions({query,requiredExtensions,available});
            restore('remaining.list',['pre-data']);
            restore('remaining.list',['data','post-data']);
            for(const [relation,expectedCount] of Object.entries(metadata.sourceCounts)){
              if(!/^(public|private|auth|storage|supabase_migrations|extensions)\.[a-z_][a-z0-9_]*$/.test(relation))fail('SOURCE_TABLE_METADATA_INVALID');
              const [schema,table]=relation.split('.');
              const count=Number(query(`SELECT count(*) FROM ${ident(schema)}.${ident(table)};`));
              if(count!==expectedCount)fail('RESTORED_COUNT_MISMATCH');
            }
            const env={...process.env,MOOVU_STAGE2_FIXTURE:'true',MOOVU_STAGE2_FIXTURE_CONTAINER:dockerContainer,
              PGDATABASE:target.database,PGUSER:'supabase_admin',PGSSLMODE:'disable'};
            const runner=path.join(repository,'scripts','release4-stage2-migrate.mjs');
            const execute=()=>spawnSync(process.execPath,[runner,'--execute-fixture'],
              {env,encoding:'utf8',timeout:900000,maxBuffer:1024*1024,windowsHide:true});
            const first=execute();
            if(first.status!==0)fail('FIVE_FILE_RUNNER_FAILED');
            const firstResult=JSON.parse(first.stdout.trim().split(/\r?\n/).at(-1));
            if(firstResult.status!=='STAGE2_FIVE_FILE_MIGRATIONS_APPLIED')fail('FIVE_FILE_RUNNER_INCOMPLETE');
            const repeat=execute();
            if(repeat.status!==0||JSON.parse(repeat.stdout.trim()).status!=='STAGE2_ALREADY_APPLIED')fail('REAPPLICATION_GUARD_FAILED');
            return {status:'STAGE2_CERTIFIED_BACKUP_REHEARSAL_PASS',productionConnected:false,
              countsCompared:Object.keys(metadata.sourceCounts).length,versions:firstResult.versions,
              financialInvariants:firstResult.financialInvariants,objects:firstResult.objects,
              alreadyAppliedGuard:true,managedRoleEquivalence:false};
          });
      });
    console.log(JSON.stringify({...result,transientPlaintextRemoved:true,isolatedTargetDestroyed:true}));
  }
} catch(error) {
  console.error(JSON.stringify({status:'STAGE2_BACKUP_REHEARSAL_BLOCKED',category:error.message}));
  process.exitCode=1;
}
