# Contributing

Thanks for helping. Issues and pull requests are welcome in English or Spanish.

## Before you start

- Security problems go to support@openwaf.dev, never to an issue ([SECURITY.md](SECURITY.md)).
- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Keep the constraints of the client: first party only, no third-party requests, no fingerprinting surfaces (canvas,
  WebGL, audio, fonts, high-entropy client hints), no cookies from the widget, no inline script or style, no `eval`,
  no `blob:` URLs, no WebAssembly, and `widget.min.js` under 8 KiB gzip (the build refuses more).

## Layout and checks

| Part | Run before a pull request |
|---|---|
| `challengejs/` | `node challengejs/build.mjs` and commit the rebuilt `*.min.*` files; `go test ./challengejs/` |
| `siteverify/` (Go) | `gofmt -l .`, `go vet ./...`, `go test -race ./...` |
| `node/` | `npm ci && npm run typecheck && npm run build && npm test` in `node/` |
| `php/` | `composer install && vendor/bin/phpunit -c php/phpunit.xml.dist` |
| `react/`, `vue/` | see each package's README |
| everything | `scripts/leak-guard.sh` |

Tests that call the live siteverify endpoint use only the public test keys; set `OPENWAF_VERIFY_LIVE=0` to skip
them offline.

## How changes ship

The libraries and components are released from this repository with semantic versions and a CHANGELOG entry.

The browser client (`challengejs/`) is also what the OpenWAF edge serves. Its source of truth lives with the edge, and
this directory is exported from there: a merged pull request here is applied there, ships with the next edge release
and comes back in the next export. The edge builds the client with its extension module (see
[spec/PROTOCOL.md §6](spec/PROTOCOL.md#6-extension-point)); a change must keep the extension point working.

## Commits

One logical change per pull request, a message that says what changes and why, and tests for behaviour you add or
fix. By contributing you agree that your contribution is licensed under the Apache License 2.0.
