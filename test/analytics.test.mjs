import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { normalizeEvent, rangeStartUtc } from '../src/index.js';

const valid = {
  site: 'pdf', event: 'page_view', path: '/',
  utm_source: 'ifangan', utm_medium: 'product_navigation',
  utm_campaign: 'i41_tools', utm_content: 'homepage_tools',
};

test('accepts an allowlisted anonymous event', () => {
  assert.deepEqual(normalizeEvent(valid), valid);
});

test('dashboard ranges use Asia Shanghai calendar boundaries', () => {
  const now = new Date('2026-09-04T03:38:00.000Z');
  assert.equal(rangeStartUtc('1d', now), '2026-09-03 16:00:00');
  assert.equal(rangeStartUtc('7d', now), '2026-08-28 16:00:00');
  assert.equal(rangeStartUtc('30d', now), '2026-08-05 16:00:00');
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
    blobs: ['pdf','page_view','/','','','ifangan','product_navigation','i41_tools','homepage_tools','','','',''],
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

test('root URL requires dashboard login', async () => {
  const env = {
    DASHBOARD_PASSWORD: '0701',
    SESSION_SECRET: 'session-secret',
    ASSETS: {
      fetch: async request => new Response(
        request.url.endsWith('login-page.txt') ? '<h1>统计面板登录</h1>' : '<h1>i41 工具生态数据</h1>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
    },
  };
  const response = await worker.fetch(new Request('https://stats.i41.cn/'), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /统计面板登录/);
});

test('dashboard fails closed when either auth secret is missing while public endpoints remain available', async () => {
  const assetFetch = async request => new Response(
    request.url.endsWith('login-page.txt') ? '<h1>统计面板登录</h1>' : 'public asset',
    { status: 200 },
  );
  for (const auth of [{}, { DASHBOARD_PASSWORD: '0701' }, { SESSION_SECRET: 'session-secret' }]) {
    const env = {
      ...auth,
      ASSETS: { fetch: assetFetch },
      EVENTS: { writeDataPoint() {} },
      ACCOUNT_ID: 'account',
      ANALYTICS_API_TOKEN: 'token',
    };
    for (const path of ['/', '/index.html']) {
      const response = await worker.fetch(new Request(`https://stats.i41.cn${path}`), env);
      assert.equal(response.status, 200, `${path} should render login`);
      assert.match(await response.text(), /统计面板登录/, `${path} must not expose dashboard`);
    }
    assert.equal((await worker.fetch(new Request('https://stats.i41.cn/dashboard.js'), env)).status, 401);
    assert.equal((await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d'), env)).status, 401);
    assert.equal((await worker.fetch(new Request('https://stats.i41.cn/health'), env)).status, 200);
    assert.equal((await worker.fetch(new Request('https://stats.i41.cn/analytics.js'), env)).status, 200);
    assert.equal((await worker.fetch(new Request('https://stats.i41.cn/event', {
      method: 'POST',
      headers: { origin: 'https://tools.i41.cn', 'content-type': 'application/json' },
      body: JSON.stringify({ site: 'tools', event: 'page_view', path: '/' }),
    }), env)).status, 204);
  }
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
    const rows = options.body.includes('GROUP BY site, path')
      ? [{ site: 'pdf', path: '/invoice-nup', events: '2' }]
      : options.body.includes('GROUP BY site')
        ? [{ site: 'pdf', events: '3' }]
      : options.body.includes('GROUP BY day')
        ? [{ day: '2026-09-03', events: '3' }]
        : options.body.includes('utm_content')
          ? [{ placement: 'homepage_tools', events: '2' }]
          : options.body.includes('blob5 AS placement')
            ? [{ site: 'pdf', event: 'primary_product_click', placement: 'promo_banner', events: '1' }]
            : [{ event: 'page_view', events: '3' }];
    return Response.json({ data: rows });
  };
  try {
    const env = {
      DASHBOARD_PASSWORD: '0701', SESSION_SECRET: 'session-secret',
      ACCOUNT_ID: 'account', ANALYTICS_API_TOKEN: 'secret-token', ASSETS: { fetch: () => new Response('asset') },
    };
    const login = await worker.fetch(new Request('https://stats.i41.cn/login', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=0701',
    }), env);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const response = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d', {
      headers: { cookie },
    }), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /private/i);
    assert.match(response.headers.get('cache-control') || '', /no-store/i);
    assert.doesNotMatch(response.headers.get('cache-control') || '', /public/i);
    const data = await response.json();
    assert.equal(data.range, '7d');
    assert.deepEqual(data.sites, [{ site: 'pdf', events: 3 }]);
    assert.deepEqual(data.pages, [{ site: 'pdf', path: '/invoice-nup', events: 2 }]);
    assert.equal(JSON.stringify(data).includes('secret-token'), false);
    assert.ok(queries.length >= 6);
    assert.ok(queries.every(query => query.authorization === 'Bearer secret-token'));
    assert.ok(queries.every(query => query.body.includes("timestamp >= toDateTime('")));
    assert.ok(queries.some(query => query.body.includes("formatDateTime(timestamp, '%Y-%m-%d', 'Asia/Shanghai')")));
    assert.ok(queries.some(query => query.body.includes('blob1 AS site, blob3 AS path') && query.body.includes('GROUP BY site, path')));
  } finally { globalThis.fetch = originalFetch; }
});

test('authenticated dashboard API rejects unsupported ranges and reports missing query secret', async () => {
  const env = { DASHBOARD_PASSWORD: '0701', SESSION_SECRET: 'session-secret' };
  const login = await worker.fetch(new Request('https://stats.i41.cn/login', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=0701',
  }), env);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const unsupported = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=365d', { headers: { cookie } }), env);
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.headers.get('cache-control'), 'private, no-store');
  const missing = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d', { headers: { cookie } }), env);
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('cache-control'), 'private, no-store');
});

test('dashboard API query failures remain private and uncached', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream failure', { status: 500 });
  try {
    const env = {
      DASHBOARD_PASSWORD: '0701', SESSION_SECRET: 'session-secret',
      ACCOUNT_ID: 'account', ANALYTICS_API_TOKEN: 'token',
    };
    const login = await worker.fetch(new Request('https://stats.i41.cn/login', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=0701',
    }), env);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const response = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d', { headers: { cookie } }), env);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  } finally { globalThis.fetch = originalFetch; }
});

test('dashboard login rejects wrong password and issues a secure cookie for 0701', async () => {
  const env = { DASHBOARD_PASSWORD: '0701', SESSION_SECRET: 'session-secret' };
  const wrong = await worker.fetch(new Request('https://stats.i41.cn/login', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=wrong',
  }), env);
  assert.equal(wrong.status, 401);
  const login = await worker.fetch(new Request('https://stats.i41.cn/login', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=0701',
  }), env);
  assert.equal(login.status, 303);
  assert.match(login.headers.get('set-cookie'), /i41_stats_session=.*HttpOnly.*Secure.*SameSite=Strict/);
});

test('logout immediately expires the seven-day dashboard session', async () => {
  const response = await worker.fetch(new Request('https://stats.i41.cn/logout', {
    method: 'POST',
    headers: { cookie: 'i41_stats_session=active' },
  }), {});
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login');
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /i41_stats_session=/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.match(cookie, /HttpOnly.*Secure.*SameSite=Strict/);
});

test('dashboard API is private when authentication is configured', async () => {
  const response = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d'), {
    DASHBOARD_PASSWORD: '0701', SESSION_SECRET: 'session-secret', ACCOUNT_ID: 'account', ANALYTICS_API_TOKEN: 'token',
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
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
