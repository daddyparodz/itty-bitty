const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'itty-bitty-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'docs'), path.join(dir, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(root, 'build-v2.js'), path.join(dir, 'build-v2.js'));
  for (const output of ['index.min.html', 'render/recipe.min.html']) {
    fs.rmSync(path.join(dir, 'docs', output));
  }
  return dir;
}
function build(dir) {
  return spawnSync(process.execPath, ['build-v2.js'], {
    cwd: dir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: path.join(root, 'node_modules', '.bin') + path.delimiter + process.env.PATH },
  });
}

test('build generates both templates with real inline assets', (t) => {
  const dir = fixture(t);
  const result = build(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Error|ENOENT/);
  for (const output of ['index.min.html', 'render/recipe.min.html']) {
    const html = fs.readFileSync(path.join(dir, 'docs', output), 'utf8');
    assert.doesNotMatch(html, / inline>/);
    assert.match(html, /<style>[^<]+<\/style>/);
    assert.match(html, /<script[^>]*>[^<]+<\/script>/);
  }
});

test('build rejects a missing real inline source with a nonzero exit', (t) => {
  const dir = fixture(t);
  fs.unlinkSync(path.join(dir, 'docs', 'index.js'));
  const result = build(dir);
  assert.notEqual(result.status, null, result.error?.message);
  assert.notEqual(result.status, 0, 'missing input was incorrectly reported as success');
  assert.match(result.stderr, /index\.js/);
});
