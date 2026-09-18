import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker, { normalizeEvent, sanitizeReferrerUrl } from '../src/index.js';

const clientSource = await readFile(new URL('../public/analytics.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../public/dashboard.js', import.meta.url), 'utf8');
const { toolsRouteNames } = await import('../public/tool-route-names.js');

function clientEvents(referrer, { hostname = 'tools.i41.cn', site = 'tools', hashes = [] } = {}) {
  const events = [];
  const listeners = new Map();
  let clickHandler;
  const location = { hostname, pathname: '/', hash: hostname === 'pdf.i41.cn' ? '#/' : '', search: '' };
  const context = {
    location,
    URL,
    URLSearchParams,
    navigator: { sendBeacon(_url, body) { events.push(JSON.parse(body)); return true; } },
    fetch() {},
    document: {
      referrer,
      documentElement: { dataset: { i41Site: site } },
      addEventListener(_name, handler) { clickHandler = handler; },
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
  };
  vm.runInNewContext(clientSource, context);
  for (const hash of hashes) {
    location.hash = hash;
    listeners.get('hashchange')?.();
  }
  clickHandler?.({
    target: { closest: selector => (selector === 'a[href]' ? { href: 'https://www.i41.cn/', closest: () => null } : null) },
  });
  return events;
}

const firstView = (referrer, options) => clientEvents(referrer, options)[0];
const referrerKeys = event => Object.keys(event).filter(key => key.startsWith('referrer_')).sort();

function dashboardHtml(id, call) {
  const nodes = new Map();
  const context = {
    toolsRouteNames,
    URL,
    document: {
      getElementById(name) {
        if (!nodes.has(name)) nodes.set(name, { innerHTML: '', textContent: '', classList: { add() {}, remove() {} } });
        return nodes.get(name);
      },
    },
  };
  const body = dashboardSource.replace(/^import .*\n+/, '').replace(/document\.querySelectorAll[\s\S]*$/, '');
  vm.runInNewContext(`${body}\n${call};\nthis.result=document.getElementById(${JSON.stringify(id)}).innerHTML;`, context);
  return context.result;
}

/* ---------------------------------------------------------------- client */

test('client omits referrer fields when there is no referrer', () => {
  for (const referrer of ['', undefined, null]) {
    assert.deepEqual(referrerKeys(firstView(referrer)), [], `referrer ${String(referrer)}`);
  }
});

test('client marks i41 referrers internal and never stores their URL', () => {
  const internal = [
    'https://i41.cn/', 'https://www.i41.cn/tools?token=abc', 'https://tools.i41.cn/json-prettify',
    'https://imgzip.i41.cn/collage/', 'https://pdf.i41.cn/#/invoice-nup', 'https://idphoto.i41.cn/',
    'https://watermark.i41.cn/', 'https://clip.i41.cn/?code=9F2K3',
    'https://stats.i41.cn/private?token=abc', 'https://preview.i41.cn/path?code=hidden',
  ];
  for (const referrer of internal) {
    const view = firstView(referrer);
    assert.equal(view.referrer_type, 'internal', referrer);
    assert.deepEqual(referrerKeys(view), ['referrer_type'], referrer);
    assert.equal(JSON.stringify(view).includes('9F2K3'), false);
    assert.equal(JSON.stringify(view).includes('abc'), false);
  }
});

test('client reports an origin-only Google referrer without inventing a keyword', () => {
  const view = firstView('https://www.google.com/');
  assert.equal(view.referrer_type, 'external');
  assert.equal(view.referrer_host, 'www.google.com');
  assert.equal(view.referrer_url, 'https://www.google.com/');
  assert.equal(view.referrer_keyword, undefined);
});

test('client extracts a keyword only from common search parameters the referrer actually provides', () => {
  const cases = [
    ['https://www.bing.com/search?q=pdf%20%E5%90%88%E5%B9%B6', 'pdf 合并'],
    ['https://www.baidu.com/s?wd=%E5%9B%BE%E7%89%87%E5%8E%8B%E7%BC%A9', '图片压缩'],
    ['https://example.com/find?query=json', 'json'],
    ['https://example.com/find?keyword=svg', 'svg'],
    ['https://example.com/find?kw=heic', 'heic'],
    ['https://example.com/find?word=ocr', 'ocr'],
    ['https://example.com/find?p=webp', 'webp'],
  ];
  for (const [referrer, expected] of cases) {
    assert.equal(firstView(referrer).referrer_keyword, expected, referrer);
  }
  assert.equal(firstView('https://example.com/find?other=json').referrer_keyword, undefined);
  const long = firstView(`https://example.com/s?q=${'词'.repeat(200)}`);
  assert.equal(long.referrer_keyword, undefined);
  assert.equal(long.referrer_url, 'https://example.com/s');
});

test('client strips sensitive query parameters from the referrer URL', () => {
  const sensitive = [
    'token', 'code', 'password', 'passwd', 'key', 'secret', 'signature', 'sig',
    'auth', 'session', 'email', 'phone', 'invite', 'reset',
    'access_token', 'api_key', 'reset_code', 'X-Signature', 'user_email',
  ];
  for (const name of sensitive) {
    const view = firstView(`https://partner.example.com/landing?${name}=leaked&ref=news`);
    assert.equal(view.referrer_url, 'https://partner.example.com/landing?ref=news', name);
    assert.equal(JSON.stringify(view).includes('leaked'), false, name);
  }
});

test('client removes fragments and user credentials from the referrer URL', () => {
  const view = firstView('https://user:pass@partner.example.com/path?ref=news#section-secret');
  assert.equal(view.referrer_url, 'https://partner.example.com/path?ref=news');
  assert.equal(view.referrer_host, 'partner.example.com');
  const raw = JSON.stringify(view);
  for (const leak of ['user:pass', 'section-secret', '#']) assert.equal(raw.includes(leak), false, leak);
});

test('client caps the referrer URL at 500 characters by dropping its query', () => {
  const view = firstView(`https://partner.example.com/a?ref=${'x'.repeat(600)}`);
  assert.equal(view.referrer_url, 'https://partner.example.com/a');
  assert.ok(view.referrer_url.length <= 500);
  const huge = firstView(`https://partner.example.com/${'p'.repeat(600)}`);
  assert.equal(huge.referrer_host, 'partner.example.com');
  assert.equal(huge.referrer_url, undefined);
  assert.equal(huge.referrer_keyword, undefined);
});

test('client rejects referrers that are not http or https', () => {
  for (const referrer of ['android-app://com.example.app', 'javascript:alert(1)', 'data:text/html,x', 'file:///tmp/secret.pdf', 'ftp://example.com/x']) {
    assert.deepEqual(referrerKeys(firstView(referrer)), [], referrer);
  }
});

test('client omits unsupported host forms instead of sending an event the worker rejects', () => {
  for (const referrer of [
    'http://localhost/path', 'http://intranet/path', 'http://[2001:db8::1]/path',
    'https://bad_host.example.com/path', 'https://example.com./path',
  ])
    assert.deepEqual(referrerKeys(firstView(referrer)), [], referrer);
});

test('client never reports the current landing page URL, query or hash', () => {
  const events = clientEvents('https://partner.example.com/?ref=news', { hostname: 'clip.i41.cn', site: 'clip' });
  const raw = JSON.stringify(events);
  assert.equal(raw.includes('clip.i41.cn'), false);
  assert.equal(raw.includes('location'), false);
  // location.href appears only as the base for resolving relative link hrefs, never as a field value.
  assert.doesNotMatch(clientSource, /referrer_\w+['"]?\s*[:=]\s*[^,;\n]*location/);
});

test('only the first page_view carries external referrer data', () => {
  const events = clientEvents('https://www.google.com/search?q=pdf', {
    hostname: 'pdf.i41.cn', site: 'pdf', hashes: ['#/invoice-nup', '#/ocr-pdf'],
  });
  const views = events.filter(event => event.event === 'page_view');
  assert.deepEqual(views.map(view => view.path), ['/', '/invoice-nup', '/ocr-pdf']);
  assert.equal(views[0].referrer_host, 'www.google.com');
  for (const later of views.slice(1)) assert.deepEqual(referrerKeys(later), []);
  const clicks = events.filter(event => event.event !== 'page_view');
  assert.equal(clicks.length, 1);
  for (const click of clicks) assert.deepEqual(referrerKeys(click), []);
});

test('client and worker share one sensitive parameter denylist', () => {
  const list = text => text.match(/const SENSITIVE_PARAM_PARTS = \[([^\]]*)\]/)[1];
  assert.equal(list(clientSource), list(workerSource));
  for (const part of ['token', 'code', 'password', 'passwd', 'key', 'secret', 'signature', 'sig', 'auth', 'session', 'email', 'phone', 'invite', 'reset']) {
    assert.ok(list(clientSource).includes(`'${part}'`), part);
  }
});

/* ---------------------------------------------------------------- worker */

const base = { site: 'pdf', event: 'page_view', path: '/' };

test('worker accepts a sanitized external referrer', () => {
  assert.deepEqual(normalizeEvent({
    ...base, referrer_type: 'external', referrer_host: 'www.google.com',
    referrer_url: 'https://www.google.com/search?q=pdf', referrer_keyword: 'pdf',
  }), {
    ...base, referrer_type: 'external', referrer_host: 'www.google.com',
    referrer_url: 'https://www.google.com/search?q=pdf', referrer_keyword: 'pdf',
  });
  assert.deepEqual(normalizeEvent({ ...base, referrer_type: 'internal' }), { ...base, referrer_type: 'internal' });
  assert.deepEqual(normalizeEvent(base), base);
});

test('worker rejects a referrer URL whose host disagrees with referrer_host', () => {
  assert.throws(() => normalizeEvent({
    ...base, referrer_type: 'external', referrer_host: 'www.google.com',
    referrer_url: 'https://evil.example/search?q=pdf',
  }), /referrer_url/);
  assert.throws(() => sanitizeReferrerUrl('https://evil.example/', 'www.google.com'), /referrer_url/);
});

test('worker rejects unsafe referrer URLs', () => {
  const bad = [
    'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd',
    'https://partner.example.com/a#fragment', 'https://user:pass@partner.example.com/a',
    'https://partner.example.com/a?token=leaked', 'https://partner.example.com/a?reset_code=leaked',
    `https://partner.example.com/${'x'.repeat(600)}`, 'https://partner.example.com/a b',
    'https://partner.example.com/a b', 'not a url',
  ];
  for (const url of bad) {
    assert.throws(() => sanitizeReferrerUrl(url, 'partner.example.com'), /referrer_url/, url);
  }
  assert.equal(sanitizeReferrerUrl('https://partner.example.com/a?ref=news', 'partner.example.com'), 'https://partner.example.com/a?ref=news');
});

test('worker refuses referrer details without an external referrer', () => {
  for (const extra of [
    { referrer_host: 'www.google.com' },
    { referrer_url: 'https://www.google.com/' },
    { referrer_keyword: 'pdf' },
    { referrer_type: 'internal', referrer_host: 'www.google.com' },
    { referrer_type: 'internal', referrer_url: 'https://www.google.com/' },
    { referrer_type: 'internal', referrer_keyword: 'pdf' },
  ]) {
    assert.throws(() => normalizeEvent({ ...base, ...extra }), /referrer/, JSON.stringify(extra));
  }
  assert.throws(() => normalizeEvent({ ...base, referrer_type: 'bookmark' }), /referrer_type/);
  assert.throws(() => normalizeEvent({ ...base, referrer_type: 'external' }), /referrer_host/);
  assert.throws(() => normalizeEvent({
    ...base, referrer_type: 'external', referrer_host: 'www.google.com', referrer_keyword: 'pdf',
  }), /referrer_keyword/);
  assert.throws(() => normalizeEvent({
    ...base,
    referrer_type: 'external',
    referrer_host: 'www.google.com',
    referrer_url: 'https://www.google.com/search?q=actual',
    referrer_keyword: 'invented',
  }), /must match/);
});

test('worker rejects i41-owned hosts falsely submitted as external referrers', () => {
  for (const host of [
    'i41.cn', 'www.i41.cn', 'tools.i41.cn', 'imgzip.i41.cn', 'pdf.i41.cn',
    'idphoto.i41.cn', 'watermark.i41.cn', 'clip.i41.cn', 'stats.i41.cn',
    'preview.i41.cn',
  ]) {
    assert.throws(() => normalizeEvent({
      ...base,
      referrer_type: 'external',
      referrer_host: host,
      referrer_url: `https://${host}/?code=must-not-store`,
    }), /internal host/);
  }
});

test('worker rejects malformed referrer hosts and keywords', () => {
  for (const host of ['-bad.example.com', 'bad_host.example.com', 'localhost', 'a'.repeat(130), 'evil.example/path', '[::1]', 'https://x.example.com']) {
    assert.throws(() => normalizeEvent({ ...base, referrer_type: 'external', referrer_host: host }), /referrer_host/, host);
  }
  for (const keyword of ['x'.repeat(101), 'bad word', 'line\nbreak']) {
    assert.throws(() => normalizeEvent({
      ...base, referrer_type: 'external', referrer_host: 'a.example.com',
      referrer_url: 'https://a.example.com/', referrer_keyword: keyword,
    }), /referrer_keyword/, JSON.stringify(keyword));
  }
  for (const key of ['referrer_host', 'referrer_url', 'referrer_keyword', 'referrer_type']) {
    assert.throws(() => normalizeEvent({ ...base, referrer_type: 'external', [key]: { toString: () => 'x' } }), /referrer/);
  }
});

test('worker only allows referrer data on page_view', () => {
  assert.throws(() => normalizeEvent({
    site: 'pdf', event: 'ecosystem_click', path: '/', target: 'clip', placement: 'footer',
    referrer_type: 'external', referrer_host: 'www.google.com',
  }), /referrer/);
});

test('worker appends referrer blobs after the existing columns', async () => {
  const writes = [];
  const env = { EVENTS: { writeDataPoint: point => writes.push(point) } };
  const post = body => worker.fetch(new Request('https://stats.i41.cn/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://pdf.i41.cn' },
    body: JSON.stringify(body),
  }), env);
  assert.equal((await post({
    ...base, referrer_type: 'external', referrer_host: 'www.google.com',
    referrer_url: 'https://www.google.com/search?q=pdf', referrer_keyword: 'pdf',
  })).status, 204);
  assert.deepEqual(writes[0].blobs, [
    'pdf', 'page_view', '/', '', '', '', '', '', '',
    'external', 'www.google.com', 'https://www.google.com/search?q=pdf', 'pdf',
  ]);
  assert.equal((await post(base)).status, 204);
  assert.deepEqual(writes[1].blobs, ['pdf', 'page_view', '/', '', '', '', '', '', '', '', '', '', '']);
  assert.equal((await post({ ...base, referrer_type: 'external', referrer_host: 'evil.example', referrer_url: 'https://other.example/' })).status, 400);
  assert.equal(writes.length, 2);
});

