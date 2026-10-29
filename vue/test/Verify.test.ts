import { createApp, h, reactive, ref } from 'vue';
import type { App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeOwafVerify } from './fake-owaf.js';
import type * as VerifyModule from '../src/Verify.js';
import type { VerifyExposed } from '../src/Verify.js';

type Globals = Record<string, unknown> & { owafVerify?: unknown };
const g = globalThis as unknown as Globals;

let Verify: typeof VerifyModule.Verify;
let fake: FakeOwafVerify;
let container: HTMLElement;
let app: App | null;

/**
 * Lets pending promise callbacks (script load, render) and the Vue scheduler run.
 * A zero-delay macrotask drains every queued microtask whatever the chain depth;
 * it waits on no clock.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  // A fresh module graph per test gives each test a fresh loader state.
  vi.resetModules();
  ({ Verify } = await import('../src/Verify.js'));
  document.head.replaceChildren();
  fake = new FakeOwafVerify();
  g.owafVerify = fake;
  container = document.createElement('div');
  document.body.appendChild(container);
  app = null;
});

afterEach(() => {
  app?.unmount();
  container.remove();
  delete g.owafVerify;
});

/** Mounts <Verify v-bind="state" ref="handle" />; mutate `state` to change props. */
async function mount(initial: Record<string, unknown>) {
  const state = reactive<Record<string, unknown>>({ ...initial });
  const handle = ref<VerifyExposed | null>(null);
  const shown = ref(true);
  app = createApp({ render: () => (shown.value ? h(Verify, { ...state, ref: handle } as never) : null) });
  app.mount(container);
  await settle();
  return { state, handle, shown };
}

