const SITES = new Set(['tools', 'imgzip', 'pdf', 'idphoto', 'watermark', 'clip']);
const EVENTS = new Set(['page_view', 'ecosystem_click', 'primary_product_click']);
const PLACEMENTS = new Set(['header_dropdown', 'homepage_tools', 'footer_tools', 'ecosystem_nav', 'promo_banner', 'footer']);
const TARGETS = new Set([...SITES, 'primary']);
const UTM_SOURCE = new Set(['ifangan', ...SITES]);
const UTM_MEDIUM = new Set(['product_navigation', 'tool_referral']);
const UTM_CAMPAIGN = new Set(['i41_tools', 'ifangan']);
const UTM_CONTENT = PLACEMENTS;
const FIELDS = new Set(['site','event','path','target','placement','utm_source','utm_medium','utm_campaign','utm_content']);
const ORIGINS = new Set([
  'https://tools.i41.cn','https://imgzip.i41.cn','https://pdf.i41.cn',
  'https://idphoto.i41.cn','https://watermark.i41.cn','https://clip.i41.cn',
  'https://www.i41.cn','https://i41.cn',
]);

function optionalEnum(value, allowed, name) {
  if (value === undefined || value === '') return undefined;
  if (!allowed.has(value)) throw new Error(`invalid ${name}`);
  return value;
}

export function normalizeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid body');
  for (const key of Object.keys(input)) if (!FIELDS.has(key)) throw new Error(`unknown 字段: ${key}`);
  const site = optionalEnum(input.site, SITES, 'site');
  const event = optionalEnum(input.event, EVENTS, 'event');
  if (!site || !event) throw new Error('site and event required');
  let path;
  if (input.path !== undefined) {
    path = String(input.path);
    if (!/^\/[A-Za-z0-9/_-]*$/.test(path) || path.length > 120) throw new Error('invalid path');
  }
  const normalized = { site, event };
  if (path !== undefined) normalized.path = path;
  for (const [key, set] of [
    ['target', TARGETS], ['placement', PLACEMENTS], ['utm_source', UTM_SOURCE],
    ['utm_medium', UTM_MEDIUM], ['utm_campaign', UTM_CAMPAIGN], ['utm_content', UTM_CONTENT],
  ]) {
    const value = optionalEnum(input[key], set, key);
    if (value !== undefined) normalized[key] = value;
  }
  return normalized;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function response(status, origin, text = '') {
  return new Response(status === 204 ? null : text, { status, headers: cors(origin || 'null') });
}

const RANGES = { '1d': 1, '7d': 7, '30d': 30 };
const SESSION_COOKIE = 'i41_stats_session';
const SESSION_TTL = 7 * 24 * 60 * 60;

function bytes(value) {
  return new TextEncoder().encode(value);
}

function safeEqual(left, right) {
  const a = bytes(String(left));
  const b = bytes(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(value)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sessionValue(secret, now = Math.floor(Date.now() / 1000)) {
  const expires = now + SESSION_TTL;
  return `${expires}.${await sign(String(expires), secret)}`;
}

async function isAuthenticated(request, env) {
  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) return true;
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;
  const [expiresText, signature] = match[1].split('.');
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || !signature) return false;
  return safeEqual(signature, await sign(expiresText, env.SESSION_SECRET));
}

async function login(request, env) {
  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) return new Response('dashboard auth is not configured', { status: 503 });
  const form = await request.formData();
  if (!safeEqual(form.get('password') || '', env.DASHBOARD_PASSWORD)) return new Response('密码错误', { status: 401 });
  const value = await sessionValue(env.SESSION_SECRET);
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie': `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Strict`,
      'Cache-Control': 'no-store',
    },
  });
}

async function privateAsset(request, env, path) {
  const assetUrl = new URL(path, request.url);
  return env.ASSETS.fetch(new Request(assetUrl, request));
}

function numericRows(rows = []) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    key === 'events' ? Number(value) : value,
  ])));
}

