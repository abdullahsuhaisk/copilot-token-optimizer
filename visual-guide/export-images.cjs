'use strict';
/**
 * Exports the README pictures (docs/images/*.png) from visual-guide/index.html.
 *
 * It takes 2x element screenshots with the installed Google Chrome through
 * playwright-core, which is installed in a temporary folder so that this
 * project gets no extra dependency:
 *
 *   cd "$(mktemp -d)" && npm init -y >/dev/null && npm i playwright-core
 *   NODE_PATH="$PWD/node_modules" node <repo>/visual-guide/export-images.cjs [name ...]
 *
 * Names: idea, pipeline, before-after, architecture, status-bar (default: all).
 * Run it again whenever the guide's diagrams or example numbers change. The
 * selectors below follow the guide's markup, so update them if that changes.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const repo = path.resolve(__dirname, '..');
const guideUrl = (lang) => 'file://' + path.join(repo, 'visual-guide', 'index.html') + '?lang=' + lang;
const outDir = path.join(repo, 'docs', 'images');
fs.mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);

// parts: [css, index] pairs whose union (plus padding) becomes the image.
const jobs = [
  { name: 'idea', langs: ['en', 'tr'], width: 1000, parts: [['#idea .lanes'], ['#idea figure']], hide: ['#idea figcaption'], viewBox: ['#idea figure svg', '0 24 1000 216'] },
  { name: 'pipeline', langs: ['en', 'tr'], width: 1100, parts: [['#optimizer .pipe']], strip: /\s*(Details in section 5\.|Ayrıntılar 5\. bölümde\.)/ },
  // 880px triggers the guide's single-column layout, so long code lines are not cut off.
  { name: 'before-after', langs: ['en', 'tr'], width: 880, parts: [['#optimizer .key'], ['#optimizer .diff', 0]] },
  { name: 'architecture', langs: ['en', 'tr'], width: 1000, parts: [['#architecture figure'], ['#architecture .chips']], hide: ['#architecture .grid'] },
  { name: 'status-bar', langs: ['en'], width: 1000, parts: [['#measuring .statusbar', 0], ['#measuring .statusbar', 1]], pad: 20, scale: 3 }
];

async function rectOf(page, css, index) {
  return page.locator(css).nth(index || 0).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  });
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), kb: Math.round(b.length / 1024) };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const job of jobs) {
      if (only.length && !only.includes(job.name)) continue;
      for (const lang of job.langs) {
        const context = await browser.newContext({
          viewport: { width: job.width, height: 1200 },
          deviceScaleFactor: job.scale || 2
        });
        const page = await context.newPage();
        await page.goto(guideUrl(lang), { waitUntil: 'load' });
        await page.addStyleTag({
          content: 'header.top{display:none!important} html,body{background:#fff!important} ' +
            (job.hide || []).map((s) => s + '{display:none!important}').join(' ')
        });
        await page.evaluate(() => document.fonts.ready);
        if (job.viewBox) {
          // Trim the empty band above the bars so the card is not airy.
          await page.evaluate(([selector, box]) => document.querySelector(selector).setAttribute('viewBox', box), job.viewBox);
        }
        if (job.strip) {
          // Edit text nodes only, so inline <code> formatting survives.
          await page.evaluate((source) => {
            const re = new RegExp(source);
            const walker = document.createTreeWalker(document.querySelector('#optimizer .pipe'), NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              n.nodeValue = n.nodeValue.replace(re, '');
            }
          }, job.strip.source);
        }
        await page.waitForTimeout(250);
        const actual = await page.evaluate(() => document.documentElement.lang);
        if (actual !== lang) throw new Error(`language mismatch: wanted ${lang}, page is ${actual}`);

        const rects = [];
        for (const [css, index] of job.parts) rects.push(await rectOf(page, css, index));
        const pad = job.pad || 16;
        const x0 = Math.max(0, Math.min(...rects.map((r) => r.x)) - pad);
        const y0 = Math.max(0, Math.min(...rects.map((r) => r.y)) - pad);
        const x1 = Math.max(...rects.map((r) => r.x + r.w)) + pad;
        const y1 = Math.max(...rects.map((r) => r.y + r.h)) + pad;

        const file = path.join(outDir, job.langs.length > 1 ? `${job.name}.${lang}.png` : `${job.name}.png`);
        await page.screenshot({ path: file, fullPage: true, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
        const s = pngSize(file);
        console.log(`${path.relative(repo, file)}  ${s.w}x${s.h}px  ${s.kb} KB`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('EXPORT FAILED:', error);
  process.exit(1);
});
