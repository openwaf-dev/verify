# @openwaf/verify-react

React component for [OpenWAF Verify](https://developers.openwaf.dev/), the first-party proof-of-work challenge widget (a CAPTCHA and Turnstile alternative). It loads the widget script once, renders the widget into its own element and gives you the token through a callback, a hidden form field and an imperative `ref`.

- React 18 and 19, StrictMode-safe, SSR-safe (Next.js, Remix, Vite SSR).
- Zero runtime dependencies, ESM with TypeScript types.
- The widget script is served by the OpenWAF edge **on your own host** (`/__waf/challenge/v1/widget.js`); no third-party origin is involved.

## Install

From the tarball attached to the GitHub release (the npm registry package is coming soon):

```sh
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-react-0.1.0.tgz
```

You import it as `@openwaf/verify-react`. Each release lists the tarballs' SHA-256 in `SHA256SUMS`.

Your site must be served through OpenWAF with Verify enabled, so that `/__waf/challenge/v1/widget.js` exists on your host. Create a widget (sitekey `owk_…` and secret `ows_…`) in the OpenWAF dashboard or use the [test keys](#test-keys).

## Quick start

```tsx
import { useState } from 'react';
import { Verify } from '@openwaf/verify-react';

export function SignupForm() {
  const [token, setToken] = useState('');
  return (
    <form method="post" action="/signup">
      <input type="email" name="email" required />
      <Verify siteKey="owk_…" action="signup" onSuccess={setToken} onExpired={() => setToken('')} />
      <button disabled={!token}>Create account</button>
    </form>
  );
}
```

The widget solves the challenge in the background (or asks for a click when needed), calls `onSuccess(token)` and writes the token into a hidden input named `owaf-verify-response` inside the form. **Always check the token on your server** with siteverify before trusting the request (see [Server-side check](#server-side-check)).

## Props

| Prop | Type | Default | |
|---|---|---|---|
| `siteKey` | `string` | required | Public sitekey (`owk_…`). |
| `action` | `string` | | Label echoed back by siteverify (`login`, `signup`…). |
| `cdata` | `string` | | Customer data echoed back by siteverify. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `auto` | `auto` follows `prefers-color-scheme`. |
| `language` | `'auto' \| 'en' \| 'es'` | `auto` | `auto` follows the browser language. |
| `size` | `'normal' \| 'compact'` | `normal` | |
| `accent` | `string` | | Accent colour, `#rgb` or `#rrggbb`. |
| `responseFieldName` | `string` | `owaf-verify-response` | Name of the hidden input with the token. |
| `refreshExpired` | `'auto' \| 'manual'` | `auto` | `auto` renews the token before it expires; `manual` shows a retry button once it has expired. |
| `onSuccess` | `(token: string) => void` | | Called on each solve, also after a refresh or `reset()`. |
| `onError` | `(code: string) => void` | | Widget error code (for example `test-fail`, `network`, `rate-limited`), or `script-load` when the widget script cannot be loaded. |
| `onExpired` | `() => void` | | The token expired without being refreshed. |
| `scriptSrc` | `string` | `/__waf/challenge/v1/widget.js` | Widget script URL. Keep it same-origin. |
| `className` | `string` | | Class of the container `<div>`. |

Changing `siteKey`, `action`, `cdata`, `theme`, `language`, `size`, `accent`, `responseFieldName`, `refreshExpired` or `scriptSrc` removes the widget and renders a new one. Callback props can change identity on every render: the widget always calls the latest ones and is not re-rendered.

## Ref

```tsx
import { useRef } from 'react';
import { Verify, type VerifyHandle } from '@openwaf/verify-react';

const verify = useRef<VerifyHandle>(null);
<Verify ref={verify} siteKey="owk_…" />;

const token = await verify.current!.execute();
```

| Method | |
|---|---|
| `execute(): Promise<string>` | Resolves with a valid token, solving a challenge first when there is none. Waits for the script if it is still loading; rejects if the widget fails. |
| `reset(): void` | Discards the token and solves a new challenge. Call it after each submit: tokens are single use. |
| `getResponse(): string` | Current token, or `''` when there is none or it has expired. |
| `isExpired(): boolean` | `true` when there is no valid token. |
| `remove(): void` | Removes the widget. It comes back when a widget prop changes or the component remounts. |

## Server-side check

Tokens start with `v1.`, are valid for 300 seconds and can be checked **once**. Post the token with your secret to siteverify from your backend and accept the request only when `success` is `true` (and, if you set them, `hostname` and `action` are the expected ones):

```sh
curl -X POST https://dash.openwaf.dev/v1/challenge/siteverify \
  -d secret=ows_… -d response=v1.…
```

The server libraries in [this repository](https://github.com/openwaf-dev/verify) do it for you, including timeouts and the hostname and action checks: [`@openwaf/verify`](https://github.com/openwaf-dev/verify/tree/main/node) for Node.js, [`siteverify`](https://github.com/openwaf-dev/verify/tree/main/siteverify) for Go and [`openwaf/verify`](https://github.com/openwaf-dev/verify/tree/main/php) for PHP.

## Test keys

Test keys work on every host with Verify and never spend anything.

| Sitekey | Widget behaviour |
|---|---|
| `owk_test_pass` | Solves with the token `v1.TEST.TOKEN`. |
| `owk_test_fail` | Fails with the error `test-fail`. |
| `owk_test_interactive` | Shows a checkbox, then solves with `v1.TEST.TOKEN`. |

| Secret | siteverify answer |
|---|---|
| `ows_test_pass` | Success for any non-empty token (`metadata.result_with_testing_key: true`). |
| `ows_test_fail` | `invalid-input-response`. |
| `ows_test_spent` | `timeout-or-duplicate`. |

## Next.js and other SSR frameworks

The package entry starts with `'use client'`, so the App Router treats it as a client component. Because you pass callbacks to it, render `<Verify>` from a component of your own that also starts with `'use client'`:

```tsx
'use client';
import { Verify } from '@openwaf/verify-react';

export function SignupCaptcha() {
  return <Verify siteKey={process.env.NEXT_PUBLIC_OPENWAF_SITEKEY!} action="signup" onSuccess={(t) => console.log(t)} />;
}
```

On the server the component renders an empty `<div>` and never touches `window` or `document`; the script is loaded and the widget rendered after hydration. No `dynamic(…, { ssr: false })` is needed.

## Content Security Policy

The widget script, its worker, its stylesheet and its API calls are all served from your own origin under `/__waf/challenge/`, so a strict policy such as `default-src 'self'` is enough; no third-party host, `unsafe-inline` or `unsafe-eval` is required. This package's live browser test renders the real widget under `Content-Security-Policy: default-src 'self'` with no violations. With a nonce-based policy (`script-src 'nonce-…' 'strict-dynamic'`), the script this package injects is trusted through `'strict-dynamic'`; keep `'self'` in `default-src` (or set `worker-src`, `style-src` and `connect-src` to `'self'`) for the worker, stylesheet and API calls.

## Script loading

The first `<Verify>` adds one `<script src="/__waf/challenge/v1/widget.js?render=explicit&onload=…">` to `<head>`; every other instance, including widgets mounted at the same time, reuses it. If `window.owafVerify` already exists, or a widget script is already in the page, it is reused. If the script fails to load, mounted widgets get `onError('script-load')` and the next mount tries again. `loadVerify(src?)` is exported if you want to preload the script.

Under `<StrictMode>` the double mount in development renders a single widget, and unmounting always calls `owafVerify.remove(id)` and removes the widget's element.

## Development

```sh
npm ci
npm test                         # unit tests (Vitest + jsdom)
npx playwright install chromium
npm run test:live                # builds dist/, runs the real widget from the OpenWAF edge in Chromium
```

The live test serves its page as an unused path of `https://developers.openwaf.dev` inside Playwright (no real page is requested; only `/__waf/challenge/*` reaches the network) and uses test keys only. Set `OPENWAF_VERIFY_LIVE=0` to skip it.

## License

[Apache-2.0](https://github.com/openwaf-dev/verify/blob/main/LICENSE)
