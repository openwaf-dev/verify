# OpenWAF Verify protocol, version 1

This document describes what a browser and a site's server exchange with OpenWAF Verify: the widget's endpoints,
the proof of work, the interstitial page, the token and siteverify. It is the contract the code in this repository
implements. The OpenWAF edge is the reference server; it is not part of this repository.

Key words: MUST, SHOULD and MAY as in RFC 2119.

## 1. Overview

```
browser (widget.js)              OpenWAF edge, on the site's own host             site's server
  │ POST /__waf/challenge/v1/start ─────►│
  │◄──────── challenge, q, d, mode       │
  │ (solve q puzzles in a Web Worker)    │
  │ POST /__waf/challenge/v1/solve ─────►│
  │◄──────── token (v1.…)                │
  │ form submit with the token ───────────────────────────────────────────────────►│
  │                                      │◄──── POST siteverify {secret, response} │
  │                                      │────► {success, hostname, action, …} ───►│
```

Everything the browser loads or calls is **first party**: it lives under `/__waf/` on the host that serves the page.
There is no third-party script, frame, cookie or request, and the widget works under
`Content-Security-Policy: default-src 'self'` (no inline script or style, no `eval`, no `blob:` URLs, no WebAssembly).

## 2. Assets

| Path | What |
|---|---|
| `/__waf/challenge/v1/widget.js` | The widget (`challengejs/widget.src.js`). Query: `render=explicit` disables auto-rendering, `onload=<global function name>` is called when the API is ready. |
| `/__waf/challenge/v1/worker.js?v=<version>` | The proof-of-work Web Worker (`challengejs/worker.src.js`). The interstitial also loads it as a classic script. |
| `/__waf/challenge/v1/widget.css?v=<version>` | The widget's stylesheet. |
| `/__waf/challenge/v1/brand/<sha256>.svg\|.png` | A site's brand logo or icon (immutable). |

`<version>` is the first 10 hex characters of the SHA-256 of the asset's bytes. The edge serves gzip and brotli
variants of the same bytes.

## 3. Widget endpoints

All are `POST` with a JSON body (at most 8 KiB). A request with an `Origin` header whose host differs from the
request's host is refused (`403 origin`). Answers are JSON. On a host where Verify is not enabled the answer is
`404 not-found`; a method other than POST gets `405 method`; too many requests from one client get `429`.

### 3.1 `POST /__waf/challenge/v1/start`

Request:

| Field | Type | Meaning |
|---|---|---|
| `sitekey` | string | The widget's public site key (`owk_…`) or a test site key (§7). |
| `action` | string | 0–32 characters of `A-Z a-z 0-9 _ -`. Returned by siteverify. |
| `cdata` | string | Up to 255 printable ASCII characters. Returned by siteverify. |

Success (`200`):

| Field | Type | Meaning |
|---|---|---|
| `challenge` | string | The signed challenge, opaque except for §4.1. Sent back unchanged. |
| `q` | number | Number of puzzles. |
| `d` | number | Zero bits required per puzzle (1–32). |
| `exp` | number | Expiry of the challenge, Unix milliseconds. |
| `mode` | string | `managed`, `non_interactive` or `invisible`. |
| `id` | string | Support ID of the challenge (16 hex characters), shown in troubleshooting links. |
| `color` | string | The zone's accent colour (`#rrggbb`), the widget's default accent. |
| `brand` | object | Optional. The site's brand: `kind` (`client` or `org`), `name`, optional `logo` and `icon` (brand asset file names, §2), and for `org` optional `privacy` and `terms` (`https://` URLs). |
| `pat` | boolean | Optional. `true` when the client may present a Private Access Token (§3.3). |

A deployment MAY add fields for its own client extension (§6); clients MUST ignore fields they do not know.