async function queryAnalytics(env, sql) {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`;
  const result = await fetch(api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}` },
    body: `${sql} FORMAT JSON`,
  });
  if (!result.ok) throw new Error(`analytics query failed: ${result.status}`);
  return numericRows((await result.json()).data);
}

async function dashboard(request, env) {
  const range = new URL(request.url).searchParams.get('range') || '7d';
  const days = RANGES[range];
  if (!days) return Response.json({ error: 'unsupported range' }, { status: 400 });
  if (!env.ACCOUNT_ID || !env.ANALYTICS_API_TOKEN) return Response.json({ error: 'dashboard query is not configured' }, { status: 503 });
  const where = `timestamp >= NOW() - INTERVAL '${days}' DAY`;
  try {
    const [summary, sites, trend, sources, outbound] = await Promise.all([
      queryAnalytics(env, `SELECT blob2 AS event, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} GROUP BY event ORDER BY events DESC`),
      queryAnalytics(env, `SELECT blob1 AS site, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 = 'page_view' GROUP BY site ORDER BY events DESC`),
      queryAnalytics(env, `SELECT formatDateTime(timestamp, '%Y-%m-%d') AS day, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 = 'page_view' GROUP BY day ORDER BY day`),
      queryAnalytics(env, `SELECT blob9 AS placement, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 = 'page_view' AND blob9 != '' GROUP BY placement ORDER BY events DESC`),
      queryAnalytics(env, `SELECT blob1 AS site, blob2 AS event, blob4 AS target, blob5 AS placement, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 != 'page_view' GROUP BY site, event, target, placement ORDER BY events DESC`),
    ]);
    return Response.json({ range, generatedAt: new Date().toISOString(), summary, sites, trend, sources, outbound }, {
      headers: { 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    console.error('dashboard query failed', error);
    return Response.json({ error: 'analytics query failed' }, { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (url.pathname === '/health' && request.method === 'GET') return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname === '/login' && request.method === 'POST') return login(request, env);
    if (url.pathname === '/login' && request.method === 'GET') return privateAsset(request, env, '/login.html');
    if (url.pathname === '/api/dashboard' && request.method === 'GET') {
      if (!await isAuthenticated(request, env)) return Response.json({ error: 'unauthorized' }, { status: 401 });
      return dashboard(request, env);
    }
    if ((url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/dashboard.js') && !await isAuthenticated(request, env)) {
      if (url.pathname === '/dashboard.js') return new Response('unauthorized', { status: 401 });
      return privateAsset(request, env, '/login.html');
    }
    if (url.pathname !== '/event') {
      if (env.ASSETS) {
        const asset = await env.ASSETS.fetch(request);
        if (url.pathname === '/analytics.js') {
          const headers = new Headers(asset.headers);
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
          headers.set('X-Content-Type-Options', 'nosniff');
          return new Response(asset.body, { status: asset.status, headers });
        }
        return asset;
      }
      return new Response('not found', { status: 404 });
    }
    if (!ORIGINS.has(origin)) return response(403, 'null', 'forbidden origin');
    if (request.method === 'OPTIONS') return response(204, origin);
    if (request.method !== 'POST') return response(405, origin, 'method not allowed');
    const contentType = request.headers.get('content-type')?.toLowerCase() || '';
    if (!contentType.startsWith('application/json') && !contentType.startsWith('text/plain')) return response(415, origin, 'json required');
    if (Number(request.headers.get('content-length') || 0) > 4096) return response(413, origin, 'too large');
    const raw = await request.text();
    if (raw.length > 4096) return response(413, origin, 'too large');
    let event;
    try { event = normalizeEvent(JSON.parse(raw)); }
    catch { return response(400, origin, 'invalid event'); }
    env.EVENTS.writeDataPoint({
      indexes: [event.site],
      blobs: [event.site,event.event,event.path || '',event.target || '',event.placement || '',event.utm_source || '',event.utm_medium || '',event.utm_campaign || '',event.utm_content || ''],
      doubles: [1],
    });
    return response(204, origin);
  },
};
