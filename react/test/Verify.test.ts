import { StrictMode, act, createElement, createRef } from 'react';
import type { Ref } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeOwafVerify } from './fake-owaf.js';
import type * as VerifyModule from '../src/Verify.js';
import type { VerifyHandle, VerifyProps } from '../src/Verify.js';

type Globals = Record<string, unknown> & { owafVerify?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
const g = globalThis as unknown as Globals;
g.IS_REACT_ACT_ENVIRONMENT = true;

let Verify: typeof VerifyModule.Verify;
let fake: FakeOwafVerify;
let container: HTMLElement;
let root: Root;

beforeEach(async () => {
  // A fresh module graph per test gives each test a fresh loader state.
  vi.resetModules();
  ({ Verify } = await import('../src/Verify.js'));
  document.head.replaceChildren();
  fake = new FakeOwafVerify();
  g.owafVerify = fake;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete g.owafVerify;
});

async function render(props: VerifyProps, ref?: Ref<VerifyHandle>, strict = false): Promise<void> {
  const element = createElement(Verify, { ...props, ref });
  await act(async () => root.render(strict ? createElement(StrictMode, null, element) : element));
}

describe('<Verify>', () => {
  it('renders the widget into its own element with the mapped options', async () => {
    await render({
      siteKey: 'owk_test_pass',
      action: 'signup',
      cdata: 'order-42',
      theme: 'dark',
      language: 'es',
      size: 'compact',
      accent: '#0a7',
      responseFieldName: 'captcha',
      refreshExpired: 'manual',
      className: 'verify-box',
    });
    expect(fake.widgets).toHaveLength(1);
    const [w] = fake.widgets;
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toBe('verify-box');
    expect(w!.container.parentElement).toBe(outer);
    expect(w!.options).toMatchObject({
      sitekey: 'owk_test_pass',
      action: 'signup',
      cdata: 'order-42',
      theme: 'dark',
      language: 'es',
      size: 'compact',
      accent: '#0a7',
      responseFieldName: 'captcha',
      refreshExpired: 'manual',
    });
    expect(typeof w!.options.callback).toBe('function');
    expect(typeof w!.options.errorCallback).toBe('function');
    expect(typeof w!.options.expiredCallback).toBe('function');
  });

  it('leaves unset props out of the render options so widget defaults apply', async () => {
    await render({ siteKey: 'owk_test_pass' });
    expect(Object.keys(fake.widgets[0]!.options).sort()).toEqual(
      ['callback', 'errorCallback', 'expiredCallback', 'sitekey'].sort(),
    );
  });

  it('routes widget callbacks to the latest props without re-rendering the widget', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const onError = vi.fn();
    const onExpired = vi.fn();
    await render({ siteKey: 'owk_test_pass', onSuccess: first });
    await render({ siteKey: 'owk_test_pass', onSuccess: second, onError, onExpired });
    expect(fake.widgets).toHaveLength(1);
    const [w] = fake.widgets;
    act(() => fake.solve(w!.id, 'v1.TEST.TOKEN'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('v1.TEST.TOKEN');
    w!.options.errorCallback!('test-fail');
    w!.options.expiredCallback!();
    expect(onError).toHaveBeenCalledWith('test-fail');
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['siteKey', { siteKey: 'owk_test_fail' }, { sitekey: 'owk_test_fail' }],
    ['action', { action: 'login' }, { action: 'login' }],
    ['cdata', { cdata: 'x' }, { cdata: 'x' }],
    ['theme', { theme: 'light' }, { theme: 'light' }],
    ['language', { language: 'en' }, { language: 'en' }],
    ['size', { size: 'compact' }, { size: 'compact' }],
    ['accent', { accent: '#123456' }, { accent: '#123456' }],
    ['responseFieldName', { responseFieldName: 'token' }, { responseFieldName: 'token' }],
    ['refreshExpired', { refreshExpired: 'manual' }, { refreshExpired: 'manual' }],
  ] as const)('re-renders the widget when %s changes', async (_name, change, option) => {
    await render({ siteKey: 'owk_test_pass' });
    const [old] = fake.widgets;
    await render({ siteKey: 'owk_test_pass', ...change });
    expect(old!.removed).toBe(true);
    expect(fake.live).toHaveLength(1);
    expect(fake.live[0]!.options).toMatchObject(option);
    expect(container.querySelectorAll('.owaf-v')).toHaveLength(1);
  });

  it('does not re-render the widget when only className changes', async () => {
    await render({ siteKey: 'owk_test_pass', className: 'a' });
    await render({ siteKey: 'owk_test_pass', className: 'b' });
    expect(fake.widgets).toHaveLength(1);
    expect((container.firstElementChild as HTMLElement).className).toBe('b');
  });

  it('removes the widget and its element on unmount', async () => {
    await render({ siteKey: 'owk_test_pass' });
    const id = fake.widgets[0]!.id;
    await act(async () => root.render(null));
    expect(fake.calls).toContain(`remove:${id}`);
    expect(fake.live).toHaveLength(0);
    expect(container.innerHTML).toBe('');
  });

  it('keeps exactly one widget under StrictMode and none after unmount', async () => {
    await render({ siteKey: 'owk_test_pass' }, undefined, true);
    expect(fake.live).toHaveLength(1);
    expect(container.querySelectorAll('.owaf-v')).toHaveLength(1);
    await act(async () => root.render(null));
    expect(fake.live).toHaveLength(0);
  });

  it('loads the script once under StrictMode and renders one widget when it arrives', async () => {
    delete g.owafVerify;
    await render({ siteKey: 'owk_test_pass' }, undefined, true);
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[src*="widget.js"]');
    expect(scripts).toHaveLength(1);
    expect(fake.widgets).toHaveLength(0);
    const onload = new URL(scripts[0]!.src).searchParams.get('onload')!;
    await act(async () => {
      g.owafVerify = fake;
      (g[onload] as () => void)();
    });
    expect(fake.widgets).toHaveLength(1);
    expect(fake.live).toHaveLength(1);
  });

  it('shares one script between widgets mounted together', async () => {
    delete g.owafVerify;
    const element = createElement('div', null, [
      createElement(Verify, { key: 'a', siteKey: 'owk_test_pass' }),
      createElement(Verify, { key: 'b', siteKey: 'owk_test_interactive' }),
    ]);
    await act(async () => root.render(element));
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[src*="widget.js"]');
    expect(scripts).toHaveLength(1);
    const onload = new URL(scripts[0]!.src).searchParams.get('onload')!;
    await act(async () => {
      g.owafVerify = fake;
      (g[onload] as () => void)();
    });
    expect(fake.live.map((w) => w.options.sitekey)).toEqual(['owk_test_pass', 'owk_test_interactive']);
  });

  it('reports script-load when the widget script fails to load', async () => {
    delete g.owafVerify;
    const onError = vi.fn();
    await render({ siteKey: 'owk_test_pass', onError });
    const script = document.querySelector('script[src*="widget.js"]')!;
    await act(async () => {
      script.dispatchEvent(new Event('error'));
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith('script-load');
  });

  it('does not report a script failure after unmount', async () => {
    delete g.owafVerify;
    const onError = vi.fn();
    await render({ siteKey: 'owk_test_pass', onError });
    const script = document.querySelector('script[src*="widget.js"]')!;
    await act(async () => root.render(null));
    await act(async () => {
      script.dispatchEvent(new Event('error'));
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('exposes reset, execute, getResponse, isExpired and remove through ref', async () => {
    const ref = createRef<VerifyHandle>();
    await render({ siteKey: 'owk_test_pass' }, ref);
    const [w] = fake.widgets;
    const handle = ref.current!;
    expect(handle.getResponse()).toBe('');
    expect(handle.isExpired()).toBe(true);
    act(() => fake.solve(w!.id, 'v1.TEST.TOKEN'));
    expect(handle.getResponse()).toBe('v1.TEST.TOKEN');
    expect(handle.isExpired()).toBe(false);
    await expect(handle.execute()).resolves.toBe('v1.TEST.TOKEN');
    handle.reset();
    expect(fake.calls).toContain(`reset:${w!.id}`);
    expect(handle.getResponse()).toBe('');
    handle.remove();
    expect(fake.live).toHaveLength(0);
    expect(handle.getResponse()).toBe('');
    await expect(handle.execute()).rejects.toThrow('not mounted');
  });

  it('lets execute() wait until the widget has been rendered', async () => {
    delete g.owafVerify;
    const ref = createRef<VerifyHandle>();
    await render({ siteKey: 'owk_test_pass' }, ref);
    const pending = ref.current!.execute();
    const onload = new URL(document.querySelector<HTMLScriptElement>('script[src*="widget.js"]')!.src).searchParams.get(
      'onload',
    )!;
    await act(async () => {
      g.owafVerify = fake;
      (g[onload] as () => void)();
    });
    await expect(pending).resolves.toBe('v1.EXECUTED');
    expect(fake.calls).toContain(`execute:${fake.widgets[0]!.id}`);
  });
});