describe('<Verify>', () => {
  it('renders the widget into its own element with the mapped options', async () => {
    await mount({
      siteKey: 'owk_test_pass',
      action: 'signup',
      cdata: 'order-42',
      theme: 'dark',
      language: 'es',
      size: 'compact',
      accent: '#0a7',
      responseFieldName: 'captcha',
      refreshExpired: 'manual',
      class: 'verify-box',
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
  });

  it('leaves unset props out of the render options so widget defaults apply', async () => {
    await mount({ siteKey: 'owk_test_pass' });
    expect(Object.keys(fake.widgets[0]!.options).sort()).toEqual(
      ['callback', 'errorCallback', 'expiredCallback', 'sitekey'].sort(),
    );
  });

  it('emits success, error and expired from the widget callbacks', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onExpired = vi.fn();
    await mount({ siteKey: 'owk_test_pass', onSuccess, onError, onExpired });
    const [w] = fake.widgets;
    fake.solve(w!.id, 'v1.TEST.TOKEN');
    w!.options.errorCallback!('test-fail');
    w!.options.expiredCallback!();
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('v1.TEST.TOKEN');
    expect(onError).toHaveBeenCalledExactlyOnceWith('test-fail');
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('uses the latest listener without re-rendering the widget', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { state } = await mount({ siteKey: 'owk_test_pass', onSuccess: first });
    state.onSuccess = second;
    await settle();
    expect(fake.widgets).toHaveLength(1);
    fake.solve(fake.widgets[0]!.id, 'v1.TEST.TOKEN');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('v1.TEST.TOKEN');
  });

  it.each([
    ['siteKey', 'owk_test_fail', 'sitekey'],
    ['action', 'login', 'action'],
    ['cdata', 'x', 'cdata'],
    ['theme', 'light', 'theme'],
    ['language', 'en', 'language'],
    ['size', 'compact', 'size'],
    ['accent', '#123456', 'accent'],
    ['responseFieldName', 'token', 'responseFieldName'],
    ['refreshExpired', 'manual', 'refreshExpired'],
  ])('re-renders the widget when %s changes', async (prop, value, option) => {
    const { state } = await mount({ siteKey: 'owk_test_pass' });
    const [old] = fake.widgets;
    state[prop] = value;
    await settle();
    expect(old!.removed).toBe(true);
    expect(fake.live).toHaveLength(1);
    expect(fake.live[0]!.options).toMatchObject({ [option]: value });
    expect(container.querySelectorAll('.owaf-v')).toHaveLength(1);
  });

  it('does not re-render the widget when only the class changes', async () => {
    const { state } = await mount({ siteKey: 'owk_test_pass', class: 'a' });
    state.class = 'b';
    await settle();
    expect(fake.widgets).toHaveLength(1);
    expect((container.firstElementChild as HTMLElement).className).toBe('b');
  });

  it('removes the widget and its element on unmount', async () => {
    const { shown } = await mount({ siteKey: 'owk_test_pass' });
    const id = fake.widgets[0]!.id;
    shown.value = false;
    await settle();
    expect(fake.calls).toContain(`remove:${id}`);
    expect(fake.live).toHaveLength(0);
    expect(container.querySelector('.owaf-v')).toBeNull();
  });

  it('shares one script between widgets mounted together', async () => {
    delete g.owafVerify;
    app = createApp({
      render: () => [h(Verify, { siteKey: 'owk_test_pass' }), h(Verify, { siteKey: 'owk_test_interactive' })],
    });
    app.mount(container);
    await settle();
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[src*="widget.js"]');
    expect(scripts).toHaveLength(1);
    expect(new URL(scripts[0]!.src).searchParams.get('render')).toBe('explicit');
    const onload = new URL(scripts[0]!.src).searchParams.get('onload')!;
    g.owafVerify = fake;
    (g[onload] as () => void)();
    await settle();
    expect(fake.live.map((w) => w.options.sitekey)).toEqual(['owk_test_pass', 'owk_test_interactive']);
  });

  it('does not render a widget that was unmounted while the script loaded', async () => {
    delete g.owafVerify;
    const { shown } = await mount({ siteKey: 'owk_test_pass' });
    shown.value = false;
    await settle();
    const script = document.querySelector<HTMLScriptElement>('script[src*="widget.js"]')!;
    g.owafVerify = fake;
    (g[new URL(script.src).searchParams.get('onload')!] as () => void)();
    await settle();
    expect(fake.widgets).toHaveLength(0);
  });

  it('emits error script-load when the widget script fails to load', async () => {
    delete g.owafVerify;
    const onError = vi.fn();
    await mount({ siteKey: 'owk_test_pass', onError });
    document.querySelector('script[src*="widget.js"]')!.dispatchEvent(new Event('error'));
    await settle();
    expect(onError).toHaveBeenCalledExactlyOnceWith('script-load');
  });

  it('does not emit a script failure after unmount', async () => {
    delete g.owafVerify;
    const onError = vi.fn();
    const { shown } = await mount({ siteKey: 'owk_test_pass', onError });
    const script = document.querySelector('script[src*="widget.js"]')!;
    shown.value = false;
    await settle();
    script.dispatchEvent(new Event('error'));
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });

  it('exposes reset, execute, getResponse, isExpired and remove', async () => {
    const { handle } = await mount({ siteKey: 'owk_test_pass' });
    const [w] = fake.widgets;
    const api = handle.value!;
    expect(api.getResponse()).toBe('');
    expect(api.isExpired()).toBe(true);
    fake.solve(w!.id, 'v1.TEST.TOKEN');
    expect(api.getResponse()).toBe('v1.TEST.TOKEN');
    expect(api.isExpired()).toBe(false);
    await expect(api.execute()).resolves.toBe('v1.TEST.TOKEN');
    api.reset();
    expect(fake.calls).toContain(`reset:${w!.id}`);
    expect(api.getResponse()).toBe('');
    api.remove();
    expect(fake.live).toHaveLength(0);
    await expect(api.execute()).rejects.toThrow('not mounted');
  });

  it('lets execute() wait until the widget has been rendered', async () => {
    delete g.owafVerify;
    const { handle } = await mount({ siteKey: 'owk_test_pass' });
    const pending = handle.value!.execute();
    const script = document.querySelector<HTMLScriptElement>('script[src*="widget.js"]')!;
    g.owafVerify = fake;
    (g[new URL(script.src).searchParams.get('onload')!] as () => void)();
    await expect(pending).resolves.toBe('v1.EXECUTED');
    expect(fake.calls).toContain(`execute:${fake.widgets[0]!.id}`);
  });
});
