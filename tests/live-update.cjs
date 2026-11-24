/* Updates without a new APK: checks the starter page (scripts/live-loader.html, built into
   www/index.html by `npm run build`) picks the right screens.
   Run after `npm run build`: node tests/live-update.cjs */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const WWW = path.join(__dirname, '..', 'www');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');
const APP = fs.readFileSync(path.join(WWW, 'app.html'), 'utf8');
const BUILT = +APP.match(/<meta name="ecd-build" content="(\d+)">/)[1];
const NATIVE = +APP.match(/<meta name="ecd-native" content="(\d+)">/)[1];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };
const DATA = {
  staff: { staff1: true },
  requests: { r1: { ref_no: 1201, status: 'new', company_id: 'c1', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Smith Co' }, items_text: '2 boxes', payment: 'prepaid', when: 'asap', created_at: Date.now() - 60000 } }
};
// A downloaded version: the packed screens with another build number (and a mark to tell them apart)
const version = (build, native = NATIVE, extra = '') => APP
  .replace(/<meta name="ecd-build" content="\d+">/, `<meta name="ecd-build" content="${build}">`)
  .replace(/<meta name="ecd-native" content="\d+">/, `<meta name="ecd-native" content="${native}">`)
  .replace('</body>', `<i id="live-mark" hidden>${build}</i>${extra}</body>`);

(async () => {
  const srv = http.createServer((req, res) => {
    const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://localhost:${srv.address().port}`; // localhost: Cache Storage needs a secure origin
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((f) => { window.__FAKE = f; }, { user: { uid: 'staff1', email: 'dana@ec.com' }, data: DATA });
  await ctx.route(/vendor\/firebase-/, (r) => r.fulfill({ contentType: 'text/javascript', body: /app-compat/.test(r.request().url()) ? FAKE : '' }));
  await ctx.route(/googleapis\.com|gstatic\.com|cloudfunctions\.net|raw\.githubusercontent\.com|api\.github\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const started = () => page.waitForFunction(() => { try { return S.loaded && !document.getElementById('view-app').hidden; } catch (e) { return false; } }, null, { timeout: 25000 });
  const running = () => page.evaluate(() => ({ build: RUN.build, live: RUN.live, mark: (document.getElementById('live-mark') || {}).textContent || '', mode: document.compatMode }));
  const putLive = (html) => page.evaluate(async (h) => { const c = await caches.open('ecd-live'); await c.put('live-app.html', new Response(h, { headers: { 'Content-Type': 'text/html' } })); }, html);
  try {
    // 1. Nothing downloaded: the packed screens
    await page.goto(`${base}/index.html`);
    await started();
    assert.deepStrictEqual(await running(), { build: BUILT, live: false, mark: '', mode: 'CSS1Compat' });

    // 2. A newer version downloaded: it runs, and says so once
    await putLive(version(BUILT + 1));
    await page.reload();
    await started();
    assert.deepStrictEqual(await running(), { build: BUILT + 1, live: true, mark: String(BUILT + 1), mode: 'CSS1Compat' });
    await page.waitForFunction((b) => localStorage.getItem('ecd_live_seen') === String(b), BUILT + 1); // "App updated" shown once
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('ecd_live_boot')), null, 'it said it started fine');

    // 3. A version that needs a newer APK: ignored
    await putLive(version(BUILT + 2, NATIVE + 1));
    await page.reload();
    await started();
    assert.deepStrictEqual(await running(), { build: BUILT, live: false, mark: '', mode: 'CSS1Compat' });

    // 4. Same or older than the packed screens: ignored
    await putLive(version(BUILT));
    await page.reload();
    await started();
    assert.strictEqual((await running()).live, false);

    // 5. A broken version (never starts): back to the packed screens within 15 s, and never again
    await putLive(version(BUILT + 3).replace(/<script>(?![\s\S]*<script>)/, '<script>throw new Error("broken on purpose");'));
    await page.reload();
    await started();
    const after = await running();
    assert.deepStrictEqual(after, { build: BUILT, live: false, mark: '', mode: 'CSS1Compat' }, 'fell back to the packed screens');
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ecd_live_bad'))), { [BUILT + 3]: 1 });
    await page.reload();
    await started();
    assert.strictEqual((await running()).live, false, 'the broken one stays skipped');

    // 6. The app finds a newer version online by itself: just opened and idle, so it switches at once
    const online = { build: BUILT + 5 };
    await ctx.unroute(/googleapis\.com|gstatic\.com|cloudfunctions\.net|raw\.githubusercontent\.com|api\.github\.com/);
    await ctx.route(/googleapis\.com|gstatic\.com|cloudfunctions\.net/, (r) => r.abort());
    let asked = 0, viaApi = 0, apiDown = false;
    // GitHub's API first (always fresh), raw files as the backup
    await ctx.route(/raw\.githubusercontent\.com\/ogpoopdogg\/dispatch\/live\/|api\.github\.com\/repos\/ogpoopdogg\/dispatch\/contents\//, (r) => {
      const u = r.request().url();
      if (/api\.github\.com/.test(u)) { if (apiDown) { r.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"message":"rate limit"}' }); return; } viaApi++; }
      asked++;
      if (/version\.json/.test(u)) r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ build: online.build, native: NATIVE }) });
      else r.fulfill({ contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: version(online.build) });
    });
    await page.evaluate(() => caches.delete('ecd-live'));
    await page.addInitScript(() => { window.__ecdLiveTest = true; });
    await page.reload();
    await page.waitForFunction((b) => { try { return RUN.build === b && S.loaded; } catch (e) { return false; } }, online.build, { timeout: 20000 });
    assert.deepStrictEqual(await running(), { build: online.build, live: true, mark: String(online.build), mode: 'CSS1Compat' });
    // Already the newest: Settings says so, and only the small version file is asked for
    const before = asked;
    await page.evaluate(() => { liveChecked = 0; return liveCheck(true); });
    assert.strictEqual(asked - before, 1, 'only version.json when nothing is newer');
    assert.strictEqual(await page.evaluate(() => liveWaiting), 0);
    assert.ok(viaApi >= 1, 'asks GitHub\'s API first, so a merge is seen at once');
    // The API says no (too many asks): the raw files still bring the update
    apiDown = true;
    online.build += 1;
    await page.evaluate(() => { window.liveSwitch = () => {}; liveChecked = 0; return liveCheck(true); });
    assert.strictEqual(await page.evaluate(() => liveWaiting), online.build, 'falls back to the raw files');

    assert.deepStrictEqual(errors.filter((e) => !/broken on purpose/.test(e)), []);
    console.log('live update test passed');
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
