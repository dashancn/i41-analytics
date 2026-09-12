import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sitemap = await readFile(new URL('./fixtures/tools-sitemap.xml', import.meta.url), 'utf8');
const sitemapPaths = [...sitemap.matchAll(/<loc>https:\/\/tools\.i41\.cn(\/[^<]*)<\/loc>/g)].map(match => match[1]);

test('tools route registry exactly covers the current analytics-enabled sitemap routes', async () => {
  const { toolsRouteNames } = await import('../public/tool-route-names.js');
  assert.equal(sitemapPaths.length, 87);
  assert.equal(Object.keys(toolsRouteNames).length, 87);
  assert.deepEqual(Object.keys(toolsRouteNames).sort(), sitemapPaths.sort());
});

test('every tools route has a non-empty Chinese dashboard label', async () => {
  const { toolsRouteNames } = await import('../public/tool-route-names.js');
  for (const [path, label] of Object.entries(toolsRouteNames)) {
    assert.match(path, /^\/[a-z0-9/-]*$/);
    assert.equal(typeof label, 'string');
    assert.ok(label.trim(), `empty label for ${path}`);
    assert.match(label, /[\u3400-\u9fff]/, `label is not Chinese for ${path}: ${label}`);
  }
});

test('registry is vendored and has no runtime coupling to the tools repository', async () => {
  const source = await readFile(new URL('../public/tool-route-names.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /i41-audit|it-tools|fetch\(|sitemap\.xml/);
});
