/* Smoke test: opens the dispatch page in a headless browser with a fake Firebase
   (tests/fake-firebase.js) and checks the main screens work without script errors.
   Run: node tests/smoke.cjs        (needs: npm i -D playwright && npx playwright install chromium)
   SHOTS=dir node tests/smoke.cjs   also saves screenshots there. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firebase.js'), 'utf8');
const SHOTS = process.env.SHOTS || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };

const now = Date.now();
const today = new Date(); const pad = (n) => String(n).padStart(2, '0');
const tomorrow = new Date(now + 86400000);
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const STAFF = { uid: 'staff1', email: 'dana@ec.com' };
const DATA = {
  staff: { staff1: true },
  dispatch_contacts: { drivers: { d1: { name: 'Mike', phone: '2045550111' }, d2: { name: 'Sara', phone: '2045550122' } } },
  address_lookup: { 'Acme Supply': { address: '12 Main St', city: 'Brandon' } },
  requests: {
    r1: { ref_no: 1201, status: 'new', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Smith Co', address: '40 Park Ave' }, items_text: '2 boxes', payment: 'prepaid', when: 'asap', created_at: now - 25 * 60000 },
    r2: { ref_no: 1202, status: 'new', company_id: 'c2', company_name: 'Prairie Parts', pickup: { name: 'Prairie Parts', address: '9 Rosser Ave' }, delivery: { name: 'Dock 4', address: '1 Industrial Rd' }, items_text: '1 pallet 400 lbs', payment: 'collect', when: 'asap', created_at: now - 8 * 60000 },
    r3: { ref_no: 1203, status: 'new', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Lake Clinic', address: '5 Lake Rd' }, items_text: '3 boxes', payment: 'prepaid', when: 'scheduled', scheduled_for: day(tomorrow), created_at: now - 60 * 60000 },
    r4: { ref_no: 1190, status: 'dispatched', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Smith Co' }, items_text: '1 box', payment: 'prepaid', created_at: now - 3 * 3600000, dispatched_at: now - 2 * 3600000, dispatched_to: 'Mike' }
  },
  counters: { request_no: 1203 }
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function open(browser, base, fake) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((f) => { window.__FAKE = f; try { localStorage.clear(); } catch (e) { /* */ } }, fake);
  let served = false;
  await page.route(/gstatic\.com\/firebasejs/, (r) => { const body = served ? '' : FAKE; served = true; r.fulfill({ contentType: 'text/javascript', body }); });
  await page.route(/googleapis\.com|gstatic\.com\/(?!firebasejs)/, (r) => r.abort());
  // Playwright uses the route added last, so the general one goes first
  await page.route(/cloudfunctions\.net/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(/cloudfunctions\.net\/alertCheck/, (r) => r.fulfill({ contentType: 'application/json', body: '{"phones":2,"people":2}' }));
  await page.goto(`${base}/index.html`);
  return { page, errors };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `dispatch-${name}.png`) }); };

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    // Signed out: the sign-in screen
    {
      const { page, errors } = await open(browser, base, { user: null, data: DATA });
      await page.waitForSelector('#view-auth:not([hidden])');
      await page.click('[data-act=toggle-pw]');
      assert.strictEqual(await page.getAttribute('#auth-password', 'type'), 'text', 'show password works');
      assert.deepStrictEqual(errors, [], 'no script errors on the sign-in screen');
      await page.close();
    }
    // Signed in as staff
    const { page, errors } = await open(browser, base, { user: STAFF, data: DATA });
    await page.waitForSelector('#view-app:not([hidden]) .job');
    assert.strictEqual(await page.locator('#queue-list .job').count(), 2, 'two jobs waiting today');
    // 2.6 search and filter
    assert.ok(await page.isVisible('#queue-tools'), 'queue search shows with 2 or more jobs');
    await page.fill('#queue-q', 'prairie');
    await page.waitForFunction(() => document.querySelectorAll('#queue-list .job').length === 1);
    await page.fill('#queue-q', '');
    await page.click('[data-act=queue-filter][data-f=collect]');
    await page.waitForFunction(() => document.querySelectorAll('#queue-list .job').length === 1);
    await page.click('[data-act=queue-filter][data-f=all]');
    await page.waitForFunction(() => document.querySelectorAll('#queue-list .job').length === 2);
    // 2.5 a customer edit shows what changed
    await page.evaluate(() => { window.__fakeDb.put('requests/r1/pickup/address', '88 Victoria Ave'); window.__fakeDb.put('requests/r1/updated_at', Date.now()); });
    await page.waitForSelector('.job-changed');
    assert.match(await page.textContent('.job-changed'), /Pickup address \(was 12 Main St\)/);
    await page.click('[data-act=ack-all]').catch(() => {});
    await shot(page, 'queue');
    // 3.3 an open sheet is the only thing reachable
    await page.click('#queue-list .job [data-act=details] >> nth=0');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.ok(await page.evaluate(() => document.getElementById('view-app').inert), 'page behind the sheet is inert');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('view-app').inert);
    // 1.4 + Add +: a new customer can be added from the form
    await page.click('[data-act=new-dispatch]');
    await page.waitForSelector('#nd-pickup-name');
    await page.fill('#nd-pickup-name', 'Westman Tire');
    await page.waitForSelector('.ac-new .tag-add');
    assert.ok(await page.isVisible('#nd-pickup-add'), 'Add + shows next to New customer');
    assert.strictEqual(await page.getAttribute('#nd-pickup-name', 'aria-expanded'), 'true', 'combobox says the list is open');
    await page.waitForTimeout(900); // the form slides up once the (absent) keyboard times out
    await shot(page, 'new-customer');
    await page.click('#nd-pickup-add');
    assert.strictEqual(await page.textContent('#nd-pickup-tag'), 'Pick the address');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'nd-pickup-address', 'Add + moves on to the address');
    await page.fill('#nd-pickup-address', '200 18th St');
    await page.fill('#nd-pickup-city', 'Brandon');
    await page.click('#nd-delivery-name');
    await page.waitForFunction(() => window.__fakeDb.get('address_lookup/Westman Tire'));
    assert.strictEqual(await page.evaluate(() => window.__fakeDb.get('address_lookup/Westman Tire').address), '200 18th St');
    assert.strictEqual(await page.textContent('#nd-pickup-tag'), 'Saved');
    // A saved customer with a different address offers Update, and sending doesn't overwrite it
    await page.fill('#nd-delivery-name', 'Acme Supply');
    await page.click('.ac-item[data-name="Acme Supply"]');
    await page.fill('#nd-delivery-address', '3 Other Dock Rd');
    await page.waitForFunction(() => document.querySelector('#nd-delivery-add') && !document.querySelector('#nd-delivery-add').hidden);
    assert.strictEqual(await page.textContent('#nd-delivery-add'), 'Update address');
    await page.waitForTimeout(300);
    await shot(page, 'update-address');
    await page.click('[data-act=nd-save]');
    await page.waitForFunction(() => Object.values(window.__fakeDb.get('requests')).some((r) => r.source === 'dispatcher'));
    assert.strictEqual(await page.evaluate(() => window.__fakeDb.get('address_lookup/Acme Supply').address), '12 Main St', 'saved address not overwritten');
    // Settings: alert check
    await page.click('.tab[data-tab=settings]');
    await page.waitForFunction(() => /2 phones/.test((document.getElementById('alert-reach') || {}).textContent || ''));
    await shot(page, 'settings');
    assert.deepStrictEqual(errors, [], 'no script errors');
    console.log('dispatch smoke test passed');
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
