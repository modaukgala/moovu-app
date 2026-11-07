// Isolated schema-only rehearsal. Never accepts a network database target.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planMigrations, migrationSql } from './release4-stage2-migrate.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sibling = path.resolve(root, '..', 'moovu-kasi-rides-redesign', 'scripts', 'lib');
const { prepareArchiveSchemas, prepareRecoveryExtensions } =
  await import(pathToFileURL(path.join(sibling, 'isolated-restore-certification.mjs')));
const archive = path.join(process.env.USERPROFILE ?? '', 'MOOVU Secure Backups',
  'moovu-mvazbszenqahgqpznhhq-1793001291254-schema-only.dump');
const expectedSha = '6E0E01BC4DC4D1C3F8531CA7CDF5E8A9C770B9C6ECC85F350FD8B89D663F2CF6';
const recoveryRoot = 'D:\\MOOVU Secure Backups\\Option B Schema Rehearsal';
const dockerContainer = 'supabase_db_moovu-release4-local-cert-20261021';
const fail = (category, detail = '') => { throw new Error(`${category}${detail ? `: ${detail}` : ''}`); };
const literal = value => `'${value.replaceAll("'", "''")}'`;
const ident = value => `"${value.replaceAll('"', '""')}"`;
if (!fs.existsSync(archive) || fs.statSync(archive).size !== 1081535 ||
  createHash('sha256').update(fs.readFileSync(archive)).digest('hex').toUpperCase() !== expectedSha) {
  fail('SCHEMA_ARCHIVE_MISMATCH');
}

