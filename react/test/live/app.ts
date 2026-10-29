// Test page for the live browser test: the built package (dist), wrapped in
// StrictMode, driven by the test through window.harness.
import { StrictMode, createElement, createRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Verify } from '../../dist/index.js';
import type { VerifyHandle } from '../../dist/index.js';

export interface HarnessEvent {
  type: 'success' | 'error' | 'expired';
  value?: string;
}

export interface Harness {
  events: HarnessEvent[];
  violations: string[];
  mount(siteKey: string): void;
  unmount(): void;
  reset(): void;
  execute(): Promise<string>;
  getResponse(): string;
}

declare global {
  interface Window {
    harness: Harness;
  }
}

const events: HarnessEvent[] = [];
const violations: string[] = [];
document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`));

const root = createRoot(document.getElementById('root')!);
const ref = createRef<VerifyHandle>();

const harness: Harness = {
  events,
  violations,
  mount(siteKey) {
    flushSync(() =>
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(Verify, {
            ref,
            siteKey,
            action: 'live-test',
            className: 'verify',
            onSuccess: (value) => events.push({ type: 'success', value }),
            onError: (value) => events.push({ type: 'error', value }),
            onExpired: () => events.push({ type: 'expired' }),
          }),
        ),
      ),
    );
  },
  unmount() {
    flushSync(() => root.render(null));
  },
  reset() {
    ref.current!.reset();
  },
  execute() {
    return ref.current!.execute();
  },
  getResponse() {
    return ref.current!.getResponse();
  },
};

window.harness = harness;
