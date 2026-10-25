const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const base = path.dirname(require.resolve('@netlify/zip-it-and-ship-it'));
const load = (file) => import(pathToFileURL(path.join(base, file)).href);
test('published declarations type-check the supported Zod 4 APIs', () => {
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--esModuleInterop', '--strict', '--noImplicitAny', 'false', path.join(__dirname, 'fixtures/upstream-consumer-types.mts')], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('official dependency installation has no local consumer patches or lifecycle hooks', () => {
  const manifest = require('../package.json');
  assert.equal(manifest.scripts.postinstall, undefined);
  assert.equal(manifest.devDependencies['patch-package'], undefined);
  assert.equal(manifest.overrides, undefined);
  assert.equal(fs.existsSync(path.join(__dirname, '../patches')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../vendor/netlify-zod4-backport')), false);
});

test('TOML replacement rejects malformed inputs through both direct and bundled APIs', async () => {
  const { createRequire } = require('node:module');
  const { parse } = require('smol-toml');
  const bundledRequire = createRequire(require.resolve('@netlify/zip-it-and-ship-it'));
  const bundled = (await import(pathToFileURL(bundledRequire.resolve('toml')).href)).default;
  for (const text of ['key = 1\nkey = 2', 'key = [', 'key = "unterminated', '[table\nx=1', 'key = tru', 'key = 01']) {
    assert.throws(() => parse(text)); assert.throws(() => bundled.parse(text));
  }
  const text = 'title = "fixture"\n[functions]\nexternal_node_modules = ["sharp"]\n[build.environment]\nNODE_VERSION = "22"\n';
  assert.deepEqual(bundled.parse(text), parse(text));
});
test('official configuration schemas accept valid input and reject invalid input', async () => {
  const { parseSource } = await load('runtimes/node/in_source_config/index.js');
  const { functionConfigShape } = await load('config.js');
  const configs = [{}, { method: 'get', path: '/hello' }, { method: ['post', 'PUT'], path: ['/a', '/b'], excludedPath: '/private' }, { rateLimit: { windowLimit: 10, windowSize: 60 } }, { rateLimit: { windowLimit: 10, windowSize: 60, action: 'rewrite', to: '/blocked' } }];
  const rejected = [{ memory: 'bad' }, { memory: 128 }, { memory: 4097 }, { region: 123 }, { region: 'invalid' }, { vcpu: 0 }];
  for (const config of configs) {
    const result = parseSource(`export default () => {}; export const config = ${JSON.stringify(config)};`, { functionName: 'probe' });
    assert.ok(result);
  }
  for (const config of rejected) assert.equal(functionConfigShape.safeParse(config).success, false);
});

test('every official feature flag accepts both values without widening the flag API', async () => {
  const { getFlags, defaultFlags } = await load('feature_flags.js');
  const expected = ['buildRustSource', 'traceWithNft', 'zisi_pure_esm', 'zisi_pure_esm_mjs', 'zisi_output_cjs_extension', 'zisi_esbuild_fail_double_glob', 'zisi_error_cjs_in_esm_scope', 'zisi_add_instrumentation_loader', 'zisi_netlify_play', 'zisi_container_functions'];
  assert.deepEqual(Object.keys(defaultFlags), expected);
  for (const flag of expected) for (const value of [false, true]) assert.equal(getFlags({ [flag]: value })[flag], value);
});
test('public bundling and listing APIs retain ESM, CJS, imports, source maps and rate limit metadata', { timeout: 120000 }, async (t) => {
  const { zipFunctions, zipFunction, listFunction, listFunctions, listFunctionsFiles } = await import('@netlify/zip-it-and-ship-it');
  const { defaultFlags } = await load('feature_flags.js');
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'itty-upstream-'));
  const output = dir + '-output';
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const functions = path.join(dir, 'functions'); fs.mkdirSync(functions);
  fs.writeFileSync(path.join(dir, 'static.mjs'), 'export const value = 20;');
  fs.writeFileSync(path.join(dir, 'dynamic.mjs'), 'export const value = 22;');
  fs.writeFileSync(path.join(functions, 'esm.mjs'), 'import {value} from "../static.mjs"; export const handler = async () => value + (await import("../dynamic.mjs")).value;');
  fs.writeFileSync(path.join(functions, 'v2.mjs'), 'export default async () => new Response("v2"); export const config = {path:"/advanced",method:["get","POST"],rateLimit:{windowLimit:10,windowSize:60}};');
  fs.writeFileSync(path.join(functions, 'rewrite.mjs'), 'export default async () => new Response("rewrite"); export const config = {path:"/rewrite",rateLimit:{windowLimit:20,windowSize:30,aggregateBy:["ip"],action:"rewrite",to:"/blocked"}};');
  fs.writeFileSync(path.join(functions, 'cjs.js'), 'exports.handler = async () => ({statusCode:200,body:"cjs"});');
  const config = { '*': { nodeBundler: 'esbuild', nodeVersion: '22.x', nodeSourcemap: true } };
  const listed = await listFunctions(functions, { config, parseISC: true });
  assert.equal(listed.length, 4);
  assert.equal((await listFunction(path.join(functions, 'v2.mjs'), { config, parseISC: true })).runtimeAPIVersion, 2);
  assert.ok((await listFunctionsFiles([functions], { config, parseISC: true })).length >= 2);
  for (const [flag, initial] of Object.entries(defaultFlags)) {
    const results = await zipFunctions(functions, path.join(output, flag), { archiveFormat: 'none', basePath: dir, config, featureFlags: { [flag]: !initial } });
    assert.equal(results.length, 4, flag);
    const rewrite = results.find(result => result.name === 'rewrite');
    assert.equal(rewrite.trafficRules.action.type, 'rewrite');
    assert.equal(rewrite.trafficRules.action.config.to, '/blocked');
    assert.deepEqual(rewrite.trafficRules.action.config.aggregate.keys, [{ type: 'ip' }]);
    const esm = results.find(result => result.name === 'v2');
    assert.equal(esm.bundler, 'nft');
    assert.equal(esm.trafficRules.action.type, 'rate_limit');
    assert.deepEqual(esm.trafficRules.action.config.aggregate.keys, [{ type: 'domain' }]);
  }
  const single = await zipFunction(path.join(functions, 'esm.mjs'), path.join(output, 'single'), { archiveFormat: 'none', basePath: dir, config });
  assert.equal(single.name, 'esm');
  fs.rmSync(dir, { recursive: true, force: true });
  const files = fs.readdirSync(output, { recursive: true }).filter(file => /\.(?:mjs|js|cjs)$/.test(file) && /(?:^|[\\/])(?:esm|cjs)\.(?:mjs|js|cjs)$/.test(file));
  assert.ok(files.length >= 2);
  assert.ok(fs.readdirSync(output, { recursive: true }).some(file => file.endsWith('.map')));
  for (const file of files) {
    const full = path.join(output, file);
    const expected = path.basename(file).startsWith('esm.') ? 42 : {statusCode:200,body:'cjs'};
    const code = `import(${JSON.stringify(pathToFileURL(full).href)}).then(async m => { const assert = await import('node:assert/strict'); assert.default.deepEqual(await (m.handler || m.default.handler)(),${JSON.stringify(expected)}); })`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: output, encoding: 'utf8', timeout: 20000, env: { ...process.env, NODE_PATH: '' } });
    assert.equal(result.status, 0, file + '\n' + result.stderr);
  }
});
test('rate limit defaults retain upstream schema enum behavior', async () => {
  const { getTrafficRulesConfig } = await load('rate_limit.js');
  assert.deepEqual(getTrafficRulesConfig({ windowLimit: 10, windowSize: 60 }), { action: { type: 'rate_limit', config: { rateLimitConfig: { windowLimit: 10, windowSize: 60, algorithm: 'sliding_window' }, aggregate: { keys: [{ type: 'domain' }] } } } });
});
test('explicit aggregation retains default action and algorithm', async () => {
  const { getTrafficRulesConfig } = await load('rate_limit.js');
  const result = getTrafficRulesConfig({ windowLimit: 10, windowSize: 60, aggregateBy: ['ip'] });
  assert.equal(result.action.type, 'rate_limit');
  assert.equal(result.action.config.rateLimitConfig.algorithm, 'sliding_window');
  assert.deepEqual(result.action.config.aggregate.keys, [{ type: 'ip' }]);
});
for (const field of ['method', 'path', 'excludedPath']) {
  test(`invalid ${field} retains upstream custom validation diagnostic`, async () => {
    const { parseSource } = await load('runtimes/node/in_source_config/index.js');
    assert.throws(() => parseSource(`export default () => {}; export const config = {${field}:123};`, { functionName: 'probe' }), { message: `Function probe has a configuration error on '${field}': Must be a string or array of strings` });
  });
}
