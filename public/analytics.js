const ENDPOINT = 'https://stats.i41.cn/event';
const SITES = new Set(['tools', 'imgzip', 'pdf', 'idphoto', 'watermark', 'clip']);
const PLACEMENTS = new Set(['header_dropdown', 'homepage_tools', 'footer_tools', 'ecosystem_nav', 'promo_banner', 'footer']);
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
function isInternalHost(host) {
  return host === 'i41.cn' || host.endsWith('.i41.cn');
}
// Fragments, not exact names: any referrer parameter whose name contains one of them is dropped,
// so access_token, api_key, reset_code and X-Signature are covered as well.
const SENSITIVE_PARAM_PARTS = ['token', 'code', 'password', 'passwd', 'key', 'secret', 'signature', 'sig', 'auth', 'session', 'email', 'phone', 'invite', 'reset'];
const KEYWORD_KEYS = ['q', 'query', 'wd', 'word', 'keyword', 'kw', 'p'];
const REFERRER_URL_MAX = 500;
const KEYWORD_MAX = 100;
const CONTROL_CHARS = /[\u0000-]/;
const PDF_ROUTES = new Set([
  '/', '/merge-pdf', '/split-pdf', '/organize-pdf', '/rotate-pdf', '/reverse-pages',
  '/add-blank-page', '/remove-blank-pages', '/crop-pdf', '/resize-pdf', '/nup-pdf',
  '/invoice-nup', '/booklet-pdf', '/pdf-to-jpg', '/pdf-to-png', '/pdf-to-webp',
  '/pdf-to-text', '/pdf-to-markdown', '/pdf-to-epub', '/jpg-to-pdf', '/text-to-pdf',
  '/markdown-to-pdf', '/watermark-pdf', '/page-numbers', '/header-footer', '/sign-pdf',
  '/edit-pdf', '/add-qr-code', '/edit-metadata', '/compress-pdf', '/flatten-pdf',
  '/grayscale-pdf', '/invert-colors', '/repair-pdf', '/redact-pdf', '/protect-pdf',
  '/unlock-pdf', '/ocr-pdf', '/compare-pdf', '/extract-images', '/check-accessibility',
]);

function cleanPath() {
  if (location.hostname === 'pdf.i41.cn') {
    const hashRoute = location.hash?.match(/^#(\/[A-Za-z0-9_-]*)(?:[?#]|$)/)?.[1];
    return PDF_ROUTES.has(hashRoute) ? hashRoute : undefined;
  }
  const rawPath = String(location.pathname || '/').split(/[?#]/, 1)[0];
  return /^\/[A-Za-z0-9/_-]*$/.test(rawPath) && rawPath.length <= 120 ? rawPath || '/' : '/';
}

function attribution() {
  const params = new URLSearchParams(location.search);
  const result = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value && /^[a-z_]+$/.test(value) && value.length <= 32) result[key] = value;
  }
  return result;
}

function isSensitiveParam(name) {
  const lower = name.toLowerCase();
  if (KEYWORD_KEYS.includes(lower)) return false;
  return SENSITIVE_PARAM_PARTS.some(part => lower.includes(part));
}

// Reads document.referrer only: the page the visitor came from, never this page's own URL.
function externalReferrer() {
  const raw = document.referrer;
  if (!raw || typeof raw !== 'string') return {};
  let url;
  try { url = new URL(raw); } catch { return {}; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return {};
  const host = url.hostname.toLowerCase();
  if (isInternalHost(host)) return { referrer_type: 'internal' };
  if (!host || CONTROL_CHARS.test(host)) return {};
  if (!/^(?=.{4,128}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) return {};
  const result = { referrer_type: 'external', referrer_host: host };
  url.username = '';
  url.password = '';
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) if (isSensitiveParam(name)) url.searchParams.delete(name);
  if (url.href.length > REFERRER_URL_MAX) url.search = '';
  if (url.href.length > REFERRER_URL_MAX || CONTROL_CHARS.test(url.href)) return result;
  result.referrer_url = url.href;
  // Keywords exist only when the sanitized referring URL still contains one of the fixed search
  // parameters. Values over the limit are omitted instead of truncated so server validation agrees.
  const keyword = KEYWORD_KEYS.map(key => url.searchParams.get(key)).find(value => value);
  if (
    keyword &&
    keyword === keyword.trim() &&
    Array.from(keyword).length <= KEYWORD_MAX &&
    !CONTROL_CHARS.test(keyword)
  )
    result.referrer_keyword = keyword;
  return result;
}

function send(event) {
  const body = JSON.stringify(event);
  if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, keepalive: true }).catch(() => {});
}

function siteFromHost(hostname) {
  return ({
    'tools.i41.cn': 'tools', 'imgzip.i41.cn': 'imgzip', 'pdf.i41.cn': 'pdf',
    'idphoto.i41.cn': 'idphoto', 'watermark.i41.cn': 'watermark', 'clip.i41.cn': 'clip',
  })[hostname];
}

function placementFor(link) {
  const url = new URL(link.href, location.href);
  const content = url.searchParams.get('utm_content');
  if (PLACEMENTS.has(content)) return content;
  if (link.closest('footer')) return 'footer';
  if (link.closest('aside')) return 'promo_banner';
  return 'ecosystem_nav';
}

function init() {
  const site = document.documentElement.dataset.i41Site || siteFromHost(location.hostname);
  if (!SITES.has(site)) return;
  let lastPagePath = cleanPath();
  // Only the first page_view carries the external source; later SPA views and clicks never do.
  if (lastPagePath) send({ site, event: 'page_view', path: lastPagePath, ...attribution(), ...externalReferrer() });
  if (site === 'pdf') {
    globalThis.addEventListener?.('hashchange', () => {
      const path = cleanPath();
      if (!path || path === lastPagePath) return;
      lastPagePath = path;
      send({ site, event: 'page_view', path });
    });
  }
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    let url;
    try { url = new URL(link.href, location.href); } catch { return; }
    if (url.hostname === 'www.i41.cn' || url.hostname === 'i41.cn') {
      send({ site, event: 'primary_product_click', path: cleanPath(), target: 'primary', placement: placementFor(link) });
      return;
    }
    const target = siteFromHost(url.hostname);
    if (target && target !== site) send({ site, event: 'ecosystem_click', path: cleanPath(), target, placement: placementFor(link) });
  }, { capture: true });
}

init();
