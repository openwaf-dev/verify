// Runs widget.min.js (path in argv[2]) in a minimal DOM sandbox and prints, per widget (by data-sitekey), the
// data-state transitions, the announced status texts, the accent custom properties, the button, the verification box,
// the interactions posted to /solve, the brand links, images and every string the widget shows or labels, as JSON.
// /start answers every widget with the zone colour #3b82f6, the support ID 0123456789abcdef and the brand of BRANDS;
// /solve by site key: owk_fail and owk_org_fail fail, owk_ask* asks for the interaction first (owk_ask_fail then
// fails), owk_expire returns a 1 s token (the page uses refresh-expired=manual). After the first round the script tries
// a script's click on the verification box (untrusted), then ticks it like a person (pointer for owk_ask and
// owk_ask_fail, Space for owk_ask_es, Enter for owk_ask_enter), clicks the retry button of owk_fail and waits for the
// second round.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const ZONE = '#3b82f6';
const SVG_LOGO = '/__waf/challenge/v1/brand/' + 'a'.repeat(64) + '.svg';
const PNG_LOGO = '/__waf/challenge/v1/brand/' + 'b'.repeat(64) + '.png';
const ICON = '/__waf/challenge/v1/brand/' + 'c'.repeat(64) + '.svg';
const BRANDS = {
  owk_client_icon: {kind: 'client', name: 'Acme Shop', logo: SVG_LOGO, icon: ICON},
  owk_org_icon: {kind: 'org', name: 'Agencia Norte', logo: PNG_LOGO, icon: ICON},
  owk_client: {kind: 'client', name: 'Acme Shop', logo: SVG_LOGO},
  owk_client_text: {kind: 'client', name: 'Acme Shop'},
  owk_client_compact: {kind: 'client', name: 'Acme Shop', logo: SVG_LOGO},
  owk_org: {kind: 'org', name: 'Agencia Norte', logo: PNG_LOGO, privacy: 'https://norte.example/privacidad'},
  owk_org_compact: {kind: 'org', name: 'Agencia Norte', logo: PNG_LOGO, privacy: 'https://norte.example/p', terms: 'https://norte.example/t'},
  // Malformed parts are dropped: a foreign logo, non-https legal pages.
  owk_org_bad: {kind: 'org', name: 'Agencia Norte', logo: 'https://evil.example/x.svg', icon: 'https://evil.example/i.svg', privacy: 'javascript:alert(1)', terms: 'http://norte.example/t'},
  // Legal pages are the organization's only.
  owk_client_urls: {kind: 'client', name: 'Acme Shop', privacy: 'https://client.example/p'},
  // A failure under a white label: no troubleshooting link (it says OpenWAF).
  owk_org_fail: {kind: 'org', name: 'Agencia Norte'},
};
const script = readFileSync(process.argv[2], 'utf8');

class Style {
  constructor() {
    this.props = {};
  }
  setProperty(k, v) {
    this.props[k] = v;
  }
}

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.style = new Style();
    this.className = '';
    this.hidden = false;
    this.log = null; // [{state} | {text}] of the widget root, shared with its status
    this._text = '';
    this.listeners = {};
    this.checked = false;
  }
  setAttribute(k, v) {
    v = String(v);
    if (k === 'class') this.className = v;
    else this.attrs[k] = v;
    if (k === 'data-state' && this.log && this.log.states.at(-1) !== v) this.log.states.push(v);
  }
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._text = v;
    this.children = [];
    if (this.className === 'owaf-v-status') rootOf(this).log.texts.push(v);
  }
  append(...nodes) {
    nodes.forEach((n) => this.appendChild(n));
  }
  appendChild(n) {
    n.parent = this;
    this.children.push(n);
    if (n.className.split(' ').includes('owaf-v')) n.log = {states: [n.attrs['data-state']], texts: []};
    return n;
  }
  insertBefore(n, ref) {
    this.appendChild(n);
    const i = this.children.indexOf(ref);
    if (i >= 0) this.children.splice(i, 0, this.children.pop());
    return n;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  focus() {
    document.activeElement = this;
    this.focusCount = (this.focusCount || 0) + 1;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  // dispatch delivers an event of type to this element's listeners (no bubbling) and, for a click, its default
  // action: onclick and, on a checkbox, the tick unless a listener prevented it.
  dispatch(type, init) {
    const ev = {type, isTrusted: false, pointerType: '', key: '', defaultPrevented: false, ...init};
    ev.preventDefault = () => (ev.defaultPrevented = true);
    (this.listeners[type] || []).forEach((fn) => fn(ev));
    if (type === 'click') {
      if (this.type === 'checkbox' && !ev.defaultPrevented) this.checked = !this.checked;
      if (this.onclick) this.onclick(ev);
    }
    return ev;
  }
  // click is a script's el.click(): an untrusted click.
  click() {
    return this.dispatch('click', {});
  }
  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) {
      const f = c.find(pred);
      if (f) return f;
    }
    return null;
  }
  findAll(pred, out = []) {
    if (pred(this)) out.push(this);
    this.children.forEach((c) => c.findAll(pred, out));
    return out;
  }
}