Errors: `400 invalid-input` (bad `sitekey`, `action` or `cdata`), `400 bad-request` (malformed body),
`403 invalid-sitekey` (no such widget on this host), `403 blocked` (refused by the server's policy). Errors may
carry `brand`, so the widget can show the site's brand around the error.

### 3.2 `POST /__waf/challenge/v1/solve`

Request:

| Field | Type | Meaning |
|---|---|---|
| `challenge` | string | From `/start` (or from an interactive answer, below). |
| `solutions` | string[] | The `q` solutions, in order (§4). |
| `signals` | object | `webdriver`: the value of `navigator.webdriver === true`; `interacted`: whether a trusted pointer or key press reached the page before the solve. Yes/no only. |
| `interaction` | `false` or object | `false`, or after the verification box: `{"kind": "pointer"\|"keyboard", "ms": <milliseconds since the box was shown>}`. Only a trusted browser activation of the checkbox produces it. |
| `pt` | string | Optional. Private Access Token proof (§3.3). |

The OpenWAF edge accepts exactly these fields plus those of its own extension (§6); any other field is
`400 bad-request`.

Answers (`200` unless noted):

- `{"success": true, "token": "v1.…", "expires_in": 300, "interactive": <bool>}`.
- `{"success": false, "interactive": true, "challenge": …, "q": …, "d": …, …}`: a managed widget must show the
  verification box (a checkbox labelled «Verify you are human») and solve this new challenge, sending `interaction`.
- `{"success": false, "error": <code>}` with `invalid` (bad signature, other host or network, malformed), `expired`,
  `replayed` (already used), `solution` (wrong proof of work), `elsewhere` (could not be redeemed on this node),
  `interaction-required` (the widget's mode does not allow the verification box), `internal-error`, or `test-fail`
  (test site key). `403 blocked` when refused by the server's policy.

Whether a solve is accepted, escalated to the verification box or refused is the server's decision and is not
specified here.

### 3.3 `GET /__waf/challenge/v1/pat?c=<challenge>`

Offered only when `/start` said `pat: true`. Without an `Authorization` header the answer is `401` with a
`WWW-Authenticate: PrivateToken …` challenge (RFC 9577, token type 2); a supporting device answers it by itself.
With a valid token the answer is `{"pt": "<proof>"}`, which the client sends with the solve. The widget waits at most
2 seconds for it after the work; without support nothing changes.

## 4. Proof of work

### 4.1 Nonce

The challenge's first `.`-separated segment is base64url (no padding) of a JSON object; its `n` member is the nonce,
22 base64url characters. Nothing else in the challenge is meant for the client.

### 4.2 Puzzles

Puzzle `i` (0 ≤ i < q) is solved by a decimal string `x` (1–16 digits, no sign, no leading `+`) such that

```
SHA-256( n + "." + i + "." + x )
```

starts with at least `d` zero bits, where `i` is written in decimal and the input is ASCII. Solutions are found by
counting `x` up from `0`; any valid `x` is accepted. Every message is at most 55 bytes, so each hash is one
SHA-256 block (`challengejs/pow.js` computes only the first word).

A challenge is single use, bound to the host, to the client's network (IPv4 /24 or IPv6 /64) and expires at `exp`.

## 5. Interstitial page

When a site requires a check before a navigation (the browser challenge, or the site is under attack), the edge
answers the HTML request with the interstitial page (`challengejs/interstitial.html`, styled by
`interstitial.css`). The page loads `worker.js` as a classic script, solves the embedded challenge (§4) and posts:

```
POST /__waf/verify
{"challenge": "…", "solutions": ["…"], "interaction": {…}, "pt": "…"}
```

(`interaction` only when the page showed the verification box, `pt` as in §3.3, plus extension fields, §6.)
Answers: `{"ok": true}` with the pass cookie `__waf_pass` (then the page reloads); `{"ok": false, "interactive": true,
"challenge": …, "id": …, "page": "<html>"}` when the server wants the verification box for this navigation: the page replaces itself with
`page`, the same interstitial with a new challenge and the box; or `{"ok": false, "error": <code>}` with
`bad-request`, `invalid`, `expired`, `replayed`, `solution`, `elsewhere` or `interaction-required`; `403` when refused
by the server's policy. The page works without third-party resources, announces each state in a polite live region,
respects reduced motion, and explains in `<noscript>` that JavaScript is needed.

## 6. Extension point

The client code in this repository is complete and works on its own. A deployment MAY build the widget and the
worker with an extension module (`challengejs/ext.js` documents its shape; `node challengejs/build.mjs --ext <file>`)
and fill the interstitial's empty `ext-*` template blocks, to add fields to the solve and verify bodies.

The OpenWAF service does this: the widget and page it serves are this code plus one closed extension module of
in-page yes/no checks about the browser's own consistency. It reads no canvas, WebGL, audio, fonts or high-entropy
client hints, sets no cookie, makes no request, and adds a single integer field to the solve body. Because of that
module the bundle the edge serves is not byte-identical to a build of this repository; every request it makes and
every field it sends are visible in the browser's developer tools.

## 7. Test keys

They work on every host with OpenWAF Verify and on both siteverify endpoints, never spend a counter and never
produce a real token.

| Key | Behaviour |
|---|---|
| `owk_test_pass` | Site key: always succeeds with the token `v1.TEST.TOKEN`. |
| `owk_test_fail` | Site key: always fails with the error `test-fail`. |
| `owk_test_interactive` | Site key: always shows the verification box, then gives `v1.TEST.TOKEN`. |
| `ows_test_pass` | Secret: any non-empty response succeeds, with `metadata.result_with_testing_key: true` (and `hostname` `example.com`, no `action`). |
| `ows_test_fail` | Secret: always `invalid-input-response`. |
| `ows_test_spent` | Secret: always `timeout-or-duplicate`. |

## 8. Token

```
"v1." + base64url(JSON) + "." + base64url(HMAC-SHA256(key, "v1." + base64url(JSON)))
```

At most 2048 bytes, valid for 300 seconds, single use, bound to the client's network, the host, the action and the
cdata. The key is derived from a per-zone secret that never leaves OpenWAF. **Integrators MUST treat the token as
opaque** and verify it only with siteverify: its payload is not a stable interface.

## 9. Siteverify

The site's server (never the browser) checks a token at either endpoint; the answers are the same and a token spent
at one is spent at both:

- `POST https://dash.openwaf.dev/v1/challenge/siteverify` (control plane);
- `POST https://<the site's host>/__waf/challenge/siteverify` (through the edge).

Request body `application/x-www-form-urlencoded` or `application/json`, at most 8 KiB:

| Field | Required | Meaning |
|---|---|---|
| `secret` | yes | The widget's secret: `ows_` + 43 base64url characters, or a test secret (§7). |
| `response` | yes | The token. |
| `remoteip` | no | The visitor's IP address; when given it must be in the token's network. |
| `idempotency_key` | no | Up to 128 characters. The same key with the same secret and response within 300 s returns the first answer without spending the token again: retry a timed-out call with the same key. |

Answer (`200` for every decision):

```json
{"success": true, "challenge_ts": "2026-10-28T10:15:03Z", "hostname": "example.com", "action": "signup",
 "cdata": "…", "error-codes": [], "metadata": {"mode": "managed", "interactive": false, "risk": "low"}}
```

`challenge_ts` (RFC 3339, UTC), `hostname`, `action` and `cdata` are present on success (`action` and `cdata` only
when not empty). `error-codes` is always present. `metadata` has `mode`, `interactive`, `risk` (`low` or `high`) and,
for test secrets, `result_with_testing_key: true`. It never contains the client's signals.

Error codes (aligned with Cloudflare Turnstile's): `missing-input-secret`, `invalid-input-secret`,
`missing-input-response`, `invalid-input-response`, `timeout-or-duplicate` (expired or already used),
`remoteip-mismatch`, `bad-request` (`400` malformed body, `405` other method), `rate-limited` (`429`, with
`Retry-After` in seconds) and `internal-error`. The token is checked before the secret: an unknown secret of the right
format with an unreadable token answers `invalid-input-response`.

A server SHOULD check `success`, then that `hostname` and `action` are the expected ones. The libraries in this
repository add the client-side codes `hostname-mismatch` and `action-mismatch` for that.
