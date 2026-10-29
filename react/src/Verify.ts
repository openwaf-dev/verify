'use client';
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { DEFAULT_SCRIPT_SRC, loadVerify } from './loader.js';
import type {
  OwafVerifyApi,
  OwafVerifyRenderOptions,
  VerifyLanguage,
  VerifyRefreshExpired,
  VerifySize,
  VerifyTheme,
} from './types.js';

export interface VerifyProps {
  /** Public sitekey (`owk_…`) of the widget. */
  siteKey: string;
  /** Action label echoed back by siteverify, e.g. `login` or `signup`. */
  action?: string;
  /** Customer data echoed back by siteverify. */
  cdata?: string;
  theme?: VerifyTheme;
  language?: VerifyLanguage;
  size?: VerifySize;
  /** Accent colour, `#rgb` or `#rrggbb`. */
  accent?: string;
  /** Name of the hidden form field that carries the token. Default `owaf-verify-response`. */
  responseFieldName?: string;
  refreshExpired?: VerifyRefreshExpired;
  /** Called with the token each time the widget solves (also after a refresh or reset). */
  onSuccess?: (token: string) => void;
  /** Called with the widget error code, or `script-load` when the widget script cannot be loaded. */
  onError?: (code: string) => void;
  /** Called when the token expires without being refreshed. */
  onExpired?: () => void;
  /** Widget script URL. Default `/__waf/challenge/v1/widget.js` (first-party, served by the OpenWAF edge). */
  scriptSrc?: string;
  /** Class name of the container element. */
  className?: string;
}

/** Imperative API exposed through `ref`. */
export interface VerifyHandle {
  /** Discards the current token and solves a new challenge. */
  reset(): void;
  /** Resolves with a valid token, solving a challenge first when there is none. */
  execute(): Promise<string>;
  /** The current token, or `''` when there is none or it has expired. */
  getResponse(): string;
  isExpired(): boolean;
  /** Removes the widget; it is rendered again when a widget prop changes or the component remounts. */
  remove(): void;
}

interface Mounted {
  api: OwafVerifyApi;
  id: string;
}

export const Verify = forwardRef<VerifyHandle, VerifyProps>(function Verify(props, ref) {
  const {
    siteKey,
    action,
    cdata,
    theme,
    language,
    size,
    accent,
    responseFieldName,
    refreshExpired,
    scriptSrc = DEFAULT_SCRIPT_SRC,
    className,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // Latest callbacks, read when the widget calls back, so new callback
  // identities never re-render the widget.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const widget = useRef<Mounted | null>(null);
  const ready = useRef<Promise<Mounted> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    let mounted: Mounted | null = null;
    // The widget gets its own element so React never reconciles the widget DOM.
    const host = document.createElement('div');
    container.appendChild(host);
    const options: OwafVerifyRenderOptions = {
      sitekey: siteKey,
      callback: (token) => latest.current.onSuccess?.(token),
      errorCallback: (code) => latest.current.onError?.(code),
      expiredCallback: () => latest.current.onExpired?.(),
    };
    if (action !== undefined) options.action = action;
    if (cdata !== undefined) options.cdata = cdata;
    if (theme !== undefined) options.theme = theme;
    if (language !== undefined) options.language = language;
    if (size !== undefined) options.size = size;
    if (accent !== undefined) options.accent = accent;
    if (responseFieldName !== undefined) options.responseFieldName = responseFieldName;
    if (refreshExpired !== undefined) options.refreshExpired = refreshExpired;

    const promise = loadVerify(scriptSrc).then(
      (api) => {
        if (!active) throw new Error('owafVerify: component unmounted');
        mounted = { api, id: api.render(host, options) };
        widget.current = mounted;
        return mounted;
      },
      (err: unknown) => {
        if (active) latest.current.onError?.('script-load');
        throw err;
      },
    );
    promise.catch(() => {});
    ready.current = promise;

    return () => {
      active = false;
      if (mounted) mounted.api.remove(mounted.id);
      host.remove();
      if (widget.current === mounted) widget.current = null;
      if (ready.current === promise) ready.current = null;
    };
  }, [siteKey, action, cdata, theme, language, size, accent, responseFieldName, refreshExpired, scriptSrc]);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        const w = widget.current;
        if (w) w.api.reset(w.id);
      },
      execute() {
        const promise = ready.current;
        if (!promise) return Promise.reject(new Error('owafVerify: widget is not mounted'));
        return promise.then((w) => {
          if (widget.current !== w) throw new Error('owafVerify: widget was removed');
          return w.api.execute(w.id);
        });
      },
      getResponse() {
        const w = widget.current;
        return w ? w.api.getResponse(w.id) : '';
      },
      isExpired() {
        const w = widget.current;
        return w ? w.api.isExpired(w.id) : true;
      },
      remove() {
        const w = widget.current;
        if (!w) return;
        w.api.remove(w.id);
        widget.current = null;
        ready.current = null;
      },
    }),
    [],
  );

  return createElement('div', { ref: containerRef, className });
});