const rootOf = (n) => {
  while (n && !n.log) n = n.parent;
  return n;
};
const has = (cls) => (n) => n.className.split(' ').includes(cls);

const containers = [
  {sitekey: 'owk_zone'},
  {sitekey: 'owk_accent', accent: '#e63946'},
  {sitekey: 'owk_short', accent: '#abc'},
  {sitekey: 'owk_light', accent: '#c9ff02'},
  {sitekey: 'owk_bad_name', accent: 'red'},
  {sitekey: 'owk_bad_len', accent: '#12345'},
  {sitekey: 'owk_bad_css', accent: '#e63946;color:red'},
  {sitekey: 'owk_ask'},
  {sitekey: 'owk_ask_es', language: 'es'},
  {sitekey: 'owk_ask_enter'},
  {sitekey: 'owk_ask_fail'},
  {sitekey: 'owk_client_icon'},
  {sitekey: 'owk_org_icon', size: 'compact'},
  {sitekey: 'owk_fail'},
  {sitekey: 'owk_expire', 'refresh-expired': 'manual'},
  {sitekey: 'owk_compact', size: 'compact', language: 'es'},
  {sitekey: 'owk_client'},
  {sitekey: 'owk_client_text', language: 'es'},
  {sitekey: 'owk_client_compact', size: 'compact', language: 'es'},
  {sitekey: 'owk_client_urls'},
  {sitekey: 'owk_org', language: 'es'},
  {sitekey: 'owk_org_compact', size: 'compact'},
  {sitekey: 'owk_org_bad'},
  {sitekey: 'owk_org_fail'},
].map((attrs) => {
  const c = new Element('div');
  c.className = 'owaf-verify';
  for (const k in attrs) c.setAttribute('data-' + k, attrs[k]);
  return c;
});

const body = new Element('body');
containers.forEach((c) => body.appendChild(c));
const head = new Element('head');

const document = {
  readyState: 'complete',
  currentScript: {src: 'https://shop.example/__waf/challenge/v1/widget.js'},
  head,
  body,
  activeElement: null,
  createElement: (t) => new Element(t),
  createElementNS: (_ns, t) => new Element(t),
  querySelectorAll: (sel) => (sel === '.owaf-verify' ? containers : []),
  querySelector: () => null,
  addEventListener: () => {},
};

const challenge = (key) => Buffer.from(JSON.stringify({n: 'abcdefghijklmnopqrstuv'})).toString('base64url') + '.mac~' + key;
const answer = (o) => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(o)});
const posts = {}; // interaction of each /solve post, by site key
const fetch = (url, opts) => {
  const j = JSON.parse(opts.body);
  if (url.endsWith('/start'))
    return answer({challenge: challenge(j.sitekey), q: 1, d: 1, exp: Date.now() + 120000, mode: 'managed', color: ZONE, id: '0123456789abcdef', brand: BRANDS[j.sitekey]});
  const key = j.challenge.split('~')[1];
  (posts[key] ||= []).push(j.interaction);
  if (key === 'owk_fail' || key === 'owk_org_fail') return answer({success: false, error: 'test-fail'});
  if (key === 'owk_expire') return answer({success: true, token: 'tok', expires_in: 1});
  if (key.startsWith('owk_ask') && !j.interaction) return answer({success: false, interactive: true, challenge: challenge(key), q: 1, d: 1, color: ZONE, id: 'fedcba9876543210'});
  if (key === 'owk_ask_fail') return answer({success: false, error: 'interaction-required'});
  return answer({success: true, token: 'tok', expires_in: 300});
};

