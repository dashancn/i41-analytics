const ENDPOINT = 'https://stats.i41.cn/event';
const SITES = new Set(['tools', 'imgzip', 'pdf', 'idphoto', 'watermark', 'clip']);
const PLACEMENTS = new Set(['header_dropdown', 'homepage_tools', 'footer_tools', 'ecosystem_nav', 'promo_banner', 'footer']);
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];

function cleanPath() {
  const path = location.pathname.replace(/[^A-Za-z0-9/_-]/g, '');
  return path.length <= 120 ? path || '/' : '/';
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
  if (navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    return;
  }
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
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
  send({ site, event: 'page_view', path: cleanPath(), ...attribution() });
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
