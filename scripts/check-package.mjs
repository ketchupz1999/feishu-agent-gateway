import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const artifact = path.resolve(process.argv[2] ?? '');
assert.ok(fs.statSync(artifact).isFile(), 'provide a packed tarball');
const entries = execFileSync('tar', ['-tzf', artifact], { encoding: 'utf8' }).split('\n');
assert.ok(entries.includes('package/dist/cli.js'));
assert.ok(entries.includes('package/npm-shrinkwrap.json'), 'published dependencies must be locked');
assert.ok(entries.every(name => !/(^|\/)(node_modules|data|secrets|\.git)(\/|$)|\/\.env$/.test(name)), 'private/runtime files in package');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway package-'));
let packageDir;
try {
  const prefix = path.join(root, 'installed app');
  execFileSync('npm', ['install', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', artifact], { stdio: 'pipe' });
  packageDir = path.join(prefix, 'node_modules', 'feishu-agent-gateway');
  const cli = path.join(packageDir, 'dist', 'cli.js');
  const expected = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
  const bin = path.join(prefix, 'node_modules', '.bin', 'feishu-agent-gateway');
  fs.accessSync(bin, fs.constants.X_OK);
  assert.equal(execFileSync(bin, ['--version'], { cwd: root, encoding: 'utf8' }).trim(), expected);
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { cwd: root, encoding: 'utf8' }).trim(), expected);
  const workspace = path.join(root, 'empty workspace'); fs.mkdirSync(workspace);
  const state = path.join(root, 'state');
  const configFile = path.join(root, 'config.json');
  const credentials = path.join(root, 'fixture.json');
  fs.writeFileSync(credentials, JSON.stringify({ api_key: 'test-cpa', app_id: 'test-app', app_secret: 'test-secret', allowed_open_id: 'test-owner' }));
  fs.writeFileSync(configFile, JSON.stringify({ runtime: 'claude-sdk', workspace, data_dir: state, model: 'test-model',
    provider: { type: 'cpa', base_url: 'http://127.0.0.1:8317', credentials_file: credentials }, feishu: { credentials_file: credentials } }));
  fs.chmodSync(packageDir, 0o555);
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'doctor', '--config', configFile], { cwd: workspace, encoding: 'utf8' }));
  assert.equal(result.ok, true); assert.equal(result.providerChecked, false);
  assert.deepEqual(fs.readdirSync(workspace), []);
  console.log(JSON.stringify({ ok: true, version: expected, standaloneInstall: true, emptyWorkspace: true, readOnlyInstallDirectory: true }));
} finally {
  if (packageDir && fs.existsSync(packageDir)) fs.chmodSync(packageDir, 0o755);
  fs.rmSync(root, { recursive: true, force: true });
}
