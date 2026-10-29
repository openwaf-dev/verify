import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeOwafVerify } from './fake-owaf.js';
import type * as LoaderModule from '../src/loader.js';

type Loader = typeof LoaderModule;
type Globals = Record<string, unknown> & { owafVerify?: unknown };
const g = window as unknown as Globals;

async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return import('../src/loader.js');
}

function widgetScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[src*="/__waf/challenge/v1/widget.js"]'));
}

/** Plays the part of widget.js: defines the API, then calls the onload global named in its URL. */
function runWidgetScript(script: HTMLScriptElement, api: FakeOwafVerify): void {
  g.owafVerify = api;
  const onload = new URL(script.src).searchParams.get('onload');
  if (!onload) throw new Error('no onload parameter');
  (g[onload] as () => void)();
}

beforeEach(() => {
  delete g.owafVerify;
  document.head.replaceChildren();
});
afterEach(() => {
  delete g.owafVerify;
});

describe('loadVerify', () => {
  it('injects one explicit-render script for concurrent callers and resolves them all', async () => {
    const { loadVerify } = await freshLoader();
    const calls = [loadVerify(), loadVerify(), loadVerify()];
    const scripts = widgetScripts();
    expect(scripts).toHaveLength(1);
    const url = new URL(scripts[0]!.src);
    expect(url.pathname).toBe('/__waf/challenge/v1/widget.js');
    expect(url.origin).toBe(location.origin);
    expect(url.searchParams.get('render')).toBe('explicit');
    const onload = url.searchParams.get('onload')!;
    expect(onload).toMatch(/^__owafVerifyOnload_/);

    const api = new FakeOwafVerify();
    runWidgetScript(scripts[0]!, api);
    const results = await Promise.all(calls);
    expect(results.every((r) => r === api)).toBe(true);
    expect(g[onload]).toBeUndefined();
    // Later callers reuse the loaded API without another script.
    expect(await loadVerify()).toBe(api);
    expect(widgetScripts()).toHaveLength(1);
  });

  it('reuses an API that is already on the page without injecting a script', async () => {
    const { loadVerify } = await freshLoader();
    const api = new FakeOwafVerify();
    g.owafVerify = api;
    expect(await loadVerify()).toBe(api);
    expect(widgetScripts()).toHaveLength(0);
  });

  it('waits for a widget script already in the document instead of adding another', async () => {
    const { loadVerify } = await freshLoader();
    const tag = document.createElement('script');
    tag.src = '/__waf/challenge/v1/widget.js?render=explicit';
    document.head.appendChild(tag);
    const promise = loadVerify();
    expect(widgetScripts()).toHaveLength(1);
    const api = new FakeOwafVerify();
    g.owafVerify = api;
    tag.dispatchEvent(new Event('load'));
    expect(await promise).toBe(api);
  });

  it('rejects on a script error, removes the script and its global, and retries on the next call', async () => {
    const { loadVerify } = await freshLoader();
    const first = loadVerify();
    const [script] = widgetScripts();
    const onload = new URL(script!.src).searchParams.get('onload')!;
    script!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow('failed to load /__waf/challenge/v1/widget.js');
    expect(widgetScripts()).toHaveLength(0);
    expect(g[onload]).toBeUndefined();

    const second = loadVerify();
    const retried = widgetScripts();
    expect(retried).toHaveLength(1);
    const api = new FakeOwafVerify();
    runWidgetScript(retried[0]!, api);
    expect(await second).toBe(api);
  });

  it('rejects when the script loads but does not define window.owafVerify', async () => {
    const { loadVerify } = await freshLoader();
    const promise = loadVerify();
    const onload = new URL(widgetScripts()[0]!.src).searchParams.get('onload')!;
    (g[onload] as () => void)();
    await expect(promise).rejects.toThrow('without defining window.owafVerify');
  });

  it('keeps the query of a custom script URL and adds explicit-render parameters', async () => {
    const { loadVerify } = await freshLoader();
    void loadVerify('https://www.example.com/__waf/challenge/v1/widget.js?v=2');
    const url = new URL(widgetScripts()[0]!.src);
    expect(url.origin).toBe('https://www.example.com');
    expect(url.searchParams.get('v')).toBe('2');
    expect(url.searchParams.get('render')).toBe('explicit');
  });
});
