#!/usr/bin/env node
// Builds the OpenWAF Verify browser assets the edge serves under /__waf/challenge/v1/:
//   worker.src.js (+ pow.js) → worker.min.js        the proof-of-work Web Worker (also the interstitial's fallback)
//   widget.css               → widget.min.css       the widget stylesheet
//   widget.src.js (+ pow.js) → widget.min.js        the embeddable widget; it references the worker and the stylesheet
//                                                   by version (?v= = first 10 hex of their SHA-256, as the proxy computes)
// and the gzip and brotli variants of each, plus
//   interstitial.css         → interstitial.min.css the interstitial's style (inlined by the page, never served alone).
// The outputs are generated files checked into the repo and embedded by the proxy; rebuild after any change:
//
//   node build.mjs [--ext <file>]      (run with this file's path from anywhere)
//
// The widget and the worker import 'verify-ext', the extension point (ext.js documents its shape): the module given
// with --ext, else private/ext.js when it exists (a deployment's own extension, never part of the open-source
// repository), else ext.js, which adds nothing.
//
// esbuild (bundle, IIFE, ES2020) and terser (minify) are pinned and run through `npx` unless ESBUILD / TERSER point to
// binaries of those exact versions; nothing is installed.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brotliCompressSync, constants, gzipSync} from 'node:zlib';

const ESBUILD_VERSION = '0.28.2';
const TERSER_VERSION = '5.51.2';
const GZIP_BUDGET = 8 * 1024; // per asset

const dir = dirname(fileURLToPath(import.meta.url));

const extArg = process.argv.indexOf('--ext');
const ext =
  extArg > 0 ? resolve(process.argv[extArg + 1] || '') : [join(dir, 'private', 'ext.js'), join(dir, 'ext.js')].find((p) => existsSync(p));
if (!existsSync(ext)) throw new Error(`extension ${ext}: not found`);
console.log(`extension       ${relative(dir, ext)}`);

const tool = (env, pkg, version, versionOut) => {
  const [cmd, ...pre] = process.env[env] ? [process.env[env]] : ['npx', '--yes', `${pkg}@${version}`];
  const run = (args, input) =>
    execFileSync(cmd, [...pre, ...args], {input, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'], maxBuffer: 1 << 24});
  const found = run(['--version']).toString().trim();
  if (found !== versionOut) throw new Error(`${pkg}: "${found}" found, "${versionOut}" required`);
  return run;
};
const esbuild = tool('ESBUILD', 'esbuild', ESBUILD_VERSION, ESBUILD_VERSION);
const terser = tool('TERSER', 'terser', TERSER_VERSION, `terser ${TERSER_VERSION}`);

const version = (b) => createHash('sha256').update(b).digest('hex').slice(0, 10);

const js = (src, defines = {}) => {
  const bundle = esbuild([
    join(dir, src),
    '--bundle',
    '--format=iife',
    '--target=es2020',
    '--platform=browser',
    '--charset=utf8',
    '--legal-comments=none',
    '--log-level=warning',
    `--alias:verify-ext=${ext}`,
    ...Object.entries(defines).map(([k, v]) => `--define:${k}=${JSON.stringify(v)}`),
  ]);
  return terser(['--compress', 'passes=2', '--mangle', '--ecma', '2020', '--comments', 'false'], bundle);
};

const outputs = [];
const emit = (name, body) => {
  const gz = gzipSync(body, {level: 9});
  gz[9] = 3; // gzip header OS = Unix on every build host, so the output is byte-for-byte reproducible.
  const br = brotliCompressSync(body, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_LGWIN]: constants.BROTLI_MAX_WINDOW_BITS,
      [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
    },
  });
  console.log(`${name.padEnd(15)} ${body.length} B, gzip ${gz.length} B, br ${br.length} B (v=${version(body)})`);
  if (gz.length >= GZIP_BUDGET) {
    console.error(`${name}.gz is ${gz.length} B: over the ${GZIP_BUDGET} B budget, outputs not written`);
    process.exit(1);
  }
  outputs.push([name, body], [name + '.gz', gz], [name + '.br', br]);
};

const worker = js('worker.src.js');
emit('worker.min.js', worker);
const minCSS = (src) => esbuild([join(dir, src), '--minify', '--charset=utf8', '--log-level=warning']);
const css = minCSS('widget.css');
emit('widget.min.css', css);
emit('widget.min.js', js('widget.src.js', {__WORKER_V__: version(worker), __STYLE_V__: version(css)}));
outputs.push(['interstitial.min.css', minCSS('interstitial.css')]);

for (const [name, body] of outputs) writeFileSync(join(dir, name), body);
