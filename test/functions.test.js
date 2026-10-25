const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('smol-toml');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

test('functions installs, bundles and rasterizes independently of root dependencies', { timeout: 240000 }, async (t) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'functions/package.json'), 'utf8'));
  assert.equal(manifest.engines.node, '22');
  assert.equal(manifest.dependencies.sharp, '0.35.5');
  assert.equal(manifest.main, 'rasterize.js');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'itty-bitty-functions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ['package.json', 'package-lock.json', 'rasterize.js']) {
    fs.copyFileSync(path.join(root, 'functions', file), path.join(dir, file));
  }
  assert.ok(process.env.npm_execpath, 'Run through npm run test:functions');
  const install = spawnSync(process.execPath,
    [process.env.npm_execpath, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: dir, encoding: 'utf8', timeout: 150000,
      env: { ...process.env, NODE_PATH: '' },
    });
  assert.equal(install.status, 0, install.stderr || install.error?.message);
  // Load native libraries in a child so Windows releases DLLs before cleanup.
  const probe = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/functions-probe.cjs'), dir], {
    cwd: dir, encoding: 'utf8', timeout: 20000, env: { ...process.env, NODE_PATH: '' },
  });
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  assert.match(probe.stdout, /FUNCTIONS_PASS/);
  t.diagnostic(probe.stdout.split('\n').find(line => line.startsWith('FUNCTIONS_PASS')));
  const { zipFunctions } = await import('@netlify/zip-it-and-ship-it');
  const config = parse(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8'));
  assert.equal(config.build.environment.NODE_VERSION, '22');
  assert.equal(config.functions.node_bundler, 'esbuild');
  assert.deepEqual(config.functions.external_node_modules, ['sharp']);
  const output = dir + '-bundle';
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const results = await zipFunctions(dir, output, {
    archiveFormat: 'none', basePath: dir,
    config: { '*': {
      nodeBundler: config.functions.node_bundler,
      nodeVersion: config.build.environment.NODE_VERSION + '.x',
      externalNodeModules: config.functions.external_node_modules,
    } },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'rasterize');
  assert.equal(results[0].bundler, 'esbuild');
  const bundle = results[0].path;
  const packages = fs.readdirSync(bundle, { recursive: true }).filter(file =>
    file.split(path.sep).join('/').endsWith('node_modules/sharp/package.json'));
  assert.equal(packages.length, 1);
  const moduleDir = path.dirname(path.dirname(path.dirname(path.join(bundle, packages[0]))));
  // Remove original dependencies: the packaged handler must stand alone.
  fs.rmSync(dir, { recursive: true, force: true });
  const bundledProbe = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/functions-probe.cjs'), moduleDir, path.join(bundle, 'rasterize.js')], {
    cwd: bundle, encoding: 'utf8', timeout: 20000, env: { ...process.env, NODE_PATH: '' },
  });
  assert.equal(bundledProbe.status, 0, bundledProbe.stderr || bundledProbe.error?.message);
  assert.match(bundledProbe.stdout, /FUNCTIONS_PASS/);
  t.diagnostic('Bundled ' + bundledProbe.stdout.split('\n').find(line => line.startsWith('FUNCTIONS_PASS')));
});
