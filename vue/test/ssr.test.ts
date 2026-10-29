// @vitest-environment node
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { expect, it } from 'vitest';
import { Verify } from '../src/index.js';

it('renders on the server without touching window or document', async () => {
  expect(typeof window).toBe('undefined');
  const app = createSSRApp({ render: () => h(Verify, { siteKey: 'owk_test_pass', class: 'verify-box' }) });
  expect(await renderToString(app)).toBe('<div class="verify-box"></div>');
});
