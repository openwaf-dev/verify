// OpenWAF Verify widget: /__waf/challenge/v1/widget.js (built by build.mjs).
//
// First party: every request goes to the page's own host under /__waf/challenge/v1/ (no third-party origin,
// cookie or frame). Works under Content-Security-Policy: default-src 'self': the stylesheet and the worker are
// same-origin files, no inline style or script, no eval, no blob: URLs, no WebAssembly.
//
//   <div class="owaf-verify" data-sitekey="owk_…"></div>
//   <script src="/__waf/challenge/v1/widget.js" async defer></script>
//
// Options (data-* or render() opts): theme auto|light|dark, language auto|en|es, size normal (300×65)|compact
// (150×140), accent #rgb|#rrggbb (default: the zone's challenge colour, sent by /start). The widget element carries
// data-state = solving | success | interactive | error | expired. In the interactive state the box asks a person to
// tick a real checkbox («Verify you are human»); only a trusted pointer or keyboard activation counts (activation()).
// Each solve also sends the fields of the build's extension (ext.js: none in the open-source build).
//
// Brand (/start brand, the site's site.challenge.brand): none = OpenWAF's hexagon; client = the client's icon (else its
// logo, else its name) with a small "Protected by OpenWAF" and our legal links; org = the organization's white label
// only (its icon, logo or name and its own legal links when it has them), nothing of OpenWAF.
//
// window.owafVerify = {render, execute, reset, getResponse, remove, isExpired}.
import {session} from 'verify-ext'; // ext.js, or the build's extension (build.mjs)
import {solveInWorker} from './pow.js';

/* global __WORKER_V__, __STYLE_V__ */
const BASE = '/__waf/challenge/v1/';
const WORKER_URL = BASE + 'worker.js?v=' + __WORKER_V__;
const STYLE_URL = BASE + 'widget.css?v=' + __STYLE_V__;
const FIELD = 'owaf-verify-response';
const SLOW_MS = 4000; // announce "still verifying" at most once, after this long
const REFRESH_BEFORE_S = 30;

const TEXT = {
  en: {
    verifying: 'Verifying…',
    slow: 'Still verifying…',
    refreshing: 'Refreshing verification…',
    done: 'Verified',
    success: 'Success',
    failed: 'Verification failed',
    retry: 'Try again',
    expired: 'Verification expired',
    ask: 'Verify you are human',
    interaction: "We can't verify this browser",
    region: 'OpenWAF Verify',
    regionBy: (n) => 'Security check by ' + n,
    brand: 'OpenWAF (opens in a new tab)',
    protectedBy: 'Protected by OpenWAF',
    privacy: 'Privacy',
    terms: 'Terms',
    newTab: ' (opens in a new tab)',
    help: 'Trouble?',
    helpLabel: 'Trouble? Check your browser',
    check: 'https://verify.openwaf.dev/',
    home: 'https://openwaf.dev/?utm_source=verify-widget',
    privacyURL: 'https://openwaf.dev/legal/privacy/',
    termsURL: 'https://openwaf.dev/legal/terms/',
  },
  es: {
    verifying: 'Verificando…',
    slow: 'Seguimos verificando…',
    refreshing: 'Renovando la verificación…',
    done: 'Verificado',
    success: 'Correcto',
    failed: 'No se pudo verificar',
    retry: 'Reintentar',
    expired: 'La verificación ha caducado',
    ask: 'Verifica que eres humano',
    interaction: 'No podemos verificar este navegador',
    region: 'OpenWAF Verify',
    regionBy: (n) => 'Comprobación de seguridad de ' + n,
    brand: 'OpenWAF (se abre en una pestaña nueva)',
    protectedBy: 'Protegido por OpenWAF',
    privacy: 'Privacidad',
    terms: 'Condiciones',
    newTab: ' (se abre en una pestaña nueva)',
    help: '¿Problemas?',
    helpLabel: '¿Problemas? Comprueba tu navegador',
    check: 'https://verify.openwaf.dev/es/',
    home: 'https://openwaf.dev/es/?utm_source=verify-widget',
    privacyURL: 'https://openwaf.dev/es/legal/privacidad/',
    termsURL: 'https://openwaf.dev/es/legal/condiciones/',
  },
};