const docker = (args, input, timeout = 180000) => {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0 || result.error) fail('LOCAL_DOCKER_COMMAND_FAILED', result.stderr?.slice(0, 350));
  return result.stdout.trim();
};
const inspected = docker(['inspect', dockerContainer, '--format', '{{.Name}}|{{.State.Running}}']);
if (inspected !== `/${dockerContainer}|true`) fail('LOCAL_FIXTURE_CONTAINER_UNAVAILABLE');
const database = `moovu_option_b_${randomUUID().replaceAll('-', '')}`;
const directory = path.join(recoveryRoot, database);
fs.mkdirSync(directory, { recursive: true });
const remoteRoot = `/tmp/${database}`;
let created = false;
try {
  docker(['exec', dockerContainer, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X',
    '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `create database ${ident(database)} template template0;`]);
  created = true;
  docker(['exec', dockerContainer, 'mkdir', '-p', remoteRoot]);
  const target = { database };
  const query = sql => docker(['exec', '-i', dockerContainer, 'psql', '-U', 'supabase_admin',
    '-d', database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], sql);
  const result = await (async () => {
    const schemaPath = path.join(directory, 'schema.dump');
    fs.copyFileSync(archive, schemaPath, fs.constants.COPYFILE_EXCL);
    docker(['cp', schemaPath, `${dockerContainer}:${remoteRoot}/schema.dump`]);
    const toc = docker(['exec', dockerContainer, 'pg_restore', '--list', `${remoteRoot}/schema.dump`]);
    prepareArchiveSchemas(toc, query);
    const roles = new Set(['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin',
      'supabase_auth_admin', 'supabase_storage_admin', 'supabase_realtime_admin',
      'supabase_functions_admin', 'supabase_replication_admin', 'supabase_privileged_role',
      'supabase_read_only_user', 'supabase_etl_admin', 'dashboard_user', 'pgbouncer']);
    for (const line of toc.split(/\r?\n/)) {
      const role = line.match(/^\d+;.* ([a-z_][a-z0-9_]*)$/)?.[1];
      if (role && role !== 'postgres') roles.add(role);
    }
    for (const role of roles) if (query(`select count(*) from pg_roles where rolname=${literal(role)};`) !== '1')
      fail('LOCAL_MANAGED_ROLE_UNAVAILABLE');
    const entries = toc.split(/\r?\n/).filter(line => /^\d+;/.test(line));
    const namespaces = entries.filter(line => /^\d+; \d+ \d+ SCHEMA /.test(line));
    fs.writeFileSync(path.join(directory, 'namespace.list'), namespaces.join('\n') + '\n');
    fs.writeFileSync(path.join(directory, 'remaining.list'), entries.filter(line => !namespaces.includes(line)).join('\n') + '\n');
    docker(['cp', path.join(directory, 'namespace.list'), `${dockerContainer}:${remoteRoot}/namespace.list`]);
    docker(['cp', path.join(directory, 'remaining.list'), `${dockerContainer}:${remoteRoot}/remaining.list`]);
    const restore = (list, sections = []) => docker(['exec', dockerContainer, 'pg_restore',
      '-U', 'supabase_admin', '-d', target.database, '--no-owner', '--exit-on-error',
      '--single-transaction', `--use-list=${remoteRoot}/${list}`,
      ...sections.map(section => `--section=${section}`), `${remoteRoot}/schema.dump`]);
    if (namespaces.length) restore('namespace.list');
    const available = JSON.parse(query("select coalesce(jsonb_agg(name),'[]') from pg_available_extensions;"));
    const requiredExtensions = [...toc.matchAll(/^\d+;.* EXTENSION - ([^ ]+) /gm)].map(match => match[1]);
    prepareRecoveryExtensions({ query, requiredExtensions, available });
    restore('remaining.list', ['pre-data']);
    restore('remaining.list', ['data', 'post-data']);
    const run = sql => docker(['exec', '-i', dockerContainer, 'psql', '-U', 'supabase_admin',
      '-d', target.database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], sql);
    const stage1 = ['20261022120000', '20261022123000', '20261022182716'];
    for (const version of stage1) run(`insert into supabase_migrations.schema_migrations(version,name) values (${literal(version)},'local_schema_history');`);
    for (const migration of planMigrations()) run(migrationSql(migration));
    const sixth = fs.readFileSync(path.join(root, 'docs', 'release4-forward-only-payout-activation.sql'), 'utf8');
    run(sixth.replace(/commit\s*;\s*$/i,
      "insert into supabase_migrations.schema_migrations(version,name) values ('20261027150000','release4_forward_only_payout_activation'); commit;"));
    run(fs.readFileSync(path.join(root, 'supabase', 'migrations',
      '20261106165812_option_b_online_payout_allocation.sql'), 'utf8'));
    run(fs.readFileSync(path.join(root, 'scripts', 'option-b-local-fixture.sql'), 'utf8'));
    const policyColumn = query("select count(*) from information_schema.columns where table_schema='public' and table_name='online_payout_policy' and column_name='option_b_effective_at';");
    const batchConstraint = query("select count(*) from pg_constraint where conrelid='public.online_payout_batches'::regclass and conname='online_payout_batches_check1';");
    const clientReadDenied = query("select not has_table_privilege('authenticated','public.online_payout_items','SELECT') and not has_table_privilege('authenticated','public.online_payout_fee_evidence','SELECT');");
    if (policyColumn !== '1' || batchConstraint !== '1' || clientReadDenied !== 't') fail('OPTION_B_SCHEMA_POSTFLIGHT_FAILED');
    return { status: 'OPTION_B_SCHEMA_REHEARSAL_PASS', productionConnected: false,
      syntheticDraftApprovalSettlement: true, syntheticPartialManualSettlement: true,
      policyColumn, batchConstraint, clientReadDenied: true };
  })();
  console.log(JSON.stringify(result));
} finally {
  if (created) docker(['exec', dockerContainer, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X',
    '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `drop database if exists ${ident(database)} with (force);`]);
  docker(['exec', dockerContainer, 'rm', '-f', `${remoteRoot}/schema.dump`,
    `${remoteRoot}/namespace.list`, `${remoteRoot}/remaining.list`]);
  docker(['exec', dockerContainer, 'rmdir', remoteRoot]);
  if (path.dirname(path.resolve(directory)) !== path.resolve(recoveryRoot)) fail('LOCAL_FIXTURE_CLEANUP_TARGET_UNSAFE');
  fs.rmSync(directory, { recursive: true, force: true });
}
