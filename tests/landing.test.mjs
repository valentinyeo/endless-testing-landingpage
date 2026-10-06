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

function statusSample(source) {
  const terminal = source.match(/id="terminal"[\s\S]*?<code>([\s\S]*?)<\/code>/);
  assert.ok(terminal, 'terminal sample missing');
  const text = terminal[1].replace(/<[^>]+>/g, '');
  const marker = '$ et status';
  const at = text.indexOf(marker);
  assert.notEqual(at, -1, 'et status command missing from terminal');
  return text.slice(at + marker.length);
}

function assertStatusNamesWinner(source) {
  const line = statusSample(source).split('\n').map((item) => item.trim()).find((item) => {
    const named = item.match(/^winner:\s+(\S(?:.*\S)?)$/i);
    return Boolean(named) && named[1].toLowerCase() !== 'null';
  });
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