/* ------------------------------------------------------------- dashboard */

function dashboardApi(rows) {
  const originalFetch = globalThis.fetch;
  const queries = [];
  globalThis.fetch = async (_url, options) => {
    queries.push(options.body);
    for (const [marker, data] of rows) if (options.body.includes(marker)) return Response.json({ data });
    return Response.json({ data: [] });
  };
  return {
    queries,
    async run() {
      const env = {
        DASHBOARD_PASSWORD: '0701', SESSION_SECRET: 'session-secret',
        ACCOUNT_ID: 'account', ANALYTICS_API_TOKEN: 'token', ASSETS: { fetch: () => new Response('asset') },
      };
      const login = await worker.fetch(new Request('https://stats.i41.cn/login', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=0701',
      }), env);
      const cookie = login.headers.get('set-cookie').split(';', 1)[0];
      const response = await worker.fetch(new Request('https://stats.i41.cn/api/dashboard?range=7d', { headers: { cookie } }), env);
      return { status: response.status, body: await response.json() };
    },
    restore() { globalThis.fetch = originalFetch; },
  };
}

test('dashboard API aggregates referrer hosts and returns bounded, sanitized visits', async () => {
  const api = dashboardApi([
    ['GROUP BY referrer_host', [
      { referrer_host: 'www.google.com', events: '5' },
      { referrer_host: 'www.v2ex.com', events: '2' },
    ]],
    ['ORDER BY timestamp DESC', [
      { time: '2026-09-18 10:30:00', site: 'pdf', path: '/merge-pdf', referrer_host: 'www.google.com', referrer_url: 'https://www.google.com/search?q=pdf', referrer_keyword: 'pdf' },
      { time: '2026-09-18 09:00:00', site: 'tools', path: '/json-prettify', referrer_host: 'www.v2ex.com', referrer_url: 'https://www.v2ex.com/t/1', referrer_keyword: '' },
      { time: '2026-09-17 20:00:00', site: 'clip', path: '/', referrer_host: '', referrer_url: '', referrer_keyword: '' },
      { time: '2026-09-17 19:00:00', site: 'pdf', path: '/', referrer_host: 'www.google.com', referrer_url: 'https://evil.example/x', referrer_keyword: 'pdf' },
      { time: '2026-09-17 18:00:00', site: 'pdf', path: '/', referrer_host: 'a.example.com', referrer_url: 'javascript:alert(1)', referrer_keyword: 'pdf' },
    ]],
  ]);
  try {
    const { status, body } = await api.run();
    assert.equal(status, 200);
    assert.deepEqual(body.referrerHosts, [
      { referrer_host: 'www.google.com', events: 5 },
      { referrer_host: 'www.v2ex.com', events: 2 },
    ]);
    assert.deepEqual(body.referrerVisits, [
      { time: '2026-09-18 10:30:00', site: 'pdf', path: '/merge-pdf', referrer_host: 'www.google.com', referrer_url: 'https://www.google.com/search?q=pdf', referrer_keyword: 'pdf' },
      { time: '2026-09-18 09:00:00', site: 'tools', path: '/json-prettify', referrer_host: 'www.v2ex.com', referrer_url: 'https://www.v2ex.com/t/1' },
      { time: '2026-09-17 19:00:00', site: 'pdf', path: '/', referrer_host: 'www.google.com' },
      { time: '2026-09-17 18:00:00', site: 'pdf', path: '/', referrer_host: 'a.example.com' },
    ]);
    const hostQuery = api.queries.find(query => query.includes('GROUP BY referrer_host'));
    const visitQuery = api.queries.find(query => query.includes('ORDER BY timestamp DESC'));
    for (const query of [hostQuery, visitQuery]) {
      assert.match(query, /LIMIT \d+/);
      assert.match(query, /blob10 = 'external'/);
      assert.match(query, /blob11 != ''/);
      assert.match(query, /timestamp >= toDateTime\('/);
    }
    assert.match(visitQuery, /formatDateTime\(timestamp, '%Y-%m-%d %H:%i:%S', 'Asia\/Shanghai'\)/);
    assert.equal(/\bgenerated|\$\{range\}/.test(visitQuery), false);
  } finally { api.restore(); }
});

test('dashboard API excludes historical rows that predate the referrer columns', async () => {
  const api = dashboardApi([
    ['ORDER BY timestamp DESC', [
      { time: '2026-09-01 08:00:00', site: 'pdf', path: '/', referrer_host: '', referrer_url: '', referrer_keyword: '' },
      { time: '2026-09-01 07:00:00', site: 'pdf', path: '/', referrer_host: undefined },
    ]],
  ]);
  try {
    const { body } = await api.run();
    assert.deepEqual(body.referrerVisits, []);
    assert.deepEqual(body.referrerHosts, []);
  } finally { api.restore(); }
});

test('dashboard renders external referrer visits with escaped text and safe links', () => {
  const rows = [{
    time: '2026-09-18 10:30:00',
    site: 'pdf',
    path: '/merge-pdf',
    referrer_host: 'evil"><img src=x onerror=alert(1)>.example.com',
    referrer_url: 'https://partner.example.com/a?ref="><script>alert(1)</script>',
    referrer_keyword: '<script>alert(1)</script>',
  }, {
    time: '2026-09-18 09:00:00', site: 'tools', path: '/json-prettify', referrer_host: 'www.v2ex.com',
  }];
  const html = dashboardHtml('referrerVisits', `referrerList(${JSON.stringify(rows)})`);
  // The payload survives as inert escaped text; what must not appear is any markup it could open.
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(/<[a-z]/i.test(html.replace(/<\/?(?:div|span|a)\b[^>]*>/g, '')), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /2026-09-18 10:30:00/);
  assert.match(html, /合并 PDF/);
  assert.match(html, /JSON美化和格式化/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /来源未提供/);
  assert.equal(dashboardHtml('referrerVisits', 'referrerList([])').includes('暂无'), true);
});

test('dashboard never links a referrer URL that is not http or https', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'not a url', '']) {
    const html = dashboardHtml('referrerVisits', `referrerList(${JSON.stringify([{ time: '2026-09-18 10:30:00', site: 'pdf', path: '/', referrer_host: 'a.example.com', referrer_url: url }])})`);
    assert.equal(html.includes('<a '), false, url);
    assert.equal(html.includes('javascript:'), false, url);
    assert.equal(html.includes('<script>'), false, url);
  }
  const ok = dashboardHtml('referrerVisits', `referrerList(${JSON.stringify([{ time: '2026-09-18 10:30:00', site: 'pdf', path: '/', referrer_host: 'a.example.com', referrer_url: 'http://a.example.com/x' }])})`);
  assert.match(ok, /<a href="http:\/\/a\.example\.com\/x"/);
});

test('dashboard page documents the external referrer panels and their limits', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /外部来源域名/);
  assert.match(html, /最近外部来访/);
  assert.match(html, /站内入口位置/);
  assert.doesNotMatch(html, /i方案入口来源/);
  assert.match(html, /id="referrerHosts"/);
  assert.match(html, /id="referrerVisits"/);
  assert.match(html, /关键词仅在来源网站实际提供时/);
  assert.match(html, /北京时间/);
  assert.match(html, /不记录当前页面的其他查询参数、完整查询串与 hash/);
});

test('README documents the referrer columns and the honest privacy boundary', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /blob10/);
  assert.match(readme, /blob13/);
  assert.match(readme, /referrer_host/);
  assert.match(readme, /referrer_keyword/);
  assert.match(readme, /关键词仅在来源网站实际提供时/);
  assert.match(readme, /提取码/);
  // The old blanket "no query strings" claim must be gone, replaced by the two-way distinction.
  assert.doesNotMatch(readme, /提取码、查询字符串/);
  assert.match(readme, /本站 URL/);
  assert.match(readme, /外部来源 URL/);
});
