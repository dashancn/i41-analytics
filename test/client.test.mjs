import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/analytics.js', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../public/dashboard.js', import.meta.url), 'utf8');

function dashboardRouteLabel(row) {
  const context = {};
  const withoutInit = dashboardSource.replace(/document\.querySelectorAll[\s\S]*$/, '');
  vm.runInNewContext(`${withoutInit}\nthis.result = routeLabel(${JSON.stringify(row)});`, context);
  return context.result;
}

function cleanPathFor(location) {
  const context = { location, URLSearchParams, URL, navigator: {}, fetch() {}, document: {} };
  vm.runInNewContext(`${source.replace(/init\(\);\s*$/, '')}\nthis.result = cleanPath();`, context);
  return context.result;
}

function pageTrackingFor(location, hashes, site = 'pdf') {
  const listeners = new Map();
  const events = [];
  const context = {
    location,
    URLSearchParams,
    URL,
    navigator: { sendBeacon(_url, body) { events.push(JSON.parse(body)); return true; } },
    fetch() {},
    document: {
      documentElement: { dataset: { i41Site: site } },
      addEventListener() {},
    },
    addEventListener(name, handler) { listeners.set(name, handler); },
  };
  vm.runInNewContext(source, context);
  for (const hash of hashes) {
    location.hash = hash;
    listeners.get('hashchange')?.();
  }
  return {
    views: events.filter(event => event.event === 'page_view'),
    hasHashchangeListener: listeners.has('hashchange'),
  };
}

test('public root renders the aggregate analytics dashboard', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /i41 工具生态数据/);
  assert.match(html, /近 7 天/);
  assert.match(html, /站点访问/);
  assert.match(html, /i方案入口来源/);
  assert.match(html, /跨站导流/);
  assert.match(html, /不收集文件、用户输入或永久身份标识/);
  assert.match(html, /src="\/dashboard\.js"/);
  assert.doesNotMatch(html, /writing-mode/);
  assert.match(html, /<form[^>]*method="post"[^>]*action="\/logout"/);
  assert.match(html, />退出<\/button>/);
});

