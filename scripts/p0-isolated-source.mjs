import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const repo = process.cwd();
const snapshot = '5bfed3cb794e50ac1b4cf351a323e06306e1934e';
const deployment = 'dpl_DXSpah8kBx3VSjep1o9mMneq1ZC1';
const team = 'team_n9nCZ25XkmOvsGXAyLDBw63B';
const output = process.argv[2] ? resolve(process.argv[2]) : null;
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
const vercel = join(process.env.APPDATA, 'npm/node_modules/vercel/dist/index.js');
const tree = JSON.parse(run(process.execPath, [vercel, 'api', `/v6/deployments/${deployment}/files?teamId=${team}`, '--scope', 'kgalaletsos-projects', '--raw']));
function flatten(nodes, prefix = '') {
  return nodes.flatMap(node => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    return node.type === 'file' ? [{ path, uid: node.uid }] : flatten(node.children ?? [], path);
  });
}
const source = flatten(tree).filter(row => row.path.startsWith('src/'))
  .map(row => ({ ...row, path: row.path.slice(4) }))
  .filter(row => !row.path.startsWith('documentation/') &&
    !row.path.endsWith('.tsbuildinfo') && !row.path.endsWith('.zip') && !row.path.startsWith('.vscode/'));
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const listing = run('git', ['ls-tree', '-r', '-z', snapshot]).toString().split('\0').filter(Boolean);
const blobs = new Map(listing.map(line => {
  const [header, path] = line.split('\t');
  return [path, header.split(' ')[2]];
}));
const batchIds = [...new Set(blobs.values())];
const batch = spawnSync('git', ['cat-file', '--batch'], {
  cwd: repo, input: batchIds.join('\n') + '\n', maxBuffer: 128 * 1024 * 1024,
});
assert.equal(batch.status, 0, batch.stderr?.toString());
const contents = new Map();
let offset = 0;
for (const id of batchIds) {
  const end = batch.stdout.indexOf(10, offset);
  const header = batch.stdout.subarray(offset, end).toString().split(' ');
  assert.equal(header[0], id);
  const size = Number(header[2]);
  assert.ok(Number.isSafeInteger(size));
  contents.set(id, batch.stdout.subarray(end + 1, end + 1 + size));
  offset = end + 2 + size;
}
const missing = [], verified = [];
for (const row of source) {
  assert.ok(!row.path.includes('..') && !row.path.startsWith('/') && !row.path.startsWith('.env'), 'Unsafe deployment path');
  const options = [];
  if (blobs.has(row.path)) options.push({ origin: `git:${snapshot}`, bytes: contents.get(blobs.get(row.path)) });
  if (existsSync(join(repo, row.path))) options.push({ origin: 'working-tree', bytes: readFileSync(join(repo, row.path)) });
  let match;
  for (const option of options) {
    const variants = [option.bytes];
    if (!option.bytes.includes(0)) {
      const text = option.bytes.toString().replace(/\r\n/g, '\n');
      variants.push(Buffer.from(text), Buffer.from(text.replace(/\n/g, '\r\n')));
    }
    const bytes = variants.find(value => sha1(value) === row.uid);
    if (bytes) { match = { bytes, origin: option.origin }; break; }
  }
  if (!match && output) {
    const response = JSON.parse(run(process.execPath, [vercel, 'api',
      `/v8/deployments/${deployment}/files/${row.uid}?teamId=${team}`,
      '--scope', 'kgalaletsos-projects', '--raw']));
    assert.equal(typeof response.data, 'string');
    const bytes = Buffer.from(response.data, 'base64');
    assert.equal(sha1(bytes), row.uid, `Deployment content hash mismatch: ${row.path}`);
    match = { bytes, origin: `vercel:${deployment}` };
  }
  if (!match) { missing.push(row); continue; }
  verified.push({ ...row, origin: match.origin });
  if (output) {
    const target = resolve(output, row.path);
    assert.ok(target.startsWith(output + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')));
    if (existsSync(target)) {
      assert.equal(sha1(readFileSync(target)), row.uid, `Refusing overwrite: ${row.path}`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, match.bytes);
  }
}
const result = { deployment, source_snapshot_tree: snapshot, source_head: run('git', ['rev-parse', 'HEAD']).toString().trim(),
  verified: verified.length, missing, files: verified };
if (output) writeFileSync(join(output, 'p0-baseline-source-manifest.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, files: undefined }, null, 2));
if (missing.length) process.exitCode = 1;
