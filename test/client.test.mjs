import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/analytics.js', import.meta.url), 'utf8');

function cleanPathFor(location) {
  const context = { location, URLSearchParams, URL, navigator: {}, fetch() {}, document: {} };
  vm.runInNewContext(`${source.replace(/init\(\);\s*$/, '')}\nthis.result = cleanPath();`, context);
  return context.result;
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
  assert.equal(cleanPathFor({ pathname: '/', hash: '#/invoice-nup?invoice=secret', search: '?utm_source=ifangan' }), '/invoice-nup');
  assert.equal(cleanPathFor({ pathname: '/', hash: '#/merge-pdf#private', search: '' }), '/merge-pdf');
});

test('client preserves ordinary pathname routes and strips unsafe URL data', () => {
  for (const pathname of ['/', '/collage/', '/remove-background/', '/heic-converter/']) {
    assert.equal(cleanPathFor({ pathname, hash: '', search: '?filename=private.jpg' }), pathname);
  }
  assert.equal(cleanPathFor({ pathname: '/safe/?filename=private.jpg', hash: '', search: '' }), '/safe/');
  assert.equal(cleanPathFor({ pathname: '/', hash: '#token=private', search: '' }), '/');
});
