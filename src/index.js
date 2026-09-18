const SITES = new Set(['tools', 'imgzip', 'pdf', 'idphoto', 'watermark', 'clip']);
const EVENTS = new Set(['page_view', 'ecosystem_click', 'primary_product_click']);
const PLACEMENTS = new Set(['header_dropdown', 'homepage_tools', 'footer_tools', 'ecosystem_nav', 'promo_banner', 'footer']);
const TARGETS = new Set([...SITES, 'primary']);
const UTM_SOURCE = new Set(['ifangan', ...SITES]);
const UTM_MEDIUM = new Set(['product_navigation', 'tool_referral']);
const UTM_CAMPAIGN = new Set(['i41_tools', 'ifangan']);
const UTM_CONTENT = PLACEMENTS;
const FIELDS = new Set(['site','event','path','target','placement','utm_source','utm_medium','utm_campaign','utm_content','referrer_type','referrer_host','referrer_url','referrer_keyword']);
const REFERRER_TYPES = new Set(['internal', 'external']);
function isInternalHost(host) {
  return host === 'i41.cn' || host.endsWith('.i41.cn');
}
// Kept identical to public/analytics.js: fragments, so access_token / api_key / reset_code match too.
const SENSITIVE_PARAM_PARTS = ['token', 'code', 'password', 'passwd', 'key', 'secret', 'signature', 'sig', 'auth', 'session', 'email', 'phone', 'invite', 'reset'];
const KEYWORD_KEYS = new Set(['q', 'query', 'wd', 'word', 'keyword', 'kw', 'p']);
const REFERRER_HOST_PATTERN = /^(?=.{4,128}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const CONTROL_CHARS = /[\u0000-]/;
const REFERRER_URL_MAX = 500;
const KEYWORD_MAX = 100;
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

function optionalText(value, name) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`invalid ${name}`);
  return value;
}

// Re-validates what the client claims to have sanitized. Returns the URL only when it is an
// http(s) URL for `host`, carries no credentials or fragment, no sensitive parameter and no
// control characters, and stays within the length budget. Anything else is rejected outright.
export function sanitizeReferrerUrl(value, host) {
  const fail = () => { throw new Error('invalid referrer_url'); };
  if (typeof value !== 'string' || value.length > REFERRER_URL_MAX || CONTROL_CHARS.test(value)) fail();
  if (/\s/.test(value) || value.includes('#')) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') fail();
  if (url.username || url.password) fail();
  if (url.hostname.toLowerCase() !== host) fail();
  for (const name of url.searchParams.keys()) {
    const lower = name.toLowerCase();
    if (
      !KEYWORD_KEYS.has(lower) &&
      SENSITIVE_PARAM_PARTS.some(part => lower.includes(part))
    )
      fail();
  }
  if (url.href !== value) fail();
  return value;
}