test('dashboard client loads aggregates and does not contain credentials', async () => {
  const dashboard = await readFile(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  assert.match(dashboard, /\/api\/dashboard\?range=/);
  assert.match(dashboard, /setInterval/);
  assert.doesNotMatch(dashboard, /Bearer|ANALYTICS_API_TOKEN|cfoat_|secret/i);
  assert.match(dashboard, /row\.site/);
  assert.match(dashboard, /来源/);
  assert.match(dashboard, /primary_product_click/);
  assert.match(dashboard, /localeCompare\(right\.site/);
  assert.match(dashboard, /sortOutbound\(filtered\(dashboardData\.outbound/);
  assert.match(dashboard, /图片工具/);
  assert.doesNotMatch(dashboard, /imgzip:'图片压缩'/);
  assert.match(dashboard, /dashboardData\.pages/);
  assert.match(dashboard, /siteFilter/);
  assert.match(dashboard, /filter\(row=>.*site/s);
  assert.match(dashboard, /未知工具/);
  for (const routeLabel of ['图片压缩', 'HEIC 转换', '智能抠图', '多图拼接', 'A4 发票拼版', '合并 PDF', 'PDF 转 Markdown']) {
    assert.ok(dashboard.includes(routeLabel), `missing route label: ${routeLabel}`);
  }
});

test('dashboard labels known site roots and keeps readable unknown-route fallback', () => {
  const roots = {
    tools: '开发者工具',
    idphoto: '证件照',
    watermark: '证件水印',
    clip: '临时剪贴板',
    imgzip: '图片压缩',
    pdf: 'PDF 工具',
  };
  for (const [site, expected] of Object.entries(roots)) {
    assert.equal(dashboardRouteLabel({ site, path: '/' }), expected);
  }
  assert.equal(dashboardRouteLabel({ site: 'tools', path: '/json-format' }), '未知工具（开发者工具 /json-format）');
});

test('dashboard has a tool visits panel and all six site filters', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /工具访问/);
  assert.match(html, /id="tools"/);
  assert.match(html, /id="siteFilter"/);
  for (const site of ['全部站点', '开发者工具', '图片工具', 'PDF 工具', '证件照', '证件水印', '临时剪贴板']) {
    assert.ok(html.includes(site), `missing site filter: ${site}`);
  }
});

test('login page asks for a password without embedding it', async () => {
  const html = await readFile(new URL('../public/login-page.txt', import.meta.url), 'utf8');
  assert.match(html, /统计面板登录/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /0701/);
});

test('client sends only the three approved event names', () => {
  for (const name of ['page_view','ecosystem_click','primary_product_click']) assert.ok(source.includes(`event: '${name}'`));
  for (const forbidden of ['filename','password','clipboard','userAgent','cookie','localStorage']) assert.ok(!source.includes(forbidden));
});

test('client is best effort, avoids CORS preflight, and preserves navigation', () => {
  assert.match(source, /navigator\.sendBeacon/);
  assert.match(source, /keepalive: true/);
  assert.match(source, /Content-Type': 'text\/plain;charset=UTF-8'/);
  assert.doesNotMatch(source, /new Blob/);
  assert.doesNotMatch(source, /preventDefault/);
});

test('client recognizes all six canonical tool hosts', () => {
  for (const host of ['tools.i41.cn','imgzip.i41.cn','pdf.i41.cn','idphoto.i41.cn','watermark.i41.cn','clip.i41.cn']) assert.ok(source.includes(host));
});

test('client normalizes PDF SPA hash routes without query data', () => {
  assert.equal(cleanPathFor({ hostname: 'pdf.i41.cn', pathname: '/', hash: '#/invoice-nup?invoice=secret', search: '?utm_source=ifangan' }), '/invoice-nup');
  assert.equal(cleanPathFor({ hostname: 'pdf.i41.cn', pathname: '/', hash: '#/merge-pdf#private', search: '' }), '/merge-pdf');
});

test('client records each distinct PDF hash tool navigation once', () => {
  const { views, hasHashchangeListener } = pageTrackingFor(
    { hostname: 'pdf.i41.cn', pathname: '/', hash: '#/', search: '' },
    ['#/invoice-nup?invoice=secret', '#/invoice-nup?other=private', '#/ocr-pdf'],
  );
  assert.equal(hasHashchangeListener, true);
  assert.deepEqual(views.map(view => view.path), ['/', '/invoice-nup', '/ocr-pdf']);
  assert.ok(views.every(view => JSON.stringify(view).includes('secret') === false));
  assert.ok(views.every(view => JSON.stringify(view).includes('private') === false));
});

test('ordinary pathname sites ignore route-looking hashes and do not track hashchange', () => {
  assert.equal(cleanPathFor({ hostname: 'imgzip.i41.cn', pathname: '/collage/', hash: '#/private-route?secret=1', search: '' }), '/collage/');
  const { views, hasHashchangeListener } = pageTrackingFor(
    { hostname: 'imgzip.i41.cn', pathname: '/collage/', hash: '#/private-route', search: '' },
    ['#/remove-background/', '#/heic-converter/'],
    'imgzip',
  );
  assert.equal(hasHashchangeListener, false);
  assert.deepEqual(views.map(view => view.path), ['/collage/']);
});

test('client preserves ordinary pathname routes and strips unsafe URL data', () => {
  for (const pathname of ['/', '/collage/', '/remove-background/', '/heic-converter/']) {
    assert.equal(cleanPathFor({ hostname: 'imgzip.i41.cn', pathname, hash: '', search: '?filename=private.jpg' }), pathname);
  }
  assert.equal(cleanPathFor({ hostname: 'imgzip.i41.cn', pathname: '/safe/?filename=private.jpg', hash: '', search: '' }), '/safe/');
  assert.equal(cleanPathFor({ hostname: 'imgzip.i41.cn', pathname: '/', hash: '#token=private', search: '' }), '/');
});
