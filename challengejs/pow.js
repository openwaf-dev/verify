// OpenWAF Verify proof of work (shared by worker.src.js and widget.src.js).
//
// Puzzle i of a challenge with nonce n and d bits: find a decimal string x such that
// SHA-256(n + "." + i + "." + x) starts with at least d zero bits. Every puzzle message is ASCII and at most
// 55 bytes (n is 22 characters, x at most 16), so the hash is a single SHA-256 block: only the first two
// words of the digest are computed and checked. Pure JavaScript: no eval, no WebAssembly, no blob: URLs.

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const W = new Int32Array(64);

// zeroBits reports whether SHA-256(s) (s ASCII, at most 55 bytes) starts with d zero bits (1 <= d <= 32).
function zeroBits(s, d) {
  const len = s.length;
  W.fill(0, 0, 16);
  for (let i = 0; i < len; i++) W[i >> 2] |= s.charCodeAt(i) << (24 - (i & 3) * 8);
  W[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  W[15] = len * 8;
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15], b = W[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = 0x6a09e667, b = 0xbb67ae85, c = 0x3c6ef372, e0 = 0xa54ff53a;
  let e = 0x510e527f, f = 0x9b05688c, g = 0x1f83d9ab, h = 0x5be0cd19;
  for (let i = 0; i < 64; i++) {
    const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (e0 + t1) | 0; e0 = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  return ((a + 0x6a09e667) >>> (32 - d)) === 0;
}

// Solver solves the q puzzles of nonce n with d bits in steps: step(budget) tries at most budget candidates and
// returns true once every puzzle is solved (solutions then holds them, as strings).
export class Solver {
  constructor(n, q, d) {
    this.n = n; this.q = q; this.d = d; this.i = 0; this.x = 0; this.solutions = [];
  }
  step(budget) {
    if (this.i >= this.q) return true;
    const prefix = this.n + '.' + this.i + '.';
    for (let k = 0; k < budget; k++) {
      if (zeroBits(prefix + this.x, this.d)) {
        this.solutions.push(String(this.x));
        this.x = 0;
        return ++this.i >= this.q;
      }
      this.x++;
    }
    return false;
  }
}

// solveSliced solves on the calling thread in time slices of about sliceMs, yielding to the event loop between
// slices (never one long blocking loop); progress(i) after each puzzle, done(solutions) at the end.
export function solveSliced(n, q, d, progress, done, sliceMs = 12) {
  const s = new Solver(n, q, d);
  let budget = 2000;
  const slice = () => {
    const t0 = Date.now();
    let solved = s.i;
    while (Date.now() - t0 < sliceMs) {
      if (s.step(budget)) return done(s.solutions);
      if (s.i !== solved) progress((solved = s.i));
    }
    setTimeout(slice, 0);
  };
  setTimeout(slice, 0);
}

// solveInWorker solves in a Web Worker loaded from url (same origin), falling back to solveSliced when workers
// are unavailable or the worker fails (blocked by a policy, error while loading). done(solutions, nav) also gets the
// worker's report (ext.js report; undefined when solved on the page).
export function solveInWorker(url, n, q, d, progress, done) {
  let w;
  try {
    w = new Worker(url);
  } catch (e) {
    return solveSliced(n, q, d, progress, done);
  }
  let finished = false;
  let nav;
  w.onmessage = (ev) => {
    const m = ev.data || {};
    if (typeof m.nav === 'string') {
      nav = m.nav;
    } else if (Array.isArray(m.solutions)) {
      finished = true;
      w.terminate();
      done(m.solutions, nav);
    } else if (typeof m.progress === 'number') {
      progress(m.progress);
    }
  };
  w.onerror = (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    w.terminate();
    if (!finished) {
      finished = true;
      solveSliced(n, q, d, progress, done);
    }
  };
  w.postMessage({n, q, d});
}
