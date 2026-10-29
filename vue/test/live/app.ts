// Test page for the live browser test: the built package (dist), driven by
// the test through window.harness.
import { createApp, h, nextTick, ref } from 'vue';
import { Verify } from '../../dist/index.js';
import type { VerifyExposed } from '../../dist/index.js';

export interface HarnessEvent {
  type: 'success' | 'error' | 'expired';
  value?: string;
}

export interface Harness {
  events: HarnessEvent[];
  violations: string[];
  mount(siteKey: string): Promise<void>;
  unmount(): Promise<void>;
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

const siteKey = ref<string | null>(null);
const handle = ref<VerifyExposed | null>(null);

createApp({
  render: () =>
    siteKey.value === null
      ? null
      : h(Verify, {
          ref: handle,
          siteKey: siteKey.value,
          action: 'live-test',
          class: 'verify',
          onSuccess: (value: string) => events.push({ type: 'success', value }),
          onError: (value: string) => events.push({ type: 'error', value }),
          onExpired: () => events.push({ type: 'expired' }),
        }),
}).mount('#root');

window.harness = {
  events,
  violations,
  async mount(key) {
    siteKey.value = key;
    await nextTick();
  },
  async unmount() {
    siteKey.value = null;
    await nextTick();
  },
  reset() {
    handle.value!.reset();
  },
  execute() {
    return handle.value!.execute();
  },
  getResponse() {
    return handle.value!.getResponse();
  },
};
