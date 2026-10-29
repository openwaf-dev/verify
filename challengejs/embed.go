// Package challengejs embeds the OpenWAF Verify browser assets the edge serves under /__waf/challenge/v1/:
// widget.min.js, worker.min.js and widget.min.css with their precompressed gzip and brotli variants of the same bytes,
// interstitial.min.css, which the interstitial page inlines (built by build.mjs from widget.src.js, worker.src.js,
// pow.js, the extension, widget.css and interstitial.css), and the interstitial page template, interstitial.html.
package challengejs

import _ "embed"

// Widget is widget.min.js (the embeddable widget).
//
//go:embed widget.min.js
var Widget []byte

//go:embed widget.min.js.gz
var WidgetGzip []byte

//go:embed widget.min.js.br
var WidgetBrotli []byte

// Worker is worker.min.js (the proof-of-work Web Worker; the interstitial also loads it as a classic script for
// its fallback without workers).
//
//go:embed worker.min.js
var Worker []byte

//go:embed worker.min.js.gz
var WorkerGzip []byte

//go:embed worker.min.js.br
var WorkerBrotli []byte

// Style is widget.min.css.
//
//go:embed widget.min.css
var Style []byte

//go:embed widget.min.css.gz
var StyleGzip []byte

//go:embed widget.min.css.br
var StyleBrotli []byte

// Interstitial is interstitial.min.css, inlined by the interstitial page (never served as a file).
//
//go:embed interstitial.min.css
var Interstitial []byte

// InterstitialPage is interstitial.html, the interstitial page's html/template (data and extension blocks: its
// header).
//
//go:embed interstitial.html
var InterstitialPage string
