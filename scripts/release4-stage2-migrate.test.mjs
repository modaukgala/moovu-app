import assert from 'node:assert/strict';
import test from 'node:test';
import { categoriesFromConstraint, classifyHistory, connectionAllowed, executePlan, files, migrationSql, newCategories, planMigrations, validateCategoryBoundary } from './release4-stage2-migrate.mjs';

const stage1 = ['20261022120000','20261022123000','20261022182716'];
const old = newCategories.slice(0,-2);
const definition = categories => `CHECK ((account_category = ANY (ARRAY[${categories.map(value=>`'${value}'::text`).join(', ')}])))`;

test('only the five reviewed SQL hashes and transaction shapes are accepted', () => {
  const plan = planMigrations();
  assert.equal(plan.length,5);
  assert.deepEqual(plan.map(item=>item.version),files.map(row=>row[0]));
  assert.throws(()=>planMigrations(()=>Buffer.from('begin;\nselect 1;\ncommit;')),/HASH_MISMATCH/);
  assert.equal(plan[4].hash,files[4][3]);
  for (const item of plan) {
    const wrapped = migrationSql(item);
    assert.match(wrapped,/SET LOCAL lock_timeout='5s'/);
    assert.match(wrapped,/SET LOCAL statement_timeout='120s'/);
    assert.ok(wrapped.lastIndexOf('INSERT INTO supabase_migrations.schema_migrations') < wrapped.lastIndexOf('COMMIT;'));
  }
});

test('migration history accepts only none or all and fails closed on partial or unexpected history', () => {
  assert.equal(classifyHistory(stage1),0);
  assert.equal(classifyHistory([...stage1,...files.map(row=>row[0])]),5);
  assert.throws(()=>classifyHistory([...stage1,files[0][0]]),/PARTIAL_HISTORY_REQUIRES_REVIEW/);
  assert.throws(()=>classifyHistory([...stage1,'20261026110599']),/UNEXPECTED_MIGRATION_HISTORY/);
  assert.throws(()=>classifyHistory(stage1.slice(1)),/STAGE1_HISTORY_MISSING/);
  assert.equal(classifyHistory([...stage1,...files.slice(0,3).map(row=>row[0])],[3]),3);
});

test('constraint preflight checks exact old and replacement categories, owner and row validity', () => {
  assert.deepEqual(categoriesFromConstraint(definition(old)),[...old].sort());
  validateCategoryBoundary({definition:definition(old),owner:'postgres',invalidRows:0});
  validateCategoryBoundary({definition:definition(newCategories),owner:'postgres',invalidRows:0},true);
  assert.throws(()=>validateCategoryBoundary({definition:definition(old),owner:'postgres',invalidRows:1}),/CATEGORY_CONSTRAINT_OR_DATA_CONFLICT/);
  assert.throws(()=>validateCategoryBoundary({definition:definition(old),owner:'other',invalidRows:0}),/CATEGORY_CONSTRAINT_OR_DATA_CONFLICT/);
  assert.throws(()=>validateCategoryBoundary({definition:definition(old.slice(1)),owner:'postgres',invalidRows:0}),/CATEGORY_CONSTRAINT_OR_DATA_CONFLICT/);
});

test('fixture execution refuses a non-isolated destination before connecting', () => {
  const keys = ['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','MOOVU_STAGE2_FIXTURE'];
  const previous = Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,{PGHOST:'production.example',PGPORT:'5432',PGUSER:'postgres',PGDATABASE:'postgres',PGPASSWORD:'placeholder',PGSSLMODE:'disable',MOOVU_STAGE2_FIXTURE:'true'});
    assert.throws(()=>connectionAllowed('--execute-fixture'),/FIXTURE_DESTINATION_BLOCKED/);
  } finally {
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
  }
});

test('a failed migration stops before later files and cannot record success', () => {
  const priorDatabase = process.env.PGDATABASE;
  process.env.PGDATABASE = 'moovu_recovery_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const calls = [];
  const state = {role:'supabase_admin',database:process.env.PGDATABASE,version:170000,
    publicCreate:true,historyInsert:true,history:stage1,owner:'supabase_admin',
    constraint:definition(old),invalidRows:0};
  const run = (_sql,category) => {
    calls.push(category);
    if (category === 'PREFLIGHT_QUERY_FAILED') return JSON.stringify(state);
    if (category === 'FINANCIAL_POSTFLIGHT_QUERY_FAILED') return JSON.stringify({unbalanced:0,duplicateKeys:0,duplicateEvents:0,duplicatePayables:0});
    throw Error(category);
  };
  try {
    assert.throws(()=>executePlan(planMigrations(),run,'--execute-fixture'),/MIGRATION_FAILED_20261026110501/);
    assert.deepEqual(calls,['PREFLIGHT_QUERY_FAILED','FINANCIAL_POSTFLIGHT_QUERY_FAILED','MIGRATION_FAILED_20261026110501']);
  } finally {
    if (priorDatabase === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = priorDatabase;
  }
});