// Accent colour: data-accent / opts.accent (#rgb or #rrggbb), else the zone's challenge colour from /start. The
// widget never shows it as given when that would be unreadable: rings (spinner, focus, button border) get at
// least 3:1 against each theme's background (WCAG 1.4.11), and the filled button's label at least 4.5:1 (1.4.3),
// darkening or lightening the colour as little as needed. Success stays green and errors red in every theme.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const LIGHT_BG = [250, 250, 250]; // --owaf-v-bg of each theme (widget.css)
const DARK_BG = [24, 24, 27];
const WHITE = [255, 255, 255];
const INK = [24, 24, 27];
const BLACK = [0, 0, 0];

function rgb(v) {
  if (typeof v !== 'string' || !HEX.test((v = v.trim()))) return null;
  let h = v.slice(1);
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(c) {
  const [r, g, b] = c.map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// fit mixes c toward `toward` in 2% steps until it reaches min:1 against bg.
function fit(c, bg, toward, min) {
  for (let k = 0; k <= 50; k++) {
    const m = c.map((v, i) => Math.round(v + ((toward[i] - v) * k) / 50));
    if (contrast(m, bg) >= min) return m;
  }
  return toward;
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// palette returns the accent custom properties of colour v, or null when v is not a hex colour.
function palette(v) {
  const c = rgb(v);
  if (!c) return null;
  const dark = luminance(c) < 0.4; // white label on mid and dark colours, ink on light ones
  const btn = dark ? fit(c, WHITE, BLACK, 4.5) : fit(c, INK, WHITE, 4.5);
  return {
    '--owaf-v-acc-l': hex(fit(c, LIGHT_BG, BLACK, 3)),
    '--owaf-v-acc-d': hex(fit(c, DARK_BG, WHITE, 3)),
    '--owaf-v-btn-bg': hex(btn),
    '--owaf-v-btn-fg': hex(dark ? WHITE : INK),
  };
}

// Inline SVG, built with createElementNS (no innerHTML: also fine under Trusted Types). Presentation comes
// from widget.css classes; the only attributes are geometry.
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(cls, viewBox, children) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  for (const [tag, cl, attrs] of children) {
    const n = document.createElementNS(SVG_NS, tag);
    if (cl) n.setAttribute('class', cl);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    s.appendChild(n);
  }
  return s;
}

const RING = {cx: 12, cy: 12, r: 9};
const DISC = {cx: 12, cy: 12, r: 11};

// stateIcon holds every state glyph; widget.css shows the one of the root's data-state (none in the interactive state,
// where the checkbox stands in its place).
const stateIcon = () =>
  svg('owaf-v-icon', '0 0 24 24', [
    ['circle', 'owaf-v-track', RING],
    ['circle', 'owaf-v-arc', {...RING, pathLength: 100}],
    ['circle', 'owaf-v-disc owaf-v-ok-disc', DISC],
    ['path', 'owaf-v-glyph owaf-v-check', {d: 'M7 12.5l3.2 3.2L17 8.8', pathLength: 1}],
    ['circle', 'owaf-v-disc owaf-v-err-disc', DISC],
    ['path', 'owaf-v-glyph owaf-v-cross', {d: 'M8.5 8.5l7 7M15.5 8.5l-7 7'}],
    ['path', 'owaf-v-glyph owaf-v-bang', {d: 'M12 6.8v6.4M12 16.6v.6'}],
  ]);

const retryIcon = () => svg('owaf-v-retry', '0 0 16 16', [['path', '', {d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M12.5 1.8v2.9H9.6'}]]);

// The OpenWAF mark (same paths as openwaf.dev), monochrome: currentColor, the right half lighter.
const MARK_L =
  'M221.67,99.82L243,87.51L243,179.51L103.58,260L103.58,168ZM103.58,286L243,205.51L243,293.51L129.56,359L103.58,344ZM152.08,372L243,319.51L243,424.49Z';
const MARK_R =
  'M269,87.51L299.38,105.04L408.42,168L408.42,260L269,179.51ZM269,205.51L408.42,286L408.42,344L382.44,359L269,293.51ZM269,319.51L359.92,372L269,424.49Z';
const mark = () =>
  svg('owaf-v-mark', '80 80 352 352', [
    ['path', 'owaf-v-mk-l', {d: MARK_L}],
    ['path', 'owaf-v-mk-r', {d: MARK_R}],
  ]);

function link(cls, href, text, label) {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  if (label) a.setAttribute('aria-label', label);
  return a;
}

// brandOf keeps /start's brand when it is well formed: kind client|org with a name, the logo and the icon only as this
// host's brand URLs, the legal pages (org only) only as https URLs. Anything else is OpenWAF's own look (null).
const BRAND_LOGO = /^[0-9a-f]{64}\.(?:svg|png)$/;
const HTTPS = /^https:\/\/\S+$/i;
function brandOf(b) {
  if (!b || (b.kind !== 'client' && b.kind !== 'org') || typeof b.name !== 'string' || !b.name) return null;
  const url = (v) => (b.kind === 'org' && typeof v === 'string' && HTTPS.test(v) ? v : '');
  const own = (v) => (typeof v === 'string' && v.startsWith(BASE + 'brand/') && BRAND_LOGO.test(v.slice(BASE.length + 6)) ? v : '');
  return {kind: b.kind, name: b.name, logo: own(b.logo), icon: own(b.icon), privacy: url(b.privacy), terms: url(b.terms)};
}

const brandKey = (b) => (b ? [b.kind, b.name, b.logo, b.icon, b.privacy, b.terms].join('\n') : '');

// The group's accessible name: the organization's white label never says OpenWAF.
const region = (t, b) => (b && b.kind === 'org' ? t.regionBy(b.name) : t.region);

function legal(t, privacy, terms) {
  const links = [];
  if (privacy) links.push(link('', privacy, t.privacy, t.privacy + t.newTab));
  if (terms) links.push(link('', terms, t.terms, t.terms + t.newTab));
  if (!links.length) return null;
  const l = el('span', 'owaf-v-legal');
  links.forEach((a, i) => {
    if (i) {
      const sep = el('span', 'owaf-v-sep', '|');
      sep.setAttribute('aria-hidden', 'true');
      l.append(sep);
    }
    l.append(a);
  });
  return l;
}

// brandArea builds the brand column: OpenWAF's hexagon (no brand), the client's icon, logo or name over "Protected by
// OpenWAF" and our legal links, or the organization's icon, logo or name over its own legal links. Images show as
// given (an <img> of the same-origin brand URL, scaled by widget.css), never recoloured.
function brandArea(t, b) {
  const area = el('div', 'owaf-v-brand');
  if (!b) {
    const logo = link('owaf-v-logo', t.home, '', t.brand);
    logo.append(mark());
    area.append(logo, legal(t, t.privacyURL, t.termsURL));
    return area;
  }
  area.className += ' owaf-v-brand-' + b.kind;
  let id;
  if (b.icon || b.logo) {
    id = el('img', b.icon ? 'owaf-v-brand-icon' : 'owaf-v-brand-logo');
    id.alt = b.name;
    id.src = b.icon || b.logo;
  } else {
    id = el('span', 'owaf-v-brand-name', b.name);
    id.title = b.name;
  }
  area.append(id);
  if (b.kind === 'client') {
    const by = link('owaf-v-by', t.home, '', t.protectedBy + t.newTab);
    by.append(mark(), el('span', 'owaf-v-by-text', t.protectedBy));
    const prov = el('div', 'owaf-v-prov');
    prov.append(by, legal(t, t.privacyURL, t.termsURL));
    area.append(prov);
  } else {
    const l = legal(t, b.privacy, b.terms);
    if (l) area.append(l);
  }
  return area;
}

const script = document.currentScript;
const params = new URL((script && script.src) || location.href, location.href).searchParams;
const widgets = new Map();
let seq = 0;
let interacted = false;
let styled = false;

addEventListener('pointerdown', () => (interacted = true), {capture: true, passive: true});
addEventListener('keydown', () => (interacted = true), {capture: true, passive: true});

// activation is the one place that decides whether an event on the verification box is a person ticking it: only
// trusted events count. A pointerdown records its pointer type and a Space or Enter keydown the keyboard (seen); a
// click then counts as 'pointer' after a mouse, touch or pen and as 'keyboard' after Space or Enter, and an Enter
// keydown counts as 'keyboard' by itself. Anything else (a script's el.click(), checked = true, other keys) is ''.
function activation(e, seen) {
  if (!e.isTrusted) return '';
  switch (e.type) {
    case 'pointerdown':
      seen.pointer = e.pointerType || '';
      return '';
    case 'keydown':
      if (e.key !== ' ' && e.key !== 'Enter') return '';
      seen.key = true;
      return e.key === 'Enter' ? 'keyboard' : '';
    case 'click': {
      const p = e.pointerType || seen.pointer;
      if (p === 'mouse' || p === 'touch' || p === 'pen') return 'pointer';
      return seen.key ? 'keyboard' : '';
    }
  }
  return '';
}

function addStyle() {
  if (styled) return;
  styled = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = STYLE_URL;
  document.head.appendChild(l);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function lang(v) {
  v = (v || 'auto').toLowerCase();
  if (v === 'auto') v = (navigator.language || 'en').toLowerCase();
  return v.slice(0, 2) === 'es' ? 'es' : 'en';
}

// option reads opts[camel], else the element's data-<kebab> attribute.
function option(opts, node, camel, kebab) {
  if (opts[camel] !== undefined && opts[camel] !== null) return opts[camel];
  const v = node.getAttribute('data-' + kebab);
  return v === null ? undefined : v;
}

function callback(fn, ...args) {
  if (typeof fn === 'string') fn = window[fn];
  if (typeof fn === 'function') {
    try {
      fn(...args);
    } catch (e) {
      setTimeout(() => {
        throw e;
      });
    }
  }
}

// patProof asks the node's Private Access Token challenge for ch (only offered when ch.pat): a supporting device answers
// the 401 PrivateToken challenge by itself and the node returns a proof for the solve. Resolves to the proof or
// undefined (no support, network error); the solve waits for it at most PAT_WAIT_MS after the work.
const PAT_WAIT_MS = 2000;
async function patProof(ch) {
  try {
    const r = await fetch(BASE + 'pat?c=' + encodeURIComponent(ch.challenge), {credentials: 'omit', cache: 'no-store'});
    if (!r.ok) return undefined;
    const j = await r.json();
    return typeof j.pt === 'string' ? j.pt : undefined;
  } catch (e) {
    return undefined;
  }
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  let j = {};
  try {
    j = await r.json();
  } catch (e) {
    // a non-JSON answer (rate limit page, network error page) is a failure below
  }
  if (!r.ok && !j.error) j.error = r.status === 429 ? 'rate-limited' : 'http-' + r.status;
  return j;
}

function nonceOf(challenge) {
  const b = challenge.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b + '==='.slice((b.length + 3) % 4))).n;
}

// solve resolves with the solutions and the worker's report (ext.js).
function solve(ch) {
  return new Promise((resolve) =>
    solveInWorker(WORKER_URL, nonceOf(ch.challenge), ch.q, ch.d, () => {}, (solutions, nav) => resolve({solutions, nav})),
  );
}

class Widget {
  constructor(container, opts) {
    this.id = 'owv-' + ++seq;
    this.container = container;
    const o = (c, k) => option(opts, container, c, k);
    this.sitekey = o('sitekey', 'sitekey') || '';
    this.action = o('action', 'action') || '';
    this.cdata = o('cdata', 'cdata') || '';
    this.onSuccess = o('callback', 'callback');
    this.onError = o('errorCallback', 'error-callback');
    this.onExpired = o('expiredCallback', 'expired-callback');
    this.theme = ['light', 'dark'].includes(o('theme', 'theme')) ? o('theme', 'theme') : 'auto';
    this.t = TEXT[lang(o('language', 'language'))];
    const accent = o('accent', 'accent');
    this.accent = rgb(accent) ? accent.trim() : ''; // anything else than #rgb/#rrggbb is ignored
    this.zoneColor = '';
    this.brand = null; // brandOf(/start's brand); null = OpenWAF's
    this.compact = o('size', 'size') === 'compact';
    this.autoRefresh = (o('refreshExpired', 'refresh-expired') || 'auto') !== 'manual';
    this.token = '';
    this.expiresAt = 0;
    this.gen = 0;
    this.timers = [];
    this.input = el('input');
    this.input.type = 'hidden';
    this.input.name = o('responseFieldName', 'response-field-name') || FIELD;
    container.appendChild(this.input);
    this.pending = null; // {resolve, reject} of execute()
  }

  // box builds the visible widget (managed and non_interactive): the state icon, the status and the retry button,
  // the verification box's checkbox and label (shown in the interactive state only) and the brand column.
  box() {
    if (this.root) return;
    addStyle();
    const t = this.t;
    this.root = el('div', 'owaf-v owaf-v-' + this.theme + (this.compact ? ' owaf-v-compact' : ''));
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', region(t, this.brand));
    this.root.setAttribute('data-state', 'solving');
    this.paint();
    this.status = el('span', 'owaf-v-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.button = el('button', 'owaf-v-btn');
    this.button.type = 'button';
    this.button.hidden = true;
    this.label = el('span');
    this.button.append(retryIcon(), this.label);
    this.row = el('div', 'owaf-v-row');
    this.row.append(this.button);
    const main = el('div', 'owaf-v-main');
    main.append(this.status, this.row);
    const ask = el('label', 'owaf-v-ask');
    this.cb = el('input', 'owaf-v-cb');
    this.cb.type = 'checkbox';
    ask.append(this.cb, el('span', 'owaf-v-ask-text', t.ask));
    const seen = {pointer: '', key: false};
    this.seen = seen;
    const onEvent = (e) => {
      const kind = activation(e, seen);
      if (e.type === 'pointerdown' || (e.type === 'keydown' && e.key !== 'Enter')) return;
      if (!kind || !this.onAsk) {
        if (e.type === 'click') e.preventDefault(); // an untrusted click never ticks it
        return;
      }
      if (e.type === 'keydown') e.preventDefault(); // Enter: no form submission
      const f = this.onAsk;
      this.onAsk = null;
      this.activated = e; // for the extension's session (ext.js activation)
      f({kind, ms: Math.max(0, Date.now() - this.askAt)});
    };
    ask.addEventListener('pointerdown', onEvent);
    this.cb.addEventListener('keydown', onEvent);
    this.cb.addEventListener('click', onEvent);
    this.brandEl = brandArea(t, this.brand);
    this.root.append(stateIcon(), ask, main, this.brandEl);
    this.container.insertBefore(this.root, this.input);
  }

  // paint applies the accent palette (custom properties through the CSSOM: allowed by style-src 'self').
  paint() {
    const p = this.root && palette(this.accent || this.zoneColor);
    if (p) for (const k in p) this.root.style.setProperty(k, p[k]);
  }

  // setBrand applies the site's brand of a /start or interactive answer (rebuilding the brand column on a change).
  setBrand(raw) {
    const b = brandOf(raw);
    if (brandKey(b) === brandKey(this.brand)) return;
    this.brand = b;
    if (!this.root) return;
    this.root.setAttribute('aria-label', region(this.t, b));
    this.brandEl.remove();
    this.brandEl = brandArea(this.t, b);
    this.root.append(this.brandEl);
  }

  // say shows state (solving, success, interactive, error, expired) with its announced text.
  say(state, text) {
    if (!this.root) return;
    this.root.setAttribute('data-state', state);
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  // offer shows the retry button with label, running onClick once.
  offer(label, aria, onClick) {
    if (!this.root) return;
    const b = this.button;
    this.label.textContent = label;
    b.setAttribute('aria-label', aria || label);
    b.hidden = false;
    b.onclick = () => {
      b.hidden = true;
      b.onclick = null;
      onClick();
    };
  }

  // askBox shows the verification box: an unticked, focused checkbox whose activation (activation()) runs onTick with
  // the interaction {kind, ms since the box showed}.
  askBox(onTick) {
    this.cb.checked = false;
    this.seen.pointer = '';
    this.seen.key = false;
    this.askAt = Date.now();
    this.onAsk = onTick;
    this.say('interactive', this.t.ask);
    this.cb.focus();
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  // start asks for a challenge; invisible widgets render nothing and wait for execute().
  async start(refreshing) {
    const gen = ++this.gen;
    this.clearTimers();
    if (this.root) {
      this.button.hidden = true;
      this.onAsk = null;
      this.say('solving', refreshing ? this.t.refreshing : this.t.verifying);
    }
    let ch;
    try {
      ch = await post('start', {sitekey: this.sitekey, action: this.action, cdata: this.cdata});
    } catch (e) {
      ch = {error: 'network'};
    }
    if (gen !== this.gen) return;
    if (typeof ch.color === 'string' && ch.color !== this.zoneColor) {
      this.zoneColor = ch.color;
      this.paint();
    }
    // A server's answer names the site's brand (absent = none); a network or rate-limit failure keeps the last one.
    if (ch.challenge || ch.brand) this.setBrand(ch.brand);
    if (ch.error || !ch.challenge) {
      this.box();
      return this.fail(ch.error || 'start');
    }
    this.mode = ch.mode;
    if (ch.mode === 'invisible' && !this.pending) {
      this.challenge = ch;
      return;
    }
    if (ch.mode !== 'invisible') this.box();
    this.run(ch, false, gen, refreshing);
  }

  async run(ch, interaction, gen, refreshing) {
    this.cid = ch.id;
    this.say('solving', refreshing ? this.t.refreshing : this.t.verifying);
    this.timers.push(setTimeout(() => gen === this.gen && !this.token && this.say('solving', this.t.slow), SLOW_MS));
    const ext = session(ch);
    const pat = ch.pat ? patProof(ch) : undefined;
    const {solutions, nav} = await solve(ch);
    const pt = pat && (await Promise.race([pat, new Promise((r) => setTimeout(r, PAT_WAIT_MS))]));
    if (gen !== this.gen) return;
    ext.nav(nav);
    if (interaction && this.activated) ext.activation(this.activated);
    let r;
    try {
      r = await post('solve', {
        challenge: ch.challenge,
        solutions,
        signals: {webdriver: navigator.webdriver === true, interacted},
        interaction,
        ...ext.fields(),
        pt,
      });
    } catch (e) {
      r = {error: 'network'};
    }
    if (gen !== this.gen) return;
    this.clearTimers();
    if (r.success && r.token) return this.succeed(r.token, r.expires_in || 300, !!interaction);
    if (r.interactive && r.challenge && !interaction) {
      this.setBrand(r.brand);
      this.box();
      this.askBox((ia) => this.run(r, ia, gen, false));
      return;
    }
    this.fail(r.error || 'solve', !!interaction);
  }

  // succeed keeps the token; after the verification box the box says «Success», else «Verified».
  succeed(token, expiresIn, ticked) {
    this.token = token;
    this.expiresAt = Date.now() + expiresIn * 1000;
    this.input.value = token;
    this.say('success', ticked ? this.t.success : this.t.done);
    if (this.pending) {
      this.pending.resolve(token);
      this.pending = null;
    }
    callback(this.onSuccess, token);
    const gen = this.gen;
    if (this.autoRefresh) {
      this.timers.push(setTimeout(() => gen === this.gen && this.refresh(), Math.max(1, expiresIn - REFRESH_BEFORE_S) * 1000));
    } else {
      this.timers.push(setTimeout(() => gen === this.gen && this.expire(), expiresIn * 1000));
    }
  }

  refresh() {
    this.token = '';
    this.input.value = '';
    if (this.mode === 'invisible') {
      // nothing to show: the next execute() solves again
      callback(this.onExpired);
      return;
    }
    this.start(true);
  }

  expire() {
    this.token = '';
    this.input.value = '';
    this.say('expired', this.t.expired);
    this.offer(this.t.retry, null, () => this.start(false));
    callback(this.onExpired);
  }

  // fail shows the error and the retry button, focused when the person just ticked the box (ticked).
  fail(code, ticked) {
    this.token = '';
    this.input.value = '';
    const text = code === 'interaction-required' ? this.t.interaction : this.t.failed;
    this.say('error', text);
    this.offer(this.t.retry, null, () => this.start(false));
    // «Trouble? Check your browser» (shown in the error state only, widget.css): the troubleshooting page with this host
    // and the last challenge's support ID, made for this failure; never under an organization's white label (it never
    // says OpenWAF).
    if (this.help) this.help.remove();
    this.help = null;
    if (this.root && !(this.brand && this.brand.kind === 'org')) {
      const q = '?host=' + encodeURIComponent(location.hostname) + (this.cid ? '&id=' + this.cid : '');
      this.row.append((this.help = link('owaf-v-help', this.t.check + q, this.t.help, this.t.helpLabel + this.t.newTab)));
    }
    if (ticked) this.button.focus();
    if (this.pending) {
      this.pending.reject(new Error(code));
      this.pending = null;
    }
    callback(this.onError, code);
  }

  execute() {
    if (this.token && !this.isExpired()) return Promise.resolve(this.token);
    return new Promise((resolve, reject) => {
      this.pending = {resolve, reject};
      const ch = this.challenge;
      this.challenge = null;
      if (this.mode === 'invisible' && ch && ch.exp - Date.now() > 30000) this.run(ch, false, ++this.gen, false);
      else this.start(false);
    });
  }

  isExpired() {
    return !this.token || Date.now() >= this.expiresAt;
  }

  remove() {
    this.gen++;
    this.clearTimers();
    if (this.root) this.root.remove();
    this.input.remove();
  }
}

function find(idOrEl) {
  if (idOrEl === undefined) return widgets.values().next().value;
  if (typeof idOrEl === 'string' && widgets.has(idOrEl)) return widgets.get(idOrEl);
  const node = typeof idOrEl === 'string' ? document.querySelector(idOrEl) : idOrEl;
  for (const w of widgets.values()) if (w.container === node) return w;
  return undefined;
}

function render(target, opts) {
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node) throw new Error('owafVerify.render: container not found');
  const existing = find(node);
  if (existing) return existing.id;
  const w = new Widget(node, opts || {});
  widgets.set(w.id, w);
  w.start(false);
  return w.id;
}

const api = {
  render,
  execute: (id) => {
    const w = find(id);
    return w ? w.execute() : Promise.reject(new Error('owafVerify: unknown widget'));
  },
  reset: (id) => {
    const w = find(id);
    if (!w) return;
    w.token = '';
    w.input.value = '';
    w.start(false);
  },
  getResponse: (id) => {
    const w = find(id);
    return w && !w.isExpired() ? w.token : '';
  },
  remove: (id) => {
    const w = find(id);
    if (w) {
      w.remove();
      widgets.delete(w.id);
    }
  },
  isExpired: (id) => {
    const w = find(id);
    return !w || w.isExpired();
  },
};

window.owafVerify = api;

function autoRender() {
  if (params.get('render') !== 'explicit') document.querySelectorAll('.owaf-verify').forEach((n) => render(n));
  const onload = params.get('onload');
  if (onload) callback(onload);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoRender);
else autoRender();
