# siteverify for Go

Server-side client for [OpenWAF Verify](https://developers.openwaf.dev/waf/verify-widget/): checks the token the widget puts in your form with the [siteverify](https://developers.openwaf.dev/waf/siteverify/) endpoint before your server accepts the form.

- Standard library only, no dependencies. Go 1.24 or later.
- Form-encoded requests, a 10-second default timeout, no automatic retries, no redirects.
- Typed answers and typed transport errors (`errors.Is`).
- The secret never appears in errors or in the `fmt` output of a client.

```sh
go get github.com/openwaf-dev/verify/siteverify@v0.1.0
```

## Quick start

```go
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/openwaf-dev/verify/siteverify"
)

func main() {
	client, err := siteverify.New(os.Getenv("OWAF_VERIFY_SECRET"))
	if err != nil {
		log.Fatal(err) // empty secret or invalid option
	}

	http.HandleFunc("POST /signup", func(w http.ResponseWriter, r *http.Request) {
		res, err := client.Verify(r.Context(), r.PostFormValue(siteverify.ResponseFieldName), siteverify.Params{
			IdempotencyKey:   siteverify.NewIdempotencyKey(),
			ExpectedHostname: "example.com",
			ExpectedAction:   "signup",
		})
		if err != nil {
			// siteverify could not be reached or answered something unexpected.
			http.Error(w, "verification unavailable", http.StatusServiceUnavailable)
			return
		}
		if !res.Success {
			// res.ErrorCodes says why.
			http.Error(w, "verification failed", http.StatusForbidden)
			return
		}
		// Create the account.
	})
	log.Fatal(http.ListenAndServe("127.0.0.1:8080", nil))
}
```

On the page, the widget is a container with your site key; the script is served by the OpenWAF edge on your own host:

```html
<script src="/__waf/challenge/v1/widget.js" async defer></script>
<form action="/signup" method="post">
  <div class="owaf-verify" data-sitekey="owk_YOUR_SITE_KEY" data-action="signup"></div>
  <button type="submit">Sign up</button>
</form>
```

A complete `net/http` server is in [`examples/go-nethttp`](../examples/go-nethttp/).

## API

### `New(secret string, opts ...Option) (*Client, error)`

Creates a client for one widget secret (`ows_…`). An empty secret, an invalid endpoint, a nil HTTP client or a negative timeout return an error matching `ErrInvalidConfig`. A `Client` is safe for concurrent use: create one and reuse it.

| Option | Default | Meaning |
|---|---|---|
| `WithEndpoint(url)` | `DefaultEndpoint` (`https://dash.openwaf.dev/v1/challenge/siteverify`) | Use `siteverify.EdgeEndpoint("www.example.com")` to verify through the OpenWAF edge on one of your proxied names (`https://www.example.com/__waf/challenge/siteverify`). |
| `WithTimeout(d)` | `DefaultTimeout` (10 s) | Limit for the whole call (connection, request, answer). `0` disables it, leaving only the context's deadline. |
| `WithHTTPClient(hc)` | a client on `http.DefaultTransport` that does not follow redirects | Your own `*http.Client` (proxy, transport, instrumentation). |

Requests carry `User-Agent: openwaf-verify-go/<version>`.

### `(*Client).Verify(ctx, token string, p Params) (*Response, error)`

Posts `secret`, `response` and, when given, `remoteip` and `idempotency_key` as `application/x-www-form-urlencoded`.

| `Params` field | Meaning |
|---|---|
| `RemoteIP` | The visitor's IP address; it must be in the IPv4 /24 or IPv6 /64 that solved the challenge. Behind the OpenWAF edge, `r.RemoteAddr` is the edge's address: take the visitor's from a header you trust, or leave it empty. |
| `IdempotencyKey` | Up to 128 characters. Makes retries safe (see below). |
| `ExpectedHostname` | When set, a success for another hostname (compared case-insensitively) becomes a failure with `hostname-mismatch`. |
| `ExpectedAction` | When set, a success for another action becomes a failure with `action-mismatch`. |

Without calling the service, an empty token answers `missing-input-response` and a token longer than 2048 bytes answers `invalid-input-response` (`Response.StatusCode` is then `0`).

`Response`:

| Field | Meaning |
|---|---|
| `Success` | `true` only for a valid, unspent token of this widget that matches `ExpectedHostname` and `ExpectedAction`. Only an HTTP 200 answer can succeed. |
| `ChallengeTS` | When the token was issued. |
| `Hostname`, `Action`, `CData` | The host name the widget was rendered on, its `data-action` and its `data-cdata`. |
| `ErrorCodes` | Empty on success; see the codes below. `HasErrorCode(code)` checks for one. |
| `Metadata` | `Mode` (`managed`, `non_interactive`, `invisible`), `Interactive`, `Risk` (`low`, `high`), `ResultWithTestingKey`. |
| `StatusCode` | `200`, `400`, `405` or `429`; `0` for a local failure. |
| `RetryAfter` | From the `Retry-After` header of a `429` answer. |

### `NewIdempotencyKey() string`

Returns a random UUID v4 to use as `Params.IdempotencyKey`.

## Errors

`Verify` returns a `*Response` and a nil error for every answer of the service, including failed checks (HTTP 200), malformed requests (400), wrong methods (405) and rate limits (429). Accept the form only when `Response.Success` is `true`.

| Code in `ErrorCodes` | Meaning |
|---|---|
| `missing-input-secret` | The secret is empty. |
| `invalid-input-secret` | The secret is malformed or is not a current secret of the widget that issued the token. |
| `missing-input-response` | The token is empty. |
| `invalid-input-response` | The token is malformed, has a bad signature, belongs to an unknown widget or is longer than 2048 bytes. |
| `timeout-or-duplicate` | The token expired (300 seconds) or was already spent. |
| `remoteip-mismatch` | `RemoteIP` is not in the network the token is bound to. |
| `bad-request` | The request was malformed (for example an idempotency key longer than 128 characters). |
| `rate-limited` | Too many calls; wait for `RetryAfter`. |
| `internal-error` | Single use could not be checked right now; the token was not spent. Retry. |
| `hostname-mismatch` | **Added by this library**: the service accepted the token, but for another hostname than `ExpectedHostname`. |
| `action-mismatch` | **Added by this library**: the service accepted the token, but for another action than `ExpectedAction`. |

The constants are `siteverify.CodeMissingInputSecret` … `siteverify.CodeActionMismatch`.

A non-nil error means no answer was received: the token is not verified. It is a `*siteverify.Error` whose `Code` is the same as in the Node and PHP clients, and it matches one sentinel with `errors.Is`:

| Sentinel | `Code` | When |
|---|---|---|
| `ErrTimeout` | `timeout` | The call exceeded the client timeout or the context's deadline. |
| `ErrNetwork` | `network` | DNS, connection, TLS or read failure, or a cancelled context (`errors.Is(err, context.Canceled)`). |
| `ErrHTTP` | `http` | An HTTP status other than 200, 400, 405 and 429 (for example a 5xx from a proxy, or a redirect). `Error.StatusCode` has it. |
| `ErrBadResponse` | `bad-response` | A 200, 400, 405 or 429 whose body is not a siteverify answer (not JSON, no `error-codes`, too large). |

### Retries and idempotency

The client never retries on its own. A token is spent by the first successful call, so a plain retry after a timeout would get `timeout-or-duplicate`. Generate one idempotency key per token and reuse it for every retry, against the same endpoint: within 300 seconds, the service answers a call with the same secret, token and key with the first answer, without spending anything.

```go
p := siteverify.Params{IdempotencyKey: siteverify.NewIdempotencyKey()}
res, err := client.Verify(ctx, token, p)
if errors.Is(err, siteverify.ErrTimeout) || errors.Is(err, siteverify.ErrNetwork) {
	res, err = client.Verify(ctx, token, p)
}
```

Retry `internal-error` answers the same way; for `rate-limited`, wait `RetryAfter` first.

## Test keys

These keys work on every host with OpenWAF Verify and on both siteverify endpoints. They never spend anything and never produce a real token.

| Constant | Key | Behaviour |
|---|---|---|
| `TestSitekeyPass` | `owk_test_pass` | The widget always succeeds with `TestToken` (`v1.TEST.TOKEN`). |
| `TestSitekeyFail` | `owk_test_fail` | The widget always fails with the error `test-fail`. |
| `TestSitekeyInteractive` | `owk_test_interactive` | The widget always shows the «Verify you are human» checkbox, then gives `TestToken`. |
| `TestSecretPass` | `ows_test_pass` | Any non-empty token succeeds, with `Metadata.ResultWithTestingKey` set and the hostname `example.com`. Its answers carry no action, so `ExpectedAction` fails with it. |
| `TestSecretFail` | `ows_test_fail` | Always `invalid-input-response`. |
| `TestSecretSpent` | `ows_test_spent` | Always `timeout-or-duplicate`. |

## Tests

```sh
go test -race -count=1 ./siteverify/...
```

The unit tests run against a local mock server. The live tests (`TestLive*`) call `https://dash.openwaf.dev/v1/challenge/siteverify` with the test secrets; set `OPENWAF_VERIFY_LIVE=0` to skip them.

## Licence

Apache-2.0. See [LICENSE](../LICENSE).
