import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { normalizeEvent } from '../src/index.js';

const valid = {
  site: 'pdf', event: 'page_view', path: '/',
  utm_source: 'ifangan', utm_medium: 'product_navigation',
  utm_campaign: 'i41_tools', utm_content: 'homepage_tools',
};

test('accepts an allowlisted anonymous event', () => {
  assert.deepEqual(normalizeEvent(valid), valid);
});

test('rejects unknown fields and sensitive fields', () => {
  assert.throws(() => normalizeEvent({ ...valid, filename: '合同.pdf' }), /字段/);
  assert.throws(() => normalizeEvent({ ...valid, password: 'secret' }), /字段/);
});

test('rejects unknown enums and arbitrary paths', () => {
  assert.throws(() => normalizeEvent({ ...valid, site: 'other' }), /site/);
  assert.throws(() => normalizeEvent({ ...valid, event: 'download_content' }), /event/);
  assert.throws(() => normalizeEvent({ ...valid, path: '/?secret=1' }), /path/);
});

test('worker accepts valid CORS request and writes fixed columns', async () => {
  const writes = [];
  const env = { EVENTS: { writeDataPoint: point => writes.push(point) } };
  const request = new Request('https://stats.i41.cn/event', {
    method: 'POST', origin: 'https://pdf.i41.cn',
    headers: { 'content-type': 'application/json', origin: 'https://pdf.i41.cn' },
    body: JSON.stringify(valid),
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://pdf.i41.cn');
  assert.deepEqual(writes[0], {
    indexes: ['pdf'],
    blobs: ['pdf','page_view','/','','','ifangan','product_navigation','i41_tools','homepage_tools'],
    doubles: [1],
  });
});

test('worker rejects disallowed origins and oversized bodies', async () => {
  const env = { EVENTS: { writeDataPoint() { throw new Error('must not write'); } } };
  const badOrigin = await worker.fetch(new Request('https://stats.i41.cn/event', {
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(badOrigin.status, 403);
  const oversized = await worker.fetch(new Request('https://stats.i41.cn/event', {
    method: 'POST', headers: { origin: 'https://tools.i41.cn', 'content-type': 'application/json', 'content-length': '5000' }, body: '{}',
  }), env);
  assert.equal(oversized.status, 413);
});
