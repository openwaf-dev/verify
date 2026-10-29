# @openwaf/verify

Server-side client for **OpenWAF Verify** siteverify: checks the token produced by the OpenWAF Verify widget on your forms. TypeScript, ESM, type declarations included, zero runtime dependencies, Node.js 18 or later (uses the global `fetch`).

## Install

From the tarball attached to the GitHub release (the npm registry package is coming soon):

```sh
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-0.1.0.tgz
```

You import it as `@openwaf/verify`. Each release lists the tarballs' SHA-256 in `SHA256SUMS`.

## Quick start

```ts
import { SiteverifyClient } from "@openwaf/verify";

const verify = new SiteverifyClient({ secret: process.env.OPENWAF_VERIFY_SECRET! });

// token: the form field `owaf-verify-response` posted by the widget
const result = await verify.verify(token, {
  remoteIp: visitorIp,            // optional
  expectedHostname: "example.com", // optional, checked locally
  expectedAction: "login",         // optional, checked locally
});

if (!result.success) {
  // result.errorCodes, e.g. ["timeout-or-duplicate"]
  return reject();
}
```

Keep the secret on the server (environment variable or secret store); never ship it to the browser.

## API

### `new SiteverifyClient(options)`

| Option | Default | |
| --- | --- | --- |
| `secret` | (required) | Secret key `ows_…`. Empty throws `SiteverifyError` with code `config`. |
| `endpoint` | `https://dash.openwaf.dev/v1/challenge/siteverify` | Or your own host through the edge: `https://<host>/__waf/challenge/siteverify`. |
| `timeoutMs` | `10000` | Whole-request timeout. |
| `fetch` | global `fetch` | Inject your own implementation (proxies, tests). |
| `userAgent` | `openwaf-verify-node/<version>` | |

The secret is kept in a private field: it never appears in `util.inspect`, `JSON.stringify`, `String()` or error messages.

### `client.verify(token, options?) → Promise<SiteverifyResponse>`

Options: `remoteIp`, `idempotencyKey` (≤ 128 chars), `expectedHostname`, `expectedAction`, `signal` (an extra `AbortSignal`).

Checked locally, with no request: an empty token gives `missing-input-response`; a token longer than 2048 bytes gives `invalid-input-response`.

```ts
interface SiteverifyResponse {
  success: boolean;
  challengeTs?: string;   // RFC 3339
  hostname?: string;
  action?: string;
  cdata?: string;
  errorCodes: string[];
  metadata?: { mode?: string; interactive?: boolean; risk?: "low" | "high"; resultWithTestingKey?: boolean };
  retryAfter?: number;    // seconds, on HTTP 429
  status: number;         // HTTP status; 0 when answered locally
  raw?: unknown;          // JSON body as received
}
```

Every decision is returned as a response, including HTTP 400/405 (`bad-request`) and 429 (`rate-limited`, with `retryAfter`).

### `newIdempotencyKey()`

Returns a random UUID v4 to use as `idempotencyKey`.

### Constants

`TEST_SECRETS`, `TEST_SITEKEYS`, `TEST_TOKEN`, `DEFAULT_ENDPOINT`, `VERSION`.

## Error codes

Server codes: `missing-input-secret`, `invalid-input-secret`, `missing-input-response`, `invalid-input-response`, `timeout-or-duplicate` (tokens are single use and valid 300 s), `remoteip-mismatch`, `bad-request`, `rate-limited`, `internal-error`.

Library codes (added locally when the server said success): `hostname-mismatch`, `action-mismatch`. The response then has `success: false`.

## Transport errors

Failures where no decision was received reject with `SiteverifyError`:

| `code` | When |
| --- | --- |
| `timeout` | No answer within `timeoutMs`. |
| `network` | DNS, connection or TLS failure. |
| `http` | Unexpected HTTP status (e.g. 5xx); `error.status` is set. |
| `bad-response` | Body is not a siteverify JSON answer. |
| `config` | Invalid constructor options. |

## Retries

There are no automatic retries. A token can be spent only once, so to retry safely after a timeout or network error, reuse the **same** idempotency key: within 300 s the server returns the first answer without spending the token again.

```ts
import { SiteverifyClient, SiteverifyError, newIdempotencyKey } from "@openwaf/verify";

const key = newIdempotencyKey();
let result;
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    result = await client.verify(token, { idempotencyKey: key });
    break;
  } catch (err) {
    if (!(err instanceof SiteverifyError) || attempt === 2) throw err;
  }
}
```

## Test keys

Test keys work on every host and never spend anything.

| Sitekey (widget) | Behaviour |
| --- | --- |
| `owk_test_pass` | Passes, token `v1.TEST.TOKEN` |
| `owk_test_fail` | Widget error `test-fail` |
| `owk_test_interactive` | Checkbox, then `v1.TEST.TOKEN` |

| Secret (server) | Result |
| --- | --- |
| `ows_test_pass` | Success for any non-empty token; `hostname` `example.com`, `metadata.resultWithTestingKey: true` |
| `ows_test_fail` | `invalid-input-response` |
| `ows_test_spent` | `timeout-or-duplicate` |

## Development

```sh
npm ci
npm run typecheck
npm run build
npm test          # includes live tests with test secrets; OPENWAF_VERIFY_LIVE=0 skips them
```

## License

Apache-2.0. See [LICENSE](../LICENSE) at the repository root.
