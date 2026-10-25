const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');

test('function tooling is declared directly using the supported Node 22 runtime', () => {
  const manifest = require('../package.json');
  assert.equal(manifest.engines.node, '>=22.13.0');
  assert.equal(manifest.devDependencies['netlify-cli'], undefined);
  assert.equal(manifest.devDependencies['@netlify/zip-it-and-ship-it'], '16.5.1');
  assert.equal(manifest.devDependencies['smol-toml'], '1.9.1');
});

test('direct Netlify tooling parses TOML and creates an executable standalone esbuild bundle', async (t) => {
  const { parse } = require('smol-toml');
  const { zipFunctions } = await import('@netlify/zip-it-and-ship-it');
  // Netlify also imports TOML for Cargo manifests; exercise its official parser.
  const bundlerRequire = createRequire(require.resolve('@netlify/zip-it-and-ship-it'));
  const bundledToml = (await import(require('node:url').pathToFileURL(bundlerRequire.resolve('toml')).href)).default;
  const source = '[package]\nname = "fixture"\n[functions]\nexternal_node_modules = ["sharp"]\n';
  assert.deepEqual(bundledToml.parse(source), parse(source));
  assert.throws(() => parse('key = 1\nkey = 2'));
  assert.throws(() => bundledToml.parse('key = 1\nkey = 2'));
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'itty-tooling-'));
  const output = dir + '-bundle';
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const functions = path.join(dir, 'functions');
  fs.mkdirSync(functions);
  fs.writeFileSync(path.join(dir, 'value.js'), 'exports.value = 42;');
  fs.writeFileSync(path.join(functions, 'probe.js'), 'const { value } = require("../value"); exports.handler = async () => ({ statusCode: 200, body: String(value) });');
  const results = await zipFunctions(functions, output, {
    archiveFormat: 'none', basePath: dir,
    config: { '*': { nodeBundler: 'esbuild', nodeVersion: '22.x' } },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].bundler, 'esbuild');
  const handler = path.join(results[0].path, 'probe.js');
  fs.rmSync(dir, { recursive: true, force: true });
  const run = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(handler)}).handler().then(result => { require('node:assert/strict').deepEqual(result, { statusCode: 200, body: '42' }); console.log('BUNDLE_PASS'); })`], {
    cwd: output, encoding: 'utf8', timeout: 20000, env: { ...process.env, NODE_PATH: '' },
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  assert.match(run.stdout, /BUNDLE_PASS/);
});
