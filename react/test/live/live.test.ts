// Live test: the built component against the real OpenWAF edge widget.
// widget.js must be same-origin, so the test page is served AS a fresh unused
// path on https://developers.openwaf.dev (fulfilled locally by Playwright);
// only /__waf/challenge/* reaches the network, every other request to that
// host is aborted. Only test sitekeys are used. Skip with OPENWAF_VERIFY_LIVE=0.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {} from './app.js';

const ORIGIN = 'https://developers.openwaf.dev';
const TOKEN = 'v1.TEST.TOKEN';

interface EdgeResponse {
  method: string;
  path: string;
  status: number;
}

describe.skipIf(process.env.OPENWAF_VERIFY_LIVE === '0')('live widget from the OpenWAF edge', () => {
  let browser: Browser;
  let page: Page;
  const edge: EdgeResponse[] = [];
  const blocked: string[] = [];

  beforeAll(async () => {
    const bundle = await build({
      entryPoints: [fileURLToPath(new URL('./app.ts', import.meta.url))],
      bundle: true,
      format: 'iife',
      target: 'es2020',
      minify: true,
      write: false,
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const base = `${ORIGIN}/oss-verify-react-test-${randomUUID()}/`;
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>verify-react live test</title></head>' +
      '<body><form id="form"><div id="root"></div></form><script src="./app.js"></script></body></html>';

    browser = await chromium.launch();
    page = await browser.newPage();
    // Last registered route wins: the guard is the fallback for everything on the host.
    await page.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/__waf/challenge/')) return route.continue();
      blocked.push(url.pathname);
      return route.abort();
    });
    await page.route(`${ORIGIN}/favicon.ico`, (route) => route.fulfill({ status: 204 }));
    await page.route(base, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: { 'content-security-policy': "default-src 'self'" },
        body: html,
      }),
    );
    await page.route(`${base}app.js`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: bundle.outputFiles[0]!.text }),
    );
    page.on('response', (res) => {
      const url = new URL(res.url());
      if (url.origin === ORIGIN && url.pathname.startsWith('/__waf/challenge/')) {
        edge.push({ method: res.request().method(), path: url.pathname, status: res.status() });
      }
    });
    await page.goto(base);
    await page.waitForFunction(() => typeof window.harness === 'object');
  }, 60_000);

  afterAll(async () => {
    console.info(`edge responses: ${JSON.stringify(edge)}`);
    await browser?.close();
  });

  const state = () => page.locator('#root .owaf-v').getAttribute('data-state');
  const input = () => page.locator('#root input[name="owaf-verify-response"]').inputValue();
  const eventsOf = (type: string) =>
    page.evaluate((t) => window.harness.events.filter((e) => e.type === t).map((e) => e.value), type);

  it('solves with owk_test_pass: onSuccess token, hidden input and data-state=success', async () => {
    await page.evaluate(() => window.harness.mount('owk_test_pass'));
    await page.waitForFunction(() => window.harness.events.some((e) => e.type === 'success'), null, { timeout: 30_000 });
    expect(await eventsOf('success')).toEqual([TOKEN]);
    expect(await input()).toBe(TOKEN);
    expect(await state()).toBe('success');
    expect(await page.evaluate(() => window.harness.getResponse())).toBe(TOKEN);
    // StrictMode double mount left one widget and one explicit-render script.
    expect(await page.locator('#root .owaf-v').count()).toBe(1);
    const scripts = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLScriptElement>('script[src*="/__waf/challenge/v1/widget.js"]'), (s) => s.src),
    );
    expect(scripts).toHaveLength(1);
    expect(new URL(scripts[0]!).searchParams.get('render')).toBe('explicit');
    expect(edge.some((r) => r.path === '/__waf/challenge/v1/widget.js' && r.status === 200)).toBe(true);
    expect(edge.some((r) => r.method === 'POST' && r.status === 200)).toBe(true);
  });

  it('solves again after reset() and execute() resolves the token', async () => {
    const postsBefore = edge.filter((r) => r.method === 'POST').length;
    await page.evaluate(() => window.harness.reset());
    await page.waitForFunction(() => window.harness.events.filter((e) => e.type === 'success').length === 2, null, {
      timeout: 30_000,
    });
    expect(await eventsOf('success')).toEqual([TOKEN, TOKEN]);
    expect(await state()).toBe('success');
    expect(await input()).toBe(TOKEN);
    expect(edge.filter((r) => r.method === 'POST').length).toBeGreaterThan(postsBefore);
    expect(await page.evaluate(() => window.harness.execute())).toBe(TOKEN);
  });

  it('re-renders with owk_test_fail when siteKey changes: onError test-fail and data-state=error', async () => {
    await page.evaluate(() => window.harness.mount('owk_test_fail'));
    await page.waitForFunction(() => window.harness.events.some((e) => e.type === 'error'), null, { timeout: 30_000 });
    expect(await eventsOf('error')).toEqual(['test-fail']);
    expect(await page.locator('#root .owaf-v').count()).toBe(1);
    expect(await state()).toBe('error');
    expect(await input()).toBe('');
  });

  it('removes the widget DOM on unmount', async () => {
    await page.evaluate(() => window.harness.unmount());
    expect(await page.locator('#root').innerHTML()).toBe('');
    expect(await page.locator('.owaf-v, input[name="owaf-verify-response"]').count()).toBe(0);
  });

  it('ran under CSP default-src \'self\' without violations and touched no real page', async () => {
    expect(await page.evaluate(() => window.harness.violations)).toEqual([]);
    expect(blocked).toEqual([]);
  });
});
