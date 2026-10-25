const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const path = require('node:path');
const sharp = require('sharp');

test('native encoders round-trip JPEG, PNG and WebP', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const buffer = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#2456ab' } })[format]().toBuffer();
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 16);
    assert.equal(metadata.height, 12);
    assert.equal((await sharp(buffer).raw().toBuffer()).length, 16 * 12 * 3);
  }
});

test('local server rasterizes fictional SVG into JPEG', { timeout: 15000 }, async (t) => {
  // Discover the ephemeral listening port without contacting external services.
  const script = `const net = require('node:net'); const listen = net.Server.prototype.listen; net.Server.prototype.listen = function(...args) { this.once('listening', () => console.log('TEST_PORT=' + this.address().port)); return listen.apply(this,args); }; require('./server/index.js');`;
  const server = spawn(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: '0', REQUEST_LOG: 'silent' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    await new Promise(resolve => {
      server.once('exit', resolve);
      server.kill();
    });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/TEST_PORT=(\d+)/);
      if (match) resolve(match[1]);
    });
    server.once('error', reject);
    server.once('exit', code => reject(new Error(`Server exited: ${code}`)));
  });
  const home = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(home.status, 200);
  await home.arrayBuffer();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="blue"/></svg>';
  const payload = Buffer.from(svg).toString('base64url');
  const response = await fetch(`http://127.0.0.1:${port}/.netlify/functions/rasterize/${payload}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/jpeg/);
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 12);
});
