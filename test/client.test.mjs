import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/analytics.js', import.meta.url), 'utf8');

test('client sends only the three approved event names', () => {
  for (const name of ['page_view','ecosystem_click','primary_product_click']) assert.ok(source.includes(`event: '${name}'`));
  for (const forbidden of ['filename','password','clipboard','userAgent','cookie','localStorage']) assert.ok(!source.includes(forbidden));
});

test('client is best effort and preserves navigation', () => {
  assert.match(source, /navigator\.sendBeacon/);
  assert.match(source, /keepalive: true/);
  assert.doesNotMatch(source, /preventDefault/);
});

test('client recognizes all six canonical tool hosts', () => {
  for (const host of ['tools.i41.cn','imgzip.i41.cn','pdf.i41.cn','idphoto.i41.cn','watermark.i41.cn','clip.i41.cn']) assert.ok(source.includes(host));
});
