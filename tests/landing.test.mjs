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
  assert.equal(249 * 12, 2988);
  assert.equal((299 - 249) * 12, 600);
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

    const gap = await page.evaluate(() => {
      const logo = document.querySelector('.logo');
      const text = [...logo.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      const range = document.createRange();
      range.selectNodeContents(text);
      const textBox = range.getBoundingClientRect();
      const mark = logo.querySelector('span').getBoundingClientRect();
      return mark.left - textBox.right;
    });
    assert.ok(gap < 2, `logo gap is ${gap}px`);

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
        && heading.top >= header.bottom - 1;
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await open();
    await page.click('.nav-links a[href="#pricing"]');
    await page.waitForFunction(() => {
      const heading = document.querySelector('#pricing h2').getBoundingClientRect();
      const header = document.querySelector('header').getBoundingClientRect();
      return heading.top >= header.bottom - 1 && heading.bottom > header.bottom;
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
    await page.click('#billing-monthly');
    assert.equal(await page.locator('#price-amount').innerText(), '$299');
    assert.match(await page.locator('#price-subcopy').innerText(), /\$249\/mo/);
    assert.equal(await page.locator('#billing-monthly').getAttribute('aria-selected'), 'true');
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
    assert.match(commands, /\$ et login\n\$ et site add\n\$ et round start\n\$ et status/);
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
