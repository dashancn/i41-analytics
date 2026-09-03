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

test('event endpoint accepts CORS-safelisted text/plain beacons', async () => {
  const writes = [];
  const response = await worker.fetch(new Request('https://stats.i41.cn/event', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'https://watermark.i41.cn' },
    body: JSON.stringify({ site: 'watermark', event: 'page_view', path: '/' }),
  }), { EVENTS: { writeDataPoint: point => writes.push(point) } });
  assert.equal(response.status, 204);
  assert.equal(writes.length, 1);
});

test('root URL returns a readable service page instead of 404', async () => {
  const env = {
    ASSETS: {
      fetch: async request => new Response(
        request.url.endsWith('/') ? '<h1>i41 匿名统计服务</h1><p>服务运行正常</p>' : 'asset',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
    },
  };
  const response = await worker.fetch(new Request('https://stats.i41.cn/'), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /i41 匿名统计服务/);
});

test('public analytics script supports module CORS and cross-origin isolation', async () => {
  const env = {
    ASSETS: {
      fetch: async () => new Response('console.log("analytics")', {
        headers: { 'content-type': 'text/javascript' },
      }),
    },
  };
  const response = await worker.fetch(new Request('https://stats.i41.cn/analytics.js'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
});

test('dashboard API returns aggregate analytics without exposing its token', async () => {
  const originalFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (_url, options) => {
    queries.push({ body: options.body, authorization: options.headers.Authorization });
    const rows = options.body.includes('GROUP BY site')
      ? [{ site: 'pdf', events: '3' }]
      : options.body.includes('GROUP BY day')
        ? [{ day: '2026-09-03', events: '3' }]
        : options.body.includes('utm_content')
          ? [{ placement: 'homepage_tools', events: '2' }]
          : options.body.includes('blob5 AS placement')
            ? [{ event: 'primary_product_click', placement: 'promo_banner', events: '1' }]
            : [{ event: 'page_view', events: '3' }];
    return Response.json({ data: rows });
  };
  try {
    const response = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d'), {
      ACCOUNT_ID: 'account', ANALYTICS_API_TOKEN: 'secret-token', ASSETS: { fetch: () => new Response('asset') },
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.range, '7d');
    assert.deepEqual(data.sites, [{ site: 'pdf', events: 3 }]);
    assert.equal(JSON.stringify(data).includes('secret-token'), false);
    assert.ok(queries.length >= 5);
    assert.ok(queries.every(query => query.authorization === 'Bearer secret-token'));
  } finally { globalThis.fetch = originalFetch; }
});

test('dashboard API rejects unsupported ranges and reports missing server secret', async () => {
  const unsupported = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=365d'), {});
  assert.equal(unsupported.status, 400);
  const missing = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d'), {});
  assert.equal(missing.status, 503);
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
