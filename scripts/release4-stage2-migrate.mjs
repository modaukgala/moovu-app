import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const project = 'mvazbszenqahgqpznhhq';
const stage1 = ['20261022120000', '20261022123000', '20261022182716'];
export const files = [
  ['20261026110501', 'release4_online_payable_total_separation', 'release4-online-payable-total-separation.sql', '05B877FE906CEAF1233B46931C21D5D55430D69D935026E9A279DE738D951F7C'],
  ['20261026110502', 'release4_phase5_booking_fee_allocation', 'release4-phase5-booking-fee-allocation.sql', 'AF6956B37CC1D86E42E3059590E0599524CD69FD46370FCD72C46756F4C7BBD5'],
  ['20261026110503', 'release4_online_payout_control_plane', 'release4-online-payout-control-plane.sql', '50DB1ADFFFFB3ABEE9192F707B22B441B8C92B97F6FB17C84765577E23F15FD9'],
  ['20261026110504', 'release4_online_payout_financial_engine', 'release4-online-payout-financial-engine.sql', 'D867572E695BA13D627AD20BE19D8F47B603DF430CC831573DD54F7801A94318'],
  ['20261026110505', 'release4_manual_partial_payments', 'release4-manual-partial-payments.sql', 'A5F56087E23A8CCD3266B8DB795E86C7EFA7C3785F1B80AFC80867C190F9A84F'],
];
const oldCategories = [
  'COMMISSION_RECEIVABLE','COMMISSION_REVENUE','BOOKING_FEE_REVENUE','SUBSCRIPTION_PAYMENT_CLEARING',
  'SUBSCRIPTION_REVENUE','DEFERRED_SUBSCRIPTION_REVENUE','CANCELLATION_NO_SHOW_RECEIVABLE',
  'CANCELLATION_NO_SHOW_REVENUE','PAYMENT_CLEARING','UNAPPLIED_FUNDS','PAYOUT_CLEARING',
  'ADJUSTMENT_CLEARING','DRIVER_EARNINGS_CONTROL','DRIVER_EARNINGS_PAYABLE','DRIVER_COMMISSION_DEBT',
  'DRIVER_UNAPPLIED_CREDIT','DRIVER_COMPENSATION_PAYABLE','DRIVER_FUTURE_PAYOUT',
  'CUSTOMER_OUTSTANDING_LIABILITY','CUSTOMER_BALANCE','CUSTOMER_PROMOTIONAL_CREDIT',
  'CUSTOMER_REFERRAL_CREDIT',
];
export const newCategories = [...oldCategories, 'ONLINE_PROCESSING_FEE_EXPENSE','BANK_PAYOUT_FEE_EXPENSE'];
const fail = category => { throw new Error(category); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const quoted = value => `'${value.replaceAll("'", "''")}'`;

export function planMigrations(read = readFileSync) {
  return files.map(([version, name, filename, hash]) => {
    // This approved legacy hash uses CRLF. Git attributes check it out as LF;
    // reconstruct the reviewed bytes before hashing and sending to PostgreSQL.
    const sourceBytes = read(join(root, 'docs', filename));
    const bytes = filename === 'release4-manual-partial-payments.sql'
      ? Buffer.from(sourceBytes.toString('utf8').replace(/\r?\n/g, '\r\n')) : sourceBytes;
    if (sha256(bytes) !== hash) fail(`HASH_MISMATCH_${version}`);
    const sql = bytes.toString('utf8');
    const begin = [...sql.matchAll(/^\s*begin\s*;\s*$/gim)];
    const commit = [...sql.matchAll(/^\s*commit\s*;\s*$/gim)];
    if (begin.length !== 1 || commit.length !== 1 || begin[0].index >= commit[0].index ||
        /^\s*\\/m.test(sql) || /^\s*rollback\s*;/im.test(sql)) fail(`TRANSACTION_SHAPE_${version}`);
    const before = sql.slice(0, begin[0].index).replace(/^\s*--.*$/gm, '').trim();
    const after = sql.slice(commit[0].index + commit[0][0].length).replace(/^\s*--.*$/gm, '').trim();
    if (before || after) fail(`TRANSACTION_SHAPE_${version}`);
    return { version, name, filename, hash, body: sql.slice(begin[0].index + begin[0][0].length, commit[0].index) };
  });
}

export function classifyHistory(history, allowedPrefixes = [0, files.length]) {
  const sorted = [...history].sort();
  if (sorted.length !== new Set(sorted).size || stage1.some(v => !sorted.includes(v))) fail('STAGE1_HISTORY_MISSING');
  const expected = files.map(row => row[0]);
  const later = sorted.filter(v => v > stage1.at(-1));
  if (later.some((v, i) => v !== expected[i])) fail('UNEXPECTED_MIGRATION_HISTORY');
  if (!allowedPrefixes.includes(later.length)) fail('PARTIAL_HISTORY_REQUIRES_REVIEW');
  return later.length;
}

export function categoriesFromConstraint(definition) {
  if (!/^CHECK \(\(account_category = ANY \(ARRAY\[/.test(definition ?? '')) fail('CATEGORY_CONSTRAINT_CHANGED');
  const names = [...definition.matchAll(/'([A-Z_]+)'::text/g)].map(match => match[1]);
  if (new Set(names).size !== names.length) fail('CATEGORY_CONSTRAINT_CHANGED');
  return names.sort();
}

export function validateCategoryBoundary({ definition, owner, invalidRows }, applied = false, expectedOwner = 'postgres') {
  const expected = applied ? newCategories : oldCategories;
  if (owner !== expectedOwner || invalidRows !== 0 ||
      JSON.stringify(categoriesFromConstraint(definition)) !== JSON.stringify([...expected].sort())) {
    fail('CATEGORY_CONSTRAINT_OR_DATA_CONFLICT');
  }
}

export function migrationSql(item) {
  const guard = `DO $$ BEGIN IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quoted(item.version)}) THEN RAISE EXCEPTION 'MIGRATION_ALREADY_RECORDED'; END IF; END $$;`;
  return `BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='120s';\n${guard}\n${item.body}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES (${quoted(item.version)},${quoted(item.name)});\nCOMMIT;`;
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || result.error) fail('GIT_UNAVAILABLE');
  return result.stdout.trim();
}
export function connectionAllowed(mode) {
  const env = process.env;
  if (mode === '--execute-production' && (!env.PGPASSWORD || env.PGDATABASE !== 'postgres')) fail('DATABASE_IDENTITY_BLOCKED');
  if (mode === '--execute-production') {
    if (env.MOOVU_STAGE2_EXECUTION_APPROVED !== 'true' || env.PGHOST !== 'aws-1-eu-west-1.pooler.supabase.com' ||
        env.PGPORT !== '5432' || env.PGSSLMODE !== 'verify-full' ||
        env.PGUSER !== `postgres.${project}` || !existsSync(env.PGSSLROOTCERT ?? '')) fail('PRODUCTION_DESTINATION_BLOCKED');
  } else if (mode === '--execute-fixture') {
    if (env.MOOVU_STAGE2_FIXTURE !== 'true' || !/^moovu-recovery-[a-f0-9]{20}$/.test(env.MOOVU_STAGE2_FIXTURE_CONTAINER ?? '') ||
        !/^moovu_recovery_[a-f0-9]{32}$/.test(env.PGDATABASE ?? '') ||
        env.PGUSER !== 'supabase_admin' || env.PGSSLMODE !== 'disable') fail('FIXTURE_DESTINATION_BLOCKED');
  } else fail('INVALID_MODE');
}
function runSql(sql, category, mode) {
  const env = process.env;
  if (mode === '--execute-fixture') {
    const result = spawnSync('docker',['exec','-i',env.MOOVU_STAGE2_FIXTURE_CONTAINER,'psql','-U','supabase_admin',
      '-d',env.PGDATABASE,'-X','-qAt','-v','ON_ERROR_STOP=1'],
    {input:sql,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024,timeout:150000});
    if (result.status !== 0 || result.error) fail(category);
    return result.stdout.trim();
  }
  const args = ['run','--rm','-i'];
  if (mode === '--execute-production') args.push('--mount',`type=bind,source=${env.PGSSLROOTCERT},target=/run/ca.crt,readonly`);
  args.push('--env','PGHOST','--env','PGPORT','--env','PGUSER','--env','PGDATABASE','--env','PGPASSWORD',
    '--env','PGSSLMODE','--env','PGCONNECT_TIMEOUT=15');
  if (mode === '--execute-production') args.push('--env','PGSSLROOTCERT=/run/ca.crt');
  args.push('--entrypoint','psql',image,'-X','-qAt','-v','ON_ERROR_STOP=1');
  const result = spawnSync('docker',args,{input:sql,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024,timeout:150000});
  if (result.status !== 0 || result.error) fail(category);
  return result.stdout.trim();
}

function preflight(run, mode, allowedPrefixes = [0, files.length]) {
  const state = JSON.parse(run(`BEGIN READ ONLY;
    SELECT json_build_object('role',current_user,'database',current_database(),
      'version',current_setting('server_version_num')::integer,
      'publicCreate',has_schema_privilege(current_user,'public','CREATE'),
      'historyInsert',has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT'),
      'history',(SELECT coalesce(json_agg(version ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations),
      'owner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='public.financial_accounts'::regclass),
      'constraint',(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.financial_accounts'::regclass AND conname='financial_accounts_account_category_check'),
      'invalidRows',(SELECT count(*) FROM public.financial_accounts WHERE account_category IS NULL OR account_category NOT IN (${newCategories.map(quoted).join(',')})));
    COMMIT;`, 'PREFLIGHT_QUERY_FAILED', mode));
  if (state.role !== (mode === '--execute-production' ? 'postgres' : 'supabase_admin') ||
      state.database !== process.env.PGDATABASE || state.version < 170000 ||
      state.publicCreate !== true || state.historyInsert !== true) fail('DATABASE_ROLE_OR_PERMISSION_BLOCKED');
  const history = classifyHistory(state.history, allowedPrefixes);
  validateCategoryBoundary({ definition: state.constraint, owner: state.owner, invalidRows: state.invalidRows },
    history === files.length, mode === '--execute-production' ? 'postgres' : 'supabase_admin');
  return history;
}

function financialPostflight(run, mode) {
  const checks = JSON.parse(run(`BEGIN READ ONLY;
    SELECT json_build_object('unbalanced',(SELECT count(*) FROM (SELECT transaction_id FROM public.financial_ledger_entries GROUP BY transaction_id HAVING sum(CASE WHEN entry_side='DEBIT' THEN amount_cents ELSE -amount_cents END)<>0)x),
      'duplicateKeys',(SELECT count(*) FROM (SELECT idempotency_key FROM public.financial_transactions GROUP BY idempotency_key HAVING count(*)>1)x),
      'duplicateEvents',(SELECT count(*) FROM (SELECT provider,provider_event_id FROM public.online_provider_events GROUP BY provider,provider_event_id HAVING count(*)>1)x),
      'duplicatePayables',(SELECT count(*) FROM (SELECT trip_id FROM public.online_driver_payables GROUP BY trip_id HAVING count(*)>1)x)); COMMIT;`, 'FINANCIAL_POSTFLIGHT_QUERY_FAILED', mode));
  if (Object.values(checks).some(value => value !== 0)) fail('FINANCIAL_INVARIANT_FAILED');
  return checks;
}

function objectPostflight(run, mode) {
  const state = JSON.parse(run(`BEGIN READ ONLY;
    SELECT json_build_object(
      'batches',to_regclass('public.online_payout_batches') IS NOT NULL,
      'manualPayments',to_regclass('public.online_payout_manual_payments') IS NOT NULL,
      'bankEvidence',to_regclass('public.online_payout_manual_bank_evidence') IS NOT NULL,
      'recordFunction',to_regprocedure('public.release4_record_manual_payment(uuid,uuid,uuid,bigint,timestamp with time zone,text,text,text)') IS NOT NULL,
      'verifyFunction',to_regprocedure('public.release4_verify_manual_payment(uuid,uuid)') IS NOT NULL,
      'manualRls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.online_payout_manual_payments'::regclass),
      'evidenceRls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.online_payout_manual_bank_evidence'::regclass),
      'driverCannotWrite',NOT has_table_privilege('authenticated','public.online_payout_manual_payments','INSERT,UPDATE,DELETE'));
    COMMIT;`, 'OBJECT_POSTFLIGHT_QUERY_FAILED', mode));
  if (Object.values(state).some(value => value !== true)) fail('PAYOUT_OBJECT_OR_RLS_POSTFLIGHT_FAILED');
  return state;
}

export function executePlan(plan, run, mode) {
  const state = preflight(run, mode);
  const beforeFinancial = financialPostflight(run,mode);
  if (state === files.length) return { status:'STAGE2_ALREADY_APPLIED', versions:files.map(row=>row[0]),
    financialInvariants:beforeFinancial,objects:objectPostflight(run,mode) };
  for (const item of plan) {
    if (item.version === files[3][0]) {
      const current = preflight(run, mode, [3]);
      if (current !== 3) fail('MIGRATION4_PREFLIGHT_CONFLICT');
    }
    run(migrationSql(item), `MIGRATION_FAILED_${item.version}`, mode);
    const verified = run(`BEGIN READ ONLY; SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version=${quoted(item.version)}; COMMIT;`, `HISTORY_VERIFY_FAILED_${item.version}`, mode);
    if (verified !== '1') fail(`HISTORY_VERIFY_FAILED_${item.version}`);
    console.log(JSON.stringify({status:'STAGE2_MIGRATION_VERIFIED',version:item.version}));
  }
  const after = preflight(run, mode, [files.length]);
  if (after !== files.length) fail('POSTFLIGHT_HISTORY_CONFLICT');
  return {status:'STAGE2_FIVE_FILE_MIGRATIONS_APPLIED',versions:files.map(row=>row[0]),
    financialInvariants:financialPostflight(run,mode),objects:objectPostflight(run,mode)};
}

function main() {
  const mode = process.argv[2];
  if (!['--dry-run','--execute-fixture','--execute-production'].includes(mode) || process.argv.length !== 3) fail('INVALID_MODE');
  const plan = planMigrations();
  const source = git(['rev-parse','HEAD']);
  git(['merge-base','--is-ancestor','cd43f515955969d1758b1c4d2b88b746578768bc','HEAD']);
  if (mode === '--dry-run') return {status:'STAGE2_FIVE_FILE_DRY_RUN',productionConnected:false,source,files:plan.map(({version,filename,hash})=>({version,filename,sha256:hash}))};
  if (mode === '--execute-production' && git(['status','--porcelain']) !== '') fail('RELEASE_CHECKOUT_CHANGED');
  connectionAllowed(mode);
  const result = executePlan(plan,runSql,mode);
  return {...result,source,productionMutated:mode==='--execute-production'};
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  try { console.log(JSON.stringify(main())); }
  catch (error) { console.error(JSON.stringify({status:'STAGE2_MIGRATION_BLOCKED',category:error.message}));process.exitCode=1; }
}