const sandbox = {
  document,
  location: {href: 'https://shop.example/signup', hostname: 'shop.example'},
  navigator: {language: 'en-US', webdriver: false},
  addEventListener: () => {},
  fetch,
  atob,
  URL,
  setTimeout,
  clearTimeout,
  Date,
  console,
};
sandbox.window = sandbox.self = sandbox;
vm.runInNewContext(script, sandbox);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
const btn = (c) => c.find(has('owaf-v-btn'));
const cbOf = (c) => c.find(has('owaf-v-cb'));
const click = {};
for (const c of containers) {
  const key = c.getAttribute('data-sitekey');
  if (key.startsWith('owk_ask')) {
    const cb = cbOf(c);
    const label = c.find(has('owaf-v-ask'));
    const focused = (cb.focusCount || 0) > 0;
    // A script's click and a programmatic tick: nothing posted, the box stays unticked and asking.
    const scripted = cb.click();
    const untrusted = {prevented: scripted.defaultPrevented, checked: cb.checked};
    cb.checked = true;
    await wait(50);
    untrusted.posts = posts[key].length;
    untrusted.state = c.find(has('owaf-v')).getAttribute('data-state');
    cb.checked = false;
    if (key === 'owk_ask_es') {
      cb.dispatch('keydown', {isTrusted: true, key: ' '});
      cb.dispatch('click', {isTrusted: true, pointerType: ''});
    } else if (key === 'owk_ask_enter') {
      const ev = cb.dispatch('keydown', {isTrusted: true, key: 'Enter'});
      untrusted.enterPrevented = ev.defaultPrevented;
    } else {
      label.dispatch('pointerdown', {isTrusted: true, pointerType: 'mouse'});
      cb.dispatch('click', {isTrusted: true, pointerType: 'mouse'});
      cb.dispatch('click', {isTrusted: true, pointerType: 'mouse'}); // a second tick posts nothing more
    }
    click[key] = {focused, untrusted};
  } else if (key === 'owk_fail') {
    const b = btn(c);
    click[key] = {focused: document.activeElement === b};
    b.click();
  }
}
await wait(1500);
for (const c of containers) {
  const key = c.getAttribute('data-sitekey');
  if (click[key]) click[key].retryFocused = (btn(c).focusCount || 0) > 0;
}

const out = {};
// strings are every text, attribute and URL of the widget's tree (what a visitor sees or hears, and where it links).
const strings = (n, out = []) => {
  if (n._text) out.push(n._text);
  for (const k in n.attrs) out.push(n.attrs[k]);
  for (const k of ['href', 'src', 'alt', 'title']) if (n[k]) out.push(n[k]);
  n.children.forEach((c) => strings(c, out));
  return out;
};
for (const c of containers) {
  const root = c.find(has('owaf-v'));
  const b = btn(c);
  const links = c.findAll((n) => n.tagName === 'A');
  const brand = c.find(has('owaf-v-brand'));
  out[c.getAttribute('data-sitekey')] = {
    class: root.className,
    role: root.getAttribute('role'),
    region: root.getAttribute('aria-label'),
    states: root.log.states,
    texts: root.log.texts,
    live: c.find(has('owaf-v-status')).getAttribute('aria-live'),
    statusRole: c.find(has('owaf-v-status')).getAttribute('role'),
    props: root.style.props,
    button: {hidden: b.hidden, label: b.textContent, aria: b.getAttribute('aria-label')},
    box: {label: (c.find(has('owaf-v-ask')) || {}).textContent || '', type: (cbOf(c) || {}).type || ''},
    clicked: click[c.getAttribute('data-sitekey')] || null,
    posts: posts[c.getAttribute('data-sitekey')] || [],
    links: links.map((a) => ({href: a.href, target: a.target, rel: a.rel, text: a.textContent, aria: a.getAttribute('aria-label')})),
    icon: c.find((n) => n.tagName === 'SVG' && n.className === 'owaf-v-icon') !== null,
    brandClass: brand.className,
    images: c.findAll((n) => n.tagName === 'IMG').map((n) => ({src: n.src, alt: n.alt, class: n.className})),
    name: (c.find(has('owaf-v-brand-name')) || {}).textContent || '',
    marks: c.findAll(has('owaf-v-mark')).length,
    legal: c.findAll(has('owaf-v-legal')).reduce((n, l) => n + l.findAll((a) => a.tagName === 'A').length, 0),
    seps: c.findAll(has('owaf-v-sep')).map((n) => ({text: n.textContent, aria: n.getAttribute('aria-hidden'), links: n.findAll((a) => a.tagName === 'A').length})),
    strings: strings(root),
  };
}
console.log(JSON.stringify(out));
process.exit(0);
