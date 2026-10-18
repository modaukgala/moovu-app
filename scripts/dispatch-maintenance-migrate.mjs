import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pinnedCommit = '901f521146c5b005ec34520a05c260fd9dba9a3b';
const allowedReleaseAdditions = new Set([
  'docs/moovu-final-release-safeguards.md',
  'scripts/dispatch-maintenance-migrate.mjs',
  'scripts/dispatch-maintenance-migrate.ps1',
  'scripts/release-safeguards.test.mjs',
  'scripts/yoco-unresolved-review.mjs',
]);
export const projectRef = 'mvazbszenqahgqpznhhq';
export const migrations = [
  ['20261010185641', 'dispatch_90_second_matching', '6A87E1D7853488FB792074DF1562ACC3EF73890F0B4931DE4813345260D0BDDC'],
  ['20261010190029', 'dispatch_90_second_security_correction', 'AEFF2E91DF767741EE6C5E8E38823397A70C9CA651E2A94C6EB8B409F0F8ED47'],
  ['20261011103000', 'dispatch_matching_terminal_lifecycle', '0739DBBFC7776721FF1B3C963BFF310B3D55A69D41F5C7FF3A914A14935EFA10'],
  ['20261012191510', 'production_admission_gate', 'FB8FAC95631FF7A0A14D5A70D5FB6A22D6CB09AC4FB4F077E3D5CAB2C3E8EB49'],
];

export function loadReviewedMigrations(base = root) {
  if (base === root) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (head !== pinnedCommit) {
      const changed = execFileSync('git', ['diff', '--name-only', pinnedCommit, head], { cwd: root, encoding: 'utf8' })
        .split(/\r?\n/).filter(Boolean);
      if (changed.length !== allowedReleaseAdditions.size || changed.some(path => !allowedReleaseAdditions.has(path)))
        throw new Error('PINNED_SOURCE_COMMIT_MISMATCH');
    }
  }
  return migrations.map(([version, name, expectedHash]) => {
    const filename = `${version}_${name}.sql`;
    const bytes = readFileSync(join(base, 'supabase', 'migrations', filename));
    const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    if (hash !== expectedHash) throw new Error(`REVIEWED_HASH_MISMATCH: ${filename}`);
    const sql = bytes.toString('utf8');
    if (/^\s*\\/m.test(sql) || /\b(?:begin|commit|rollback)\s*;/i.test(sql))
      throw new Error(`UNSUPPORTED_TRANSACTION_CONTROL: ${filename}`);
    return { version, name, filename, hash, sql };
  });
}

export function migrationTransaction(migration) {
  // The history row commits atomically with this one reviewed SQL file.
  return `BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '120s';\n` +
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${migration.version}') THEN RAISE EXCEPTION 'RELEASE_HISTORY_CONFLICT'; END IF; END $$;\n` +
    `${migration.sql}\n` +
    `INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${migration.version}','${migration.name}');\nCOMMIT;\n`;
}

function runPsql(sql, env) {
  return new Promise((resolve, reject) => {
    const docker = env.MOOVU_RELEASE_LOCAL_CONTAINER;
    const database = env.MOOVU_RELEASE_LOCAL_DATABASE ?? 'postgres';
    if (docker && (!/^[a-zA-Z0-9_-]+$/.test(docker) || !/^moovu_release_safeguard_[a-z0-9_]+$/.test(database)))
      return reject(new Error('LOCAL_REHEARSAL_TARGET_INVALID'));
    const productionDocker = !docker && env.MOOVU_RELEASE_DOCKER_IMAGE;
    const command = docker || productionDocker ? 'docker' : 'psql';
    const args = docker
      ? ['exec', '-i', docker, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database]
      : productionDocker
      ? ['run', '--rm', '-i', '--mount', `type=bind,source=${env.PGSSLROOTCERT},target=/run/ca.crt,readonly`,
          '--env', 'PGHOST', '--env', 'PGPORT', '--env', 'PGUSER', '--env', 'PGDATABASE',
          '--env', 'PGPASSWORD', '--env', 'PGSSLMODE', '--env', 'PGCONNECT_TIMEOUT=15',
          '--env', 'PGSSLROOTCERT=/run/ca.crt', '--entrypoint', 'psql', productionDocker,
          '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
      : ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; let stderr = '';
    child.stdout.on('data', b => { out += b; if (out.length > 8192) child.kill(); });
    child.stderr.on('data', b => { stderr += b; if (stderr.length > 8192) child.kill(); });
    child.on('error', () => reject(new Error('PSQL_EXECUTION_UNAVAILABLE')));
    child.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error('MIGRATION_SQL_FAILED')));
    child.stdin.on('error', () => {});
    child.stdin.end(sql);
  });
}

export async function executeReviewedMigrations(plan, env = process.env) {
  const local = Boolean(env.MOOVU_RELEASE_LOCAL_CONTAINER);
  if (!local && (env.PGUSER !== `postgres.${projectRef}` ||
      !String(env.PGHOST ?? '').endsWith('.pooler.supabase.com') ||
      env.PGSSLMODE !== 'verify-full' || !env.PGSSLROOTCERT || !existsSync(env.PGSSLROOTCERT) || !env.PGPASSWORD))
    throw new Error('PRODUCTION_CONNECTION_PREFLIGHT_FAILED');
  const preflight = await runPsql(`SELECT current_user || '|' || current_database() || '|' ||
    (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN (${plan.map(x => `'${x.version}'`).join(',')})) || '|' ||
    (to_regclass('public.dispatch_matching_windows') IS NULL AND to_regclass('public.moovu_admission_state') IS NULL)::text;`, env);
  if (preflight !== `postgres|${local ? env.MOOVU_RELEASE_LOCAL_DATABASE : 'postgres'}|0|true`)
    throw new Error('MIGRATION_ROLE_OR_HISTORY_CONFLICT');
  for (const migration of plan) {
    await runPsql(migrationTransaction(migration), env);
    const recorded = await runPsql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${migration.version}';`, env);
    if (recorded !== '1') throw new Error(`MIGRATION_HISTORY_VERIFICATION_FAILED: ${migration.version}`);
  }
  return plan.map(x => x.version);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length > 3 || !['--dry-run', '--execute'].includes(process.argv[2] ?? '--dry-run'))
      throw new Error('USE_ONLY_DRY_RUN_OR_EXPLICIT_EXECUTE');
    const plan = loadReviewedMigrations();
    if (process.argv[2] !== '--execute') {
      console.log(JSON.stringify({ status: 'FOUR_FILE_DRY_RUN', productionConnected: false,
        files: plan.map(({ filename, hash }) => ({ filename, sha256: hash })) }));
    } else {
      if (process.env.MOOVU_RELEASE_EXECUTION_APPROVED !== 'true')
        throw new Error('EXPLICIT_RELEASE_APPROVAL_REQUIRED');
      const versions = await executeReviewedMigrations(plan);
      console.log(JSON.stringify({ status: 'FOUR_FILE_MIGRATION_APPLIED', versions }));
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'FOUR_FILE_MIGRATION_BLOCKED', category: error.message }));
    process.exitCode = 1;
  }
}
