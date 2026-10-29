# Security policy

## Reporting a vulnerability

Email **support@openwaf.dev** (also reachable as security@openwaf.dev) with a description, the affected component and
version or commit, and steps to reproduce. Please do not open a public issue or pull request for a vulnerability.

We confirm receipt within 24 hours, keep you informed until a fix ships, and credit reporters in the release notes
unless you ask us not to. Fixes to `challengejs/` reach visitors with the next OpenWAF edge release; fixes to the
libraries and components are published as new package versions.

## Scope

In scope: everything in this repository — the widget, the proof-of-work worker, the interstitial page template and
CSS (`challengejs/`), the siteverify libraries for Go, Node.js and PHP, the React and Vue components, and the
examples. Examples of what we want to hear about: a way to get a valid token without doing the work or for another
host, script injection through widget options or brand data, a library that leaks the secret or accepts a failed
verification, a component that keeps a stale token.

Also welcome, at the same address: issues in the OpenWAF service itself (the edge, siteverify, the dashboard). Their
code is not in this repository.

Out of scope: denial of service by volume, findings that need a compromised browser or server, and reports about the
detection that decides whether a solve is accepted being bypassable by a specific tool. That last kind is still
useful to us: send it, but it is not handled as a vulnerability.

## Handling secrets

Widget secrets (`ows_…`) belong on your server only. The libraries never print, log or serialise them. If a secret
leaks, rotate it in the dashboard (**Security → Verification → Widgets → Rotate secret**); the previous one stays
valid for 24 hours.
