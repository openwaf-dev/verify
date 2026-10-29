// The same loader ships in @openwaf/verify-react and @openwaf/verify-vue
// (react/src/loader.ts, vue/src/loader.ts); keep both copies identical.
import type { OwafVerifyApi } from './types.js';

/** Path of the widget script served first-party by the OpenWAF edge on the site's own host. */
export const DEFAULT_SCRIPT_SRC = '/__waf/challenge/v1/widget.js';

type VerifyWindow = { owafVerify?: OwafVerifyApi; [global: string]: unknown };

let pending: Promise<OwafVerifyApi> | undefined;
let sequence = 0;

/**
 * Loads `widget.js` once per page in explicit-render mode and resolves with
 * `window.owafVerify`. Concurrent callers share one script element; an API that
 * is already present (or a widget script already in the document) is reused.
 * A failed load rejects and lets the next call try again. While a load is in
 * flight, later calls share it whatever `src` they pass.
 */
export function loadVerify(src: string = DEFAULT_SCRIPT_SRC): Promise<OwafVerifyApi> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('owafVerify: loadVerify() needs a browser'));
  }
  const w = window as unknown as VerifyWindow;
  if (w.owafVerify) return Promise.resolve(w.owafVerify);
  pending ??= inject(w, src).catch((err: unknown) => {
    pending = undefined;
    throw err;
  });
  return pending;
}

function inject(w: VerifyWindow, src: string): Promise<OwafVerifyApi> {
  return new Promise<OwafVerifyApi>((resolve, reject) => {
    const url = new URL(src, document.baseURI);
    const settle = (): void => {
      if (w.owafVerify) resolve(w.owafVerify);
      else reject(new Error(`owafVerify: ${url.pathname} loaded without defining window.owafVerify`));
    };
    const failed = (): void => reject(new Error(`owafVerify: failed to load ${url.pathname}`));

    const existing = findScript(url);
    if (existing) {
      existing.addEventListener('load', settle, { once: true });
      existing.addEventListener('error', failed, { once: true });
      return;
    }

    const onload = `__owafVerifyOnload_${++sequence}_${Math.random().toString(36).slice(2)}`;
    w[onload] = () => {
      delete w[onload];
      settle();
    };
    url.searchParams.set('render', 'explicit');
    url.searchParams.set('onload', onload);
    const script = document.createElement('script');
    script.src = url.href;
    script.async = true;
    script.addEventListener(
      'error',
      () => {
        delete w[onload];
        script.remove();
        failed();
      },
      { once: true },
    );
    document.head.appendChild(script);
  });
}

function findScript(url: URL): HTMLScriptElement | undefined {
  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    const candidate = new URL(script.src, document.baseURI);
    if (candidate.origin === url.origin && candidate.pathname === url.pathname) return script;
  }
  return undefined;
}
