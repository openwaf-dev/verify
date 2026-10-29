# openwaf/verify (PHP)

Server-side client for the **OpenWAF Verify** siteverify API. OpenWAF Verify is a
first-party proof-of-work challenge widget (a Turnstile-style CAPTCHA alternative):
the browser widget produces a token, and your backend checks that token with
siteverify before accepting the form.

- PHP 8.1 or newer, `ext-json`. No runtime dependencies.
- Uses `ext-curl` when it is loaded, otherwise PHP streams (needs `allow_url_fopen`
  and `ext-openssl` for https). TLS certificates are always verified.
- Licence: Apache-2.0.

## Install

From the GitHub repository as a Composer VCS repository (the Packagist package is coming soon):

```sh
composer config repositories.openwaf-verify vcs https://github.com/openwaf-dev/verify
composer require openwaf/verify:^0.1
```

## Quick start

```php
use OpenWAF\Verify\Siteverify\Client;
use OpenWAF\Verify\Siteverify\SiteverifyException;

$client = new Client(getenv('OPENWAF_VERIFY_SECRET'));

try {
    $result = $client->verify(
        $_POST['owaf-verify-response'] ?? '',
        remoteIp: $_SERVER['REMOTE_ADDR'] ?? null,
        expectedHostname: 'www.example.com',
        expectedAction: 'signup',
    );
} catch (SiteverifyException $e) {
    // siteverify could not be reached: fail closed or retry (see below)
    http_response_code(503);
    exit;
}

if (!$result->success) {
    http_response_code(400);
    exit('Verification failed: ' . implode(', ', $result->errorCodes));
}
```

A complete form handler lives in [`examples/php`](../examples/php).

## API

### `new Client(string $secret, string $endpoint = Client::DEFAULT_ENDPOINT, float $timeout = 10.0, ?Transport $transport = null, ?string $userAgent = null)`

| Argument | Description |
| --- | --- |
| `secret` | Your siteverify secret (`ows_…`). An empty secret throws `InvalidArgumentException`. |
| `endpoint` | Default `https://dash.openwaf.dev/v1/challenge/siteverify`. You can also call it through the edge on your own host: `https://www.example.com/__waf/challenge/siteverify`. |
| `timeout` | Seconds for the whole request. |
| `transport` | Any `OpenWAF\Verify\Siteverify\Transport`. Defaults to `CurlTransport` when `ext-curl` is loaded, else `StreamTransport`. Implement the interface to plug in your own HTTP stack. |
| `userAgent` | Default `openwaf-verify-php/<version>`. |

The secret is never exposed: `var_dump`/`print_r` show `[redacted]`, the client
refuses to be serialized, exception messages never include it, and on PHP 8.2+
it is marked `#[\SensitiveParameter]` so it is hidden from stack traces.

### `Client::verify(string $token, ?string $remoteIp = null, ?string $idempotencyKey = null, ?string $expectedHostname = null, ?string $expectedAction = null): Response`

Sends `secret`, `response`, and the optional `remoteip` and `idempotency_key` as
`application/x-www-form-urlencoded`. Answers without a request when:

- the token is empty → `missing-input-response`;
- the token is longer than 2048 bytes → `invalid-input-response`.

When the server accepts the token but `expectedHostname` (case-insensitive) or
`expectedAction` does not match, the result has `success === false` and the
library-side code `hostname-mismatch` or `action-mismatch` appended.

An idempotency key outside 1–128 characters throws `InvalidArgumentException`.

### `Client::idempotencyKey(): string`

Returns a random UUID v4 to use as an idempotency key.

### `Response`

Readonly properties:

| Property | Type | Description |
| --- | --- | --- |
| `success` | `bool` | The token is valid (and matches your expectations). |
| `errorCodes` | `list<string>` | Empty on success. |
| `challengeTs` | `?string` | RFC 3339 time the challenge was solved. |
| `hostname` | `?string` | Host the widget ran on. |
| `action` | `?string` | Action set on the widget. |
| `cdata` | `?string` | Custom data set on the widget (null when empty). |
| `mode` | `?string` | Widget mode, e.g. `managed`. |
| `interactive` | `?bool` | The visitor had to interact. |
| `risk` | `?string` | `low` or `high`. |
| `resultWithTestingKey` | `?bool` | `true` for test secrets. |
| `httpStatus` | `?int` | HTTP status, null for local answers. |
| `retryAfter` | `?int` | Seconds from `Retry-After` on `rate-limited` (HTTP 429). |
| `raw` | `array` | Decoded JSON body. |

`hasError(string $code): bool` checks for one code.

## Errors

Every decision is a `Response`, including HTTP 400/405 (`bad-request`) and
HTTP 429 (`rate-limited`, with `retryAfter`). Error codes:

| Code | Meaning |
| --- | --- |
| `missing-input-secret` | No secret sent. |
| `invalid-input-secret` | Unknown or malformed secret. |
| `missing-input-response` | No token sent (also returned locally for an empty token). |
| `invalid-input-response` | Invalid, expired or malformed token (also returned locally for a token over 2048 bytes). |
| `timeout-or-duplicate` | Token already spent or older than 300 s. |
| `remoteip-mismatch` | `remoteip` differs from the solver's address. |
| `bad-request` | Malformed request. |
| `rate-limited` | Too many requests; wait `retryAfter` seconds. |
| `internal-error` | Server-side failure; retry. |
| `hostname-mismatch` | Library-side: `expectedHostname` did not match. |
| `action-mismatch` | Library-side: `expectedAction` did not match. |

Transport failures throw `OpenWAF\Verify\Siteverify\SiteverifyException`, whose
`errorCode` is one of:

| `errorCode` | Meaning |
| --- | --- |
| `timeout` | No answer within `timeout`. |
| `network` | DNS, connection or TLS failure. |
| `http` | Unexpected HTTP status (e.g. 5xx) without a siteverify body; see `httpStatus`. |
| `bad-response` | The body is not a siteverify JSON object. |

### Retries

Nothing is retried automatically. Tokens are single use, so a retry after a
timeout must reuse the same idempotency key: within 300 s the server returns
the first answer for the same secret, token and key without spending the token
again.

```php
$key = Client::idempotencyKey();
for ($attempt = 1; ; $attempt++) {
    try {
        $result = $client->verify($token, idempotencyKey: $key);
        break;
    } catch (SiteverifyException $e) {
        if ($attempt === 3 || $e->errorCode === SiteverifyException::BAD_RESPONSE) {
            throw $e;
        }
        usleep(200_000 * $attempt);
    }
}
```

## Test keys

Test keys work on every host and never spend anything. Constants live in
`OpenWAF\Verify\TestKeys`.

| Sitekey | Widget behaviour |
| --- | --- |
| `owk_test_pass` | Passes, token `v1.TEST.TOKEN`. |
| `owk_test_fail` | Fails with widget error `test-fail`. |
| `owk_test_interactive` | Shows a checkbox, then `v1.TEST.TOKEN`. |

| Secret | siteverify answer |
| --- | --- |
| `ows_test_pass` | Any non-empty token succeeds; `hostname` `example.com`, `resultWithTestingKey` `true`. |
| `ows_test_fail` | `invalid-input-response`. |
| `ows_test_spent` | `timeout-or-duplicate`. |

## Development

From the repository root:

```sh
composer install
vendor/bin/phpunit -c php/phpunit.xml.dist
```

The unit suite runs both transports against a local `php -S` mock server. The
live suite calls `https://dash.openwaf.dev` with the public test secrets only;
skip it with `OPENWAF_VERIFY_LIVE=0`.
