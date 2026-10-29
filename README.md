# OpenWAF Verify — client

[Español](README.es.md)

OpenWAF Verify is a proof-of-work check for forms and API calls, served first party by the
[OpenWAF](https://openwaf.dev) edge on your own host: no third-party script, frame or cookie, and it works under
`Content-Security-Policy: default-src 'self'`. This repository holds everything that runs outside OpenWAF's servers:

| Path | What |
|---|---|
| [`challengejs/`](challengejs/) | The browser widget, the proof-of-work Web Worker, the interstitial page template and their CSS, as the edge serves them under `/__waf/challenge/v1/`. |
| [`spec/PROTOCOL.md`](spec/PROTOCOL.md) | The protocol: endpoints, proof of work, interstitial, token, siteverify, error codes and test keys. |
| [`siteverify/`](siteverify/) | Go siteverify client (`github.com/openwaf-dev/verify/siteverify`). |
| [`node/`](node/) | Node.js / TypeScript siteverify client (`@openwaf/verify`). |
| [`php/`](php/) | PHP siteverify client (`openwaf/verify`). |
| [`react/`](react/) | React component (`@openwaf/verify-react`). |
| [`vue/`](vue/) | Vue 3 component (`@openwaf/verify-vue`). |
| [`examples/`](examples/) | Small working examples for each of them. |

Product documentation: [developers.openwaf.dev/waf/verify-widget/](https://developers.openwaf.dev/waf/verify-widget/)
and [the open-source page](https://developers.openwaf.dev/waf/verify-open-source/).

## What is open and what is not

Open, here: all the code your visitors' browsers receive and all the code your servers run to check a token.

Not here: the server side that decides whether a solve is accepted (risk scoring and its signals, network
reputation, the edge itself), and one extension module of in-page yes/no checks that the OpenWAF service builds
into the widget. That module reads no canvas, WebGL, audio, fonts or high-entropy client hints, sets no cookie, makes
no request and adds one integer to the solve request. Published detection gets bypassed quickly, so it stays closed;
what runs in your visitors' browsers should be readable, so the rest is open. Because of that module, the bundle the
edge serves is not byte-identical to a build of this repository. The [protocol](spec/PROTOCOL.md#6-extension-point)
describes the extension point.

## Install

Everything installs from this repository for now; the npm and Packagist packages are coming soon.

```sh
go get github.com/openwaf-dev/verify/siteverify@v0.1.0
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-0.1.0.tgz        # @openwaf/verify
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-react-0.1.0.tgz  # @openwaf/verify-react
npm install https://github.com/openwaf-dev/verify/releases/download/v0.1.0/openwaf-verify-vue-0.1.0.tgz    # @openwaf/verify-vue
composer config repositories.openwaf-verify vcs https://github.com/openwaf-dev/verify
composer require openwaf/verify:^0.1
```

The npm tarballs are attached to each [release](https://github.com/openwaf-dev/verify/releases) with their SHA-256
in `SHA256SUMS`.

## Five-minute start

1. Put the widget in a form on a host proxied by OpenWAF (the test site key works on any such host):

   ```html
   <script src="/__waf/challenge/v1/widget.js" async defer></script>
   <form action="/signup" method="post">
     <div class="owaf-verify" data-sitekey="owk_test_pass" data-action="signup"></div>
     <button>Sign up</button>
   </form>
   ```

2. On your server, check the `owaf-verify-response` field with siteverify (the test secret accepts any token):

   ```go
   c, _ := siteverify.New(os.Getenv("OPENWAF_VERIFY_SECRET")) // ows_test_pass while testing
   res, err := c.Verify(ctx, r.FormValue("owaf-verify-response"), siteverify.Params{RemoteIP: clientIP})
   if err != nil || !res.Success { /* refuse */ }
   ```

   ```ts
   import { SiteverifyClient } from "@openwaf/verify";
   const res = await new SiteverifyClient({ secret: process.env.OPENWAF_VERIFY_SECRET! })
     .verify(token, { remoteIp, expectedAction: "signup" });
   ```

   ```php
   $res = (new OpenWAF\Verify\Siteverify\Client((string) getenv('OPENWAF_VERIFY_SECRET')))
       ->verify($_POST['owaf-verify-response'] ?? '', remoteIp: $ip);
   ```

3. In React: `<Verify siteKey="owk_test_pass" onSuccess={setToken} />` from `@openwaf/verify-react`.

Replace the test keys with your widget's site key and secret (dashboard: **Security → Verification → Widgets**).

## Building the client

```sh
node challengejs/build.mjs          # esbuild and terser, pinned, through npx
go test ./challengejs/              # widget sandbox and interstitial template tests (needs node)
```

The built files (`*.min.js`, `*.min.css` and their `.gz`/`.br`) are committed; CI rebuilds them and fails if they
differ. Each library has its own README with its tests.

## Security

Report vulnerabilities privately to **support@openwaf.dev** (see [SECURITY.md](SECURITY.md)); never in a public
issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes to `challengejs/` are reviewed here and shipped with the next edge
release.

## Licence

[Apache License 2.0](LICENSE). © OpenWAF.
