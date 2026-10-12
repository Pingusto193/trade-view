import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const lib of ['lwc', 'klc']) {
  for (const n of [10000]) {
    const runs = [];
    for (let k = 0; k < 3; k++) {
      const page = await browser.newPage({ viewport: { width: 820, height: 520 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(`${process.cwd()}/${lib}/index.html`).href);
      const r = await page.evaluate((n) => window.bench(n), n);
      if (errors.length) console.log(lib, 'ERR', errors);
      runs.push(r);
      await page.close();
    }
    const fp = runs.map(r => r.firstPaint.toFixed(0)).join('/');
    const sc = runs.map(r => `${r.scroll.median.toFixed(1)}|p95 ${r.scroll.p95.toFixed(1)}`).join(' ; ');
    console.log(lib, n, 'firstPaint ms', fp, 'scroll frame ms', sc, runs[0].updates2000 ? 'updates2000 ms ' + runs.map(r=>r.updates2000.toFixed(0)).join('/') : '', runs[0].overlays ? 'overlays: ' + runs[0].overlays.join(',') : '');
  }
}
await browser.close();
