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
// Dispatched 2 hours ago, but never before midnight: the Day summary shows today only, so early in the morning "2 hours ago" would be yesterday
const todayAt = Math.max(now - 2 * 3600000, new Date(new Date(now).setHours(0, 0, 0, 0)).getTime());
const today = new Date(); const pad = (n) => String(n).padStart(2, '0');
const tomorrow = new Date(now + 86400000);
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const STAFF = { uid: 'staff1', email: 'dana@ec.com' };
const DATA = {
  staff: { staff1: true },
  dispatch_contacts: { drivers: { d1: { name: 'Mike', phone: '2045550111' }, d2: { name: 'Sara', phone: '2045550122' } } },
  address_lookup: { 'Acme Supply': { address: '12 Main St', city: 'Brandon' } },
  companies: { c2: { name: 'Prairie Parts', owner_uid: 'u2', join_code: 'ABCDEFGH', address_book: { a1: { name: 'Rosser Warehouse', address: '50 Rosser Ave', city: 'Brandon' } } } },
  requests: {
    r1: { ref_no: 1201, status: 'new', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Smith Co', address: '40 Park Ave' }, items_text: '2 boxes', payment: 'prepaid', when: 'asap', created_at: now - 25 * 60000 },
    r2: { ref_no: 1202, status: 'new', company_id: 'c2', company_name: 'Prairie Parts', pickup: { name: 'Prairie Parts', address: '9 Rosser Ave' }, delivery: { name: 'Dock 4', address: '1 Industrial Rd' }, items_text: '1 pallet 400 lbs', payment: 'collect', when: 'asap', created_at: now - 8 * 60000 },
    r3: { ref_no: 1203, status: 'new', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Lake Clinic', address: '5 Lake Rd' }, items_text: '3 boxes', payment: 'prepaid', when: 'scheduled', scheduled_for: day(tomorrow), created_at: now - 60 * 60000 },
    r4: { ref_no: 1190, status: 'dispatched', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Smith Co' }, items_text: '1 box', payment: 'prepaid', created_at: todayAt - 3600000, dispatched_at: todayAt, dispatched_to: 'Mike' }
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
    assert.ok(await page.isHidden('#queue-tools'), 'search stays out of the way until asked for');
    await page.click('[data-act=queue-search]');
    assert.ok(await page.isVisible('#queue-tools'), 'the magnifier opens search and filters');
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
    // Small cards: no text box until Text is tapped
    {
      const card = '#queue-list .job[data-id=r2]';
      const ta = `${card} textarea[data-edit]`;
      assert.strictEqual(await page.locator(ta).count(), 0, 'the text is hidden on a small card');
      const send = await page.locator(`${card} [data-act=pick-driver]`).boundingBox();
      assert.ok(send.height >= 44, 'Send to driver is big enough for a thumb');
      await page.click(`${card} [data-act=job-text]`);
      assert.match(await page.inputValue(ta), /^Prairie Parts for Dock 4, 1 pallet 400 lbs, Collect$/, 'no space before the comma');
      // Address switch: None / Pickup / Delivery / Both, and Map link (pickup only)
      const mode = (m) => page.click(`${card} [data-act=addr-mode][data-mode=${m}]`);
      const seg = await page.locator(`${card} [data-act=addr-mode] >> nth=0`).boundingBox();
      assert.ok(seg.height >= 38, 'address switch is easy to hit');
      await mode('pickup');
      assert.match(await page.inputValue(ta), /^Prairie Parts \(9 Rosser Ave\) for Dock 4,/);
      await mode('delivery');
      assert.match(await page.inputValue(ta), /^Prairie Parts for Dock 4 \(1 Industrial Rd\),/);
      await mode('both');
      assert.match(await page.inputValue(ta), /^Prairie Parts \(9 Rosser Ave\) for Dock 4 \(1 Industrial Rd\),/);
      await page.click(`${card} [data-act=addr-map]`);
      assert.match(await page.inputValue(ta), /, https:\/\/maps\.google\.com\/\?q=9\+Rosser\+Ave$/, 'map link for the pickup at the end');
      assert.ok(await page.isHidden(`${card} [data-act=reset-edit]`), 'the switch alone is not a hand edit');
      // Remembered for the customer (shared with every dispatcher)
      await page.waitForFunction(() => { const p = window.__fakeDb.get('dispatch_settings/addr_prefs/c_c2'); return p && p.addr === 'both' && p.map === true; });
      await shot(page, 'card-open');
      // A hand-edited text gets the address and link taken out too
      await page.fill(ta, 'Prairie Parts (9 Rosser Ave) for Dock 4 (1 Industrial Rd), call ahead, https://maps.google.com/?q=9+Rosser+Ave');
      await mode('delivery');
      assert.strictEqual(await page.inputValue(ta), 'Prairie Parts for Dock 4 (1 Industrial Rd), call ahead, https://maps.google.com/?q=9+Rosser+Ave');
      await page.click(`${card} [data-act=addr-map]`);
      assert.strictEqual(await page.inputValue(ta), 'Prairie Parts for Dock 4 (1 Industrial Rd), call ahead');
      assert.strictEqual(await page.evaluate(() => textFor('r2', S.pending.r2)), 'Prairie Parts for Dock 4 (1 Industrial Rd), call ahead', 'what gets sent matches the box');
      await page.click(`${card} [data-act=reset-edit]`);
      await mode('off');
      assert.match(await page.inputValue(ta), /^Prairie Parts for Dock 4,/);
      await page.click(`${card} [data-act=job-text]`);
      assert.strictEqual(await page.locator(ta).count(), 0, 'Text closes again');
      // Opening it marks it seen for the customer
      await page.waitForFunction(() => !!window.__fakeDb.get('requests/r2/seen_at'));
      // ⋯ menu: Details, Schedule for later and Remove
      await page.click(`${card} [data-act=job-menu]`);
      await page.waitForSelector('#sheet:not([hidden]) .menu-list');
      assert.ok(await page.isVisible('.menu-list [data-act=schedule-later]'));
      assert.ok(await page.isVisible('.menu-list [data-act=remove]'));
      await shot(page, 'menu');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('view-app').inert);
    }
    // Messages: a customer's message shows on the card, and a quick reply answers it
    {
      await page.evaluate(() => window.__fakeDb.put('messages/m1', { rid: 'r1', company_id: 'c1', from: 'customer', text: 'Can you add a box?', at: Date.now(), by_uid: 'u9', by_name: 'Pat' }));
      await page.waitForSelector('#queue-list .job[data-id=r1] .chip.msg');
      // Like a new job: a banner over the bottom bar and a count on the Messages button
      await page.waitForSelector('#msg-banner:not([hidden])');
      assert.match(await page.textContent('#msg-banner'), /Message from Acme Supply about #1201/);
      assert.strictEqual((await page.textContent('#msg-badge')).trim(), '1');
      await shot(page, 'msg-banner');
      // One conversation per customer: messages about every pickup, each with its number
      await page.evaluate(() => window.__fakeDb.put('messages/m0', { rid: 'r3', company_id: 'c1', ref_no: 1203, from: 'dispatch', text: 'Booked for tomorrow.', at: Date.now() - 3600000, by_uid: 'staff1', by_name: 'dana' }));
      await page.click('#msg-banner');
      await page.waitForSelector('#sheet [data-msgs-view=thread] .msg.them');
      assert.strictEqual(await page.locator('#sheet .msg-ref').count(), 2, 'each message shows its pickup');
      assert.match(await page.textContent('#sheet .msg-list'), /#1203[\s\S]*#1201/);
      assert.strictEqual(await page.inputValue('#msg-about'), 'r1', 'the reply is about the pickup they asked about');
      assert.ok(await page.isHidden('#msg-banner'), 'banner goes once opened');
      assert.ok(await page.isHidden('#msg-badge'), 'count clears once opened');
      await page.click('#sheet .quick .chip-btn >> nth=1');
      await page.waitForFunction(() => Object.values(window.__fakeDb.get('messages')).some((m) => m.from === 'dispatch' && m.rid === 'r1' && m.company_id === 'c1'));
      await page.fill('#sheet .msg-form input', 'Same driver for both.');
      await page.press('#sheet .msg-form input', 'Enter');
      await page.waitForFunction(() => Object.values(window.__fakeDb.get('messages')).some((m) => m.text === 'Same driver for both.' && m.rid === 'r1'));
      await page.waitForTimeout(300);
      await shot(page, 'messages');
      // Back to the list of customers
      await page.click('[data-act=msg-list]');
      await page.waitForSelector('#sheet .msg-co');
      assert.match(await page.textContent('#sheet .msg-co'), /Acme Supply/);
      await shot(page, 'messages-list');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('view-app').inert);
      assert.strictEqual(await page.locator('#queue-list .job[data-id=r1] .chip.msg').count(), 0, 'read once opened');
      // Details: this pickup's messages, and a way to the whole conversation
      await page.click('#queue-list .job[data-id=r1] .route');
      await page.waitForSelector('#sheet .msgs .msg.them');
      await page.click('#sheet .msgs [data-act=open-msgs]');
      await page.waitForSelector('#sheet [data-msgs-view=thread]');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('view-app').inert);
    }
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
    // A saved customer's address is one grey line; Change + a new address asks "Save this one?"
    await page.fill('#nd-delivery-name', 'Acme');
    await page.click('.ac-item:has-text("Acme Supply")');
    assert.ok(await page.isVisible('#nd-delivery-line'), 'saved address shows as a grey line');
    assert.ok(await page.isHidden('#nd-delivery-box'), 'no address boxes for a saved customer');
    await page.click('#nd-delivery-line [data-act=nd-addr-edit]');
    await page.fill('#nd-delivery-address', '3 Other Dock Rd');
    await page.waitForSelector('#nd-delivery-diff:not([hidden])');
    assert.ok(await page.isHidden('#nd-delivery-add'), 'no Add + for a saved customer');
    // Tap buttons start on the usual answers; Prepaid flips to Collect; + Note opens just that box
    assert.match(await page.textContent('[data-x=items]'), /1 box/);
    assert.match(await page.textContent('[data-x=when]'), /Now/);
    await page.click('[data-act=nd-pay]');
    assert.match(await page.inputValue('#nd-text'), /, Collect/);
    await page.click('[data-x=notes]');
    assert.ok(await page.isVisible('#nd-notes') && await page.isHidden('#nd-x-po'), 'only the tapped one opens');
    await page.fill('#nd-notes', 'Back door');
    assert.match(await page.inputValue('#nd-text'), /Back door$/);
    // Tapping the buttons leaves the form where it is (it used to jump back to the top of Pickup)
    await page.click('[data-x=notes]');
    await page.evaluate(() => { const b = document.getElementById('sheet-body'); b.scrollTop = b.scrollHeight; });
    const keep = await page.evaluate(() => document.getElementById('sheet-body').scrollTop);
    assert.ok(keep > 20, 'the form can scroll');
    for (const sel of ['[data-x=items]', '[data-act=nd-qty][data-d="1"]', '[data-act=nd-pay]', '[data-act=nd-pay]']) {
      await page.tap(sel);
      await page.waitForTimeout(450);
      assert.ok(await page.evaluate(() => document.getElementById('sheet-body').scrollTop) >= keep - 5, `stays put after ${sel}`);
    }
    assert.ok(await page.isVisible('#nd-x-items'), 'the box button opens pieces');
    assert.match(await page.textContent('[data-x=items]'), /2 boxes/);
    await page.tap('[data-x=items]');
    // The driver text can be typed over, and that text is what gets used
    await page.fill('#nd-text', 'Acme for Rosser, rush please');
    assert.ok(await page.isVisible('[data-act=nd-text-reset]'), 'a way back to the automatic text');
    await page.click('[data-act=nd-pay]');
    await page.click('[data-act=nd-pay]');
    assert.strictEqual(await page.inputValue('#nd-text'), 'Acme for Rosser, rush please', 'typed text is kept');
    await page.click('[data-act=nd-text-reset]');
    assert.match(await page.inputValue('#nd-text'), /Back door$/);
    assert.ok((await page.locator('[data-act=nd-pick-driver]').boundingBox()).height >= 48, 'Send to driver is big');
    await page.waitForTimeout(300);
    await shot(page, 'update-address');
    // Save to queue is under the dots button
    await page.click('[data-act=nd-more]');
    await page.waitForSelector('#nd-more:not([hidden]) [data-act=nd-save]');
    await shot(page, 'nd-more');
    await page.click('#nd-more [data-act=nd-save]');
    await page.waitForFunction(() => Object.values(window.__fakeDb.get('requests')).some((r) => r.source === 'dispatcher'));
    assert.strictEqual(await page.evaluate(() => window.__fakeDb.get('address_lookup/Acme Supply').address), '12 Main St', 'saved address not overwritten');
    assert.strictEqual(await page.evaluate(() => Object.values(window.__fakeDb.get('requests')).find((r) => r.source === 'dispatcher').payment), 'collect');
    // Empty form: Send shakes the missing box red, no message needed
    await page.click('[data-act=new-dispatch]');
    await page.waitForSelector('#nd-pickup-name');
    await page.click('[data-act=nd-pick-driver]');
    await page.waitForSelector('#nd-pickup-name.invalid');
    assert.ok(await page.isHidden('#sp-title') || !(await page.isVisible('.sp.open')), 'send panel did not open');
    // Customers' own contacts show in the name box (staff only), and Later makes the button say the day
    await page.fill('#nd-pickup-name', 'Rosser');
    await page.waitForSelector('.ac-item.co');
    assert.match(await page.textContent('.ac-item.co'), /Prairie Parts/);
    await page.click('.ac-item.co');
    assert.match(await page.textContent('#nd-pickup-line'), /50 Rosser Ave/);
    // Now opens a calendar with Tomorrow on top; tapping the day again goes back to Now
    await page.click('[data-x=when]');
    await page.waitForSelector('#nd-cal .nd-cal-grid button');
    await page.waitForTimeout(800);
    await shot(page, 'nd-calendar');
    await page.click('#nd-cal .nd-cal-top [data-act=nd-cal-day]');
    assert.match(await page.textContent('[data-act=nd-save]'), /^Schedule for /);
    assert.ok(await page.isHidden('#nd-x-when'), 'the calendar closes once a day is picked');
    await shot(page, 'nd-later');
    await page.click('[data-x=when]');
    assert.match(await page.textContent('[data-x=when]'), /Now/);
    assert.ok(await page.isVisible('[data-act=nd-pick-driver]'), 'back to Send to driver');
    await page.click('[data-x=when]');
    await page.click('#nd-cal [data-act=nd-cal-mon][data-d="1"]');
    await page.click('#nd-cal .nd-cal-grid button:not([disabled]) >> nth=2');
    assert.match(await page.textContent('[data-act=nd-save]'), /^Schedule for /);
    await page.click('[data-x=when]');
    await page.click('[data-act=nd-reset]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('view-app').inert);
    // Settings: alert check
    await page.click('.tab[data-tab=settings]');
    await page.waitForFunction(() => /2 phones/.test((document.getElementById('alert-reach') || {}).textContent || ''));
    assert.ok(await page.isVisible('[data-act=edit-quick]'), 'quick replies in Settings');
    assert.ok(await page.isVisible('[data-nd-def=type]'), 'Settings picks how a new dispatch starts');
    await shot(page, 'settings');
    // Done: no "Load 20 more" when there's nothing older, and the day summary
    await page.click('.tab[data-tab=done]');
    await page.waitForSelector('#done-list .row');
    await page.waitForFunction(() => !document.querySelector('[data-act=load-more]'));
    await page.click('#panel-done [data-act=day-board]');
    await page.waitForSelector('#board .board-group');
    assert.match(await page.textContent('#board .board-head'), /Mike/);
    await shot(page, 'board');
    await page.keyboard.press('Escape');
    assert.deepStrictEqual(errors, [], 'no script errors');
    console.log('dispatch smoke test passed');
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
