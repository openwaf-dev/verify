# Changelog

All notable changes to this repository. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
packages follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-29

### Added

- Browser client (`challengejs/`): the widget, the proof-of-work worker, the interstitial page template and CSS, with
  the extension point (`ext.js`, `build.mjs --ext`) and their tests.
- Protocol specification, version 1 (`spec/PROTOCOL.md`).
- siteverify clients: Go `github.com/openwaf-dev/verify/siteverify`, Node.js `@openwaf/verify`, PHP `openwaf/verify`.
- Components: React `@openwaf/verify-react`, Vue 3 `@openwaf/verify-vue`.
- Examples for Go `net/http`, Node.js `node:http`, PHP and React with Vite.
- Leak guard (`scripts/leak-guard.sh`) and CI on GitHub-hosted runners.
- Release workflow: each `vX.Y.Z` tag attaches the npm tarballs and their `SHA256SUMS` to the GitHub release. Until
  the npm and Packagist packages exist, install from the release tarballs and Composer's VCS repository.