function referrerFields(input, event) {
  const type = optionalEnum(optionalText(input.referrer_type, 'referrer_type'), REFERRER_TYPES, 'referrer_type');
  const host = optionalText(input.referrer_host, 'referrer_host');
  const url = optionalText(input.referrer_url, 'referrer_url');
  const keyword = optionalText(input.referrer_keyword, 'referrer_keyword');
  if (type === undefined && host === undefined && url === undefined && keyword === undefined) return {};
  // Source data describes how the visitor arrived, so it belongs to the first page view only.
  if (event !== 'page_view') throw new Error('referrer data is only allowed on page_view');
  if (type === undefined) throw new Error('referrer_type required');
  if (type === 'internal') {
    if (host !== undefined || url !== undefined || keyword !== undefined) throw new Error('internal referrer must not carry details');
    return { referrer_type: 'internal' };
  }
  if (host === undefined) throw new Error('referrer_host required');
  const normalizedHost = host.toLowerCase();
  if (normalizedHost !== host || !REFERRER_HOST_PATTERN.test(normalizedHost)) throw new Error('invalid referrer_host');
  if (isInternalHost(normalizedHost)) throw new Error('internal host cannot be external referrer');
  const result = { referrer_type: 'external', referrer_host: normalizedHost };
  if (url !== undefined) result.referrer_url = sanitizeReferrerUrl(url, normalizedHost);
  if (keyword !== undefined) {
    if (result.referrer_url === undefined) throw new Error('referrer_keyword requires referrer_url');
    if (CONTROL_CHARS.test(keyword) || Array.from(keyword).length > KEYWORD_MAX) throw new Error('invalid referrer_keyword');
    const matchesUrl = [...new URL(result.referrer_url).searchParams.entries()].some(
      ([name, value]) => KEYWORD_KEYS.has(name.toLowerCase()) && value === keyword,
    );
    if (!matchesUrl) throw new Error('referrer_keyword must match referrer_url');
    result.referrer_keyword = keyword;
  }
  return result;
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
  return { ...normalized, ...referrerFields(input, event) };
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
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function rangeStartUtc(range, now = new Date()) {
  const days = RANGES[range];
  if (!days) return null;
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const startShanghaiAsUtc = Date.UTC(
    shanghaiNow.getUTCFullYear(), shanghaiNow.getUTCMonth(), shanghaiNow.getUTCDate() - (days - 1),
  );
  return new Date(startShanghaiAsUtc - SHANGHAI_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

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
  if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) return false;
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

function logout() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`,
      'Cache-Control': 'no-store',
    },
  });
}

async function privateAsset(request, env, path) {
  const assetUrl = new URL(path, request.url);
  const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (path === '/login-page.txt') {
    const headers = new Headers(asset.headers);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(asset.body, { status: asset.status, headers });
  }
  return asset;
}

function numericRows(rows = []) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    key === 'events' ? Number(value) : value,
  ])));
}

async function queryAnalytics(env, sql, label = 'query') {
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`;
  const result = await fetch(api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ANALYTICS_API_TOKEN}` },
    body: `${sql} FORMAT JSON`,
  });
  if (!result.ok) {
    const detail = (await result.text()).slice(0, 1000);
    throw new Error(`${label} failed: ${result.status}: ${detail}`);
  }
  return numericRows((await result.json()).data);
}

const REFERRER_HOST_LIMIT = 50;
const REFERRER_VISIT_LIMIT = 100;

// Stored rows are re-checked on the way out, so a row written by an older or looser version of
// the client can never hand the panel a URL it would be unsafe to render or link.
function shanghaiTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
  return parts;
}

function visitRow(row) {
  const host = typeof row.referrer_host === 'string' ? row.referrer_host : '';
  if (!REFERRER_HOST_PATTERN.test(host)) return null;
  const visit = { time: shanghaiTime(row.time), site: row.site, path: row.path, referrer_host: host };
  if (!visit.time) delete visit.time;
  let url;
  try { url = sanitizeReferrerUrl(row.referrer_url, host); } catch { return visit; }
  visit.referrer_url = url;
  const keyword = typeof row.referrer_keyword === 'string' ? row.referrer_keyword : '';
  if (keyword && !CONTROL_CHARS.test(keyword) && Array.from(keyword).length <= KEYWORD_MAX) visit.referrer_keyword = keyword;
  return visit;
}

function dashboardResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function dashboard(request, env) {
  const range = new URL(request.url).searchParams.get('range') || '7d';
  const start = rangeStartUtc(range);
  if (!start) return dashboardResponse({ error: 'unsupported range' }, 400);
  if (!env.ACCOUNT_ID || !env.ANALYTICS_API_TOKEN) return dashboardResponse({ error: 'dashboard query is not configured' }, 503);
  const where = `timestamp >= toDateTime('${start}', 'Etc/UTC')`;
  // Rows written before blob10 existed have an empty referrer_type, so they drop out here.
  const externalWhere = `${where} AND blob2 = 'page_view' AND blob10 = 'external' AND blob11 != ''`;
  try {
    const [summary, sites, pages, trend, sources, outbound, referrerHosts, referrerVisits] = await Promise.all([
      queryAnalytics(env, `SELECT blob2 AS event, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} GROUP BY event ORDER BY events DESC`, 'summary'),
      queryAnalytics(env, `SELECT blob1 AS site, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 = 'page_view' GROUP BY site ORDER BY events DESC`, 'sites'),
      queryAnalytics(env, `SELECT blob1 AS site, blob3 AS path, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 = 'page_view' GROUP BY site, path ORDER BY events DESC`, 'pages'),
      queryAnalytics(env, `SELECT formatDateTime(timestamp, '%Y-%m-%d', 'Asia/Shanghai') AS day, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 = 'page_view' GROUP BY day ORDER BY day`, 'trend'),
      queryAnalytics(env, `SELECT blob9 AS placement, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 = 'page_view' AND blob9 != '' GROUP BY placement ORDER BY events DESC`, 'sources'),
      queryAnalytics(env, `SELECT blob1 AS site, blob2 AS event, blob4 AS target, blob5 AS placement, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${where} AND blob2 != 'page_view' GROUP BY site, event, target, placement ORDER BY events DESC`, 'outbound'),
      queryAnalytics(env, `SELECT blob11 AS referrer_host, SUM(_sample_interval) AS events FROM i41_tool_events WHERE ${externalWhere} GROUP BY referrer_host ORDER BY events DESC LIMIT ${REFERRER_HOST_LIMIT}`, 'referrerHosts'),
      queryAnalytics(env, `SELECT timestamp AS time, blob1 AS site, blob3 AS path, blob11 AS referrer_host, blob12 AS referrer_url, blob13 AS referrer_keyword FROM i41_tool_events WHERE ${externalWhere} ORDER BY time DESC LIMIT ${REFERRER_VISIT_LIMIT}`, 'referrerVisits'),
    ]);
    return dashboardResponse({
      range, generatedAt: new Date().toISOString(), summary, sites, pages, trend, sources, outbound,
      referrerHosts: referrerHosts.filter(row => row.referrer_host),
      referrerVisits: referrerVisits.map(visitRow).filter(Boolean),
    });
  } catch (error) {
    console.error('dashboard query failed', error);
    return dashboardResponse({ error: 'analytics query failed' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (url.pathname === '/health' && request.method === 'GET') return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname === '/login' && request.method === 'POST') return login(request, env);
    if (url.pathname === '/login' && request.method === 'GET') return privateAsset(request, env, '/login-page.txt');
    if (url.pathname === '/logout' && request.method === 'POST') return logout();
    if (url.pathname === '/api/dashboard' && request.method === 'GET') {
      if (!await isAuthenticated(request, env)) return dashboardResponse({ error: 'unauthorized' }, 401);
      return dashboard(request, env);
    }
    if ((url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/dashboard.js') && !await isAuthenticated(request, env)) {
      if (url.pathname === '/dashboard.js') return new Response('unauthorized', { status: 401 });
      return privateAsset(request, env, '/login-page.txt');
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
      // blob10-13 are appended after the original nine columns so older rows stay readable.
      blobs: [event.site,event.event,event.path || '',event.target || '',event.placement || '',event.utm_source || '',event.utm_medium || '',event.utm_campaign || '',event.utm_content || '',event.referrer_type || '',event.referrer_host || '',event.referrer_url || '',event.referrer_keyword || ''],
      doubles: [1],
    });
    return response(204, origin);
  },
};
