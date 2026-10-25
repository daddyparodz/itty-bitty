const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
  const dir = path.resolve(process.argv[2]);
  const localRequire = createRequire(path.join(dir, 'rasterize.js'));
  const resolved = localRequire.resolve('sharp');
  assert.ok(resolved.startsWith(path.join(dir, 'node_modules') + path.sep), resolved);
  const sharp = localRequire('sharp');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'node_modules/sharp/package.json'), 'utf8')).version, '0.35.5');
  for (const format of ['jpeg', 'png', 'webp']) {
    const encoded = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#2456ab' } })[format]().toBuffer();
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 16);
    assert.equal(metadata.height, 12);
    assert.equal((await sharp(encoded).raw().toBuffer()).length, 16 * 12 * 3);
  }
  const { handler } = localRequire(process.argv[3] || './rasterize.js');
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="blue"/></svg>',
    '<rect width="16" height="12" fill="red"/>',
  ]) {
    const response = await handler({ rawQuery: Buffer.from(svg).toString('base64') }, {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/jpeg');
    assert.equal(response.isBase64Encoded, true);
    const image = Buffer.from(response.body, 'base64');
    const metadata = await sharp(image).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 1200);
    if (svg.startsWith('<svg')) assert.equal(metadata.height, 900);
    assert.ok((await sharp(image).raw().toBuffer()).length > 0);
  }
  console.log(`FUNCTIONS_PASS ${process.version} ${resolved}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
