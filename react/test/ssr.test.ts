// @vitest-environment node
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Verify } from '../src/index.js';

it('renders on the server without touching window or document', () => {
  expect(typeof window).toBe('undefined');
  const html = renderToString(createElement(Verify, { siteKey: 'owk_test_pass', className: 'verify-box' }));
  expect(html).toBe('<div class="verify-box"></div>');
});
