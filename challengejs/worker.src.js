// OpenWAF Verify worker: /__waf/challenge/v1/worker.js (built by build.mjs).
//
// Loaded as a Web Worker it posts {nav} (the extension's report, ext.js, when it has one), solves {n, q, d} and posts
// {progress: i} after each puzzle and {solutions} at the end. Loaded as a classic script (the interstitial page) it
// defines globalThis.owafPow: solveInWorker starts this same file as a worker and falls back to time-sliced solving on
// the page, plus the extension's page members (ext.js page).
import {Solver, solveInWorker, solveSliced} from './pow.js';
import {report, page} from 'verify-ext'; // ext.js, or the build's extension (build.mjs)

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (ev) => {
    const m = ev.data || {};
    const nav = report(self);
    if (typeof nav === 'string') self.postMessage({nav});
    const s = new Solver(String(m.n), m.q | 0, m.d | 0);
    let done = false;
    while (!done) {
      const before = s.i;
      done = s.step(1 << 16);
      if (s.i !== before && !done) self.postMessage({progress: s.i});
    }
    self.postMessage({solutions: s.solutions});
  };
} else {
  globalThis.owafPow = {solveInWorker, solveSliced, ...page};
}
