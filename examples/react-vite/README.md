# OpenWAF Verify · React + Vite example

A sign-up form with [`@openwaf/verify-react`](../../react) and a tiny backend route that checks the token with siteverify.

```sh
cd ../../react && npm ci && npm run build   # the example uses the local package
cd ../examples/react-vite && npm ci
npm run dev                                  # http://localhost:5173
```

The page shows the widget, the token it produced and, after you submit, the siteverify answer from the backend. Out of the box it uses the test keys: sitekey `owk_test_pass` (always solves with `v1.TEST.TOKEN`) and secret `ows_test_pass` (accepts any token, spends nothing).

## How it fits together

- `src/App.tsx` renders `<Verify siteKey action="signup" />` inside the form. The widget writes the token into the hidden field `owaf-verify-response`, so a plain form post carries it. After each submit the form calls `reset()`: tokens are single use.
- `vite.config.ts` adds `POST /api/signup`, which posts `secret` and `response` to `https://dash.openwaf.dev/v1/challenge/siteverify` with `fetch` and accepts the request only when `success` is `true`. In a real backend use a server library ([`@openwaf/verify`](../../node), [Go](../../siteverify), [PHP](../../php)) and also check `hostname` and `action`.
- In production the OpenWAF edge serves `/__waf/challenge/*` on your own host. During development Vite proxies that path to a host behind OpenWAF (`https://developers.openwaf.dev` by default) and presents that host's origin, which the edge requires. The test sitekeys work there; a real sitekey needs a host of its own zone.

## Configuration

| Variable | Default | |
|---|---|---|
| `VITE_OPENWAF_SITEKEY` | `owk_test_pass` | Sitekey used by the page. |
| `OPENWAF_VERIFY_SECRET` | `ows_test_pass` | Secret used by `/api/signup`. Set it in the environment, never in code. |
| `OPENWAF_EDGE_ORIGIN` | `https://developers.openwaf.dev` | Host behind OpenWAF that the dev server proxies `/__waf/challenge/*` to. |
| `OPENWAF_SITEVERIFY_URL` | `https://dash.openwaf.dev/v1/challenge/siteverify` | Or `https://<your-host>/__waf/challenge/siteverify`. |
