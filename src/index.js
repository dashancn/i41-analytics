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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (url.pathname === '/health' && request.method === 'GET') return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
    if (url.pathname !== '/event') {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('not found', { status: 404 });
    }
    if (!ORIGINS.has(origin)) return response(403, 'null', 'forbidden origin');
    if (request.method === 'OPTIONS') return response(204, origin);
    if (request.method !== 'POST') return response(405, origin, 'method not allowed');
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return response(415, origin, 'json required');
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
