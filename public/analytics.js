const ENDPOINT = 'https://stats.i41.cn/event';
const SITES = new Set(['tools', 'imgzip', 'pdf', 'idphoto', 'watermark', 'clip']);
const PLACEMENTS = new Set(['header_dropdown', 'homepage_tools', 'footer_tools', 'ecosystem_nav', 'promo_banner', 'footer']);
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
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
  if (lastPagePath) send({ site, event: 'page_view', path: lastPagePath, ...attribution() });
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
