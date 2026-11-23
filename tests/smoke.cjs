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

async function open(browser, base, fake, init) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (init) await page.addInitScript(init);
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
    await page.waitForSelector('#view-app:not([hidden]) .qrow');
    // The queue is a list of job buttons, oldest at the top; jobs nobody opened yet glow green
    assert.strictEqual(await page.locator('#queue-list .qrow').count(), 2, 'one button per waiting job');
    assert.strictEqual(await page.getAttribute('#queue-list .qrow >> nth=0', 'data-id'), 'r1', 'the oldest job at the top');
    assert.strictEqual(await page.locator('#queue-list .qrow.unseen').count(), 2, 'not opened yet: glowing');
    assert.match(await page.textContent('#queue-list .qrow >> nth=0'), /(Sun|Mon|Tue|Wed|Thu|Fri|Sat) [A-Z][a-z]{2} \d+/, 'submitted day of the week on the button');
    assert.match(await page.textContent('#queue-list .qrow >> nth=0'), /Customer/, 'customer requests are labelled');
    // The numbers sit in the pinned top bar
    assert.ok(await page.evaluate(() => !!document.querySelector('.app-head #qbar:not([hidden]) .kp-wait')), 'numbers are part of the pinned top');
    assert.match(await page.textContent('.kp-wait'), /2\s*waiting/i);
    // Tap a button: the job opens on the whole page, with Back to the list
    await page.click('#queue-list .qrow[data-id=r1]');
    await page.waitForSelector('#queue-list .job.full[data-id=r1]');
    assert.match(await page.textContent('#queue-list .job-when'), /Submitted\s*(Sun|Mon|Tue|Wed|Thu|Fri|Sat) [A-Z][a-z]{2} \d+/, 'day of the week on the card');
    assert.match(await page.textContent('#queue-list .src-band'), /Customer request/);
    assert.strictEqual(await page.locator('#queue-list [data-act=pick-driver] .caret').count(), 0, 'no little arrow on Send to driver');
    await page.waitForFunction(() => document.body.classList.contains('q-fit'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'no scrolling with a job on the page');
    assert.ok(await page.evaluate(() => document.querySelector('#queue-list [data-act=pick-driver]').getBoundingClientRect().bottom <= innerHeight), 'Send to driver on screen');
    // No Back to all jobs bar: the Waiting number has an arrow and pulses harder; one tap goes back
    assert.strictEqual(await page.locator('.qback, [data-act=q-back]').count(), 0, 'no Back to all jobs button');
    assert.ok(await page.evaluate(() => { const b = document.querySelector('#queue-kpis .kp-wait'); return b.classList.contains('back') && !!b.querySelector('.kp-arrow') && getComputedStyle(b).animationName.includes('kpBack'); }), 'Waiting shows a back arrow and pulses');
    assert.match(await page.textContent('#queue-kpis .kp-wait'), /2\s*all jobs/);
    await shot(page, 'waiting-back');
    await page.click('#queue-kpis .kp-wait', { force: true });
    await page.waitForSelector('#queue-list .qrow[data-id=r1]:not(.unseen)');
    assert.ok(await page.evaluate(() => !document.querySelector('#queue-kpis .kp-wait').classList.contains('back')), 'arrow gone on the list');
    // The phone's back also goes back to the list
    await page.evaluate(() => qShow('r2'));
    await page.waitForSelector('#queue-list .job.full[data-id=r2]');
    // The open job never slides under the numbers bar, even if something pushes the page down
    assert.strictEqual(await page.evaluate(() => history.scrollRestoration), 'manual');
    await page.evaluate(() => { const d = document.createElement('div'); d.id = 'tall'; d.style.height = '2000px'; document.querySelector('main.app-main').appendChild(d); window.scrollTo(0, 40); });
    await page.waitForFunction(() => window.scrollY === 0);
    assert.ok(await page.evaluate(() => { document.getElementById('tall').remove(); return document.querySelector('#queue-list .job.full').getBoundingClientRect().top >= document.getElementById('qbar').getBoundingClientRect().bottom; }), 'job top shows below the numbers bar');
    await page.goBack();
    await page.waitForSelector('#queue-list .qrow[data-id=r2]');
    assert.ok(await page.evaluate(() => !document.getElementById('view-app').hidden), 'still in the app');
    assert.strictEqual(await page.locator('#queue-list .qrow.unseen').count(), 0, 'opened once: no more glow (both opened now)');
    // A dispatcher's own job: their name (first letter capital) on the button, solid yellow side line
    await page.evaluate(() => window.__fakeDb.put('requests/r9', { ref_no: 1209, status: 'new', source: 'dispatcher', company_id: 'dispatcher', company_name: 'Dispatcher', requested_by: { name: 'dana', email: 'dana@ec.com' }, pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Smith Co', address: '40 Park Ave' }, items_text: '1 box', payment: 'prepaid', when: 'asap', created_at: Date.now() }));
    await page.waitForSelector('#queue-list .qrow[data-id=r9]');
    assert.strictEqual((await page.textContent('#queue-list .qrow[data-id=r9] .qr-src')).trim(), 'Dana', "the dispatcher's name, not 'Dispatcher'");
    assert.strictEqual(await page.locator('#queue-list .qrow[data-id=r9] .qr-src svg').count(), 0, 'no headset icon');
    assert.ok(await page.evaluate(() => !/gradient/.test(getComputedStyle(document.querySelector('#queue-list .qrow[data-id=r9]'), '::before').backgroundImage)), 'solid yellow, no stripes');
    await page.evaluate(() => qShow('r9'));
    await page.waitForSelector('#queue-list .job.full[data-id=r9]');
    assert.match(await page.textContent('#queue-list .src-band'), /made by Dana/);
    await page.click('#queue-kpis .kp-wait', { force: true });
    await page.evaluate(() => window.__fakeDb.put('requests/r9', null));
    await page.waitForFunction(() => document.querySelectorAll('#queue-list .qrow').length === 2);
    // The Queue button is the same size as the Dispatch button
    const tabSize = (q) => page.evaluate((s) => { const e = document.querySelector(s); return [e.offsetWidth, e.offsetHeight]; }, q);
    assert.deepStrictEqual(await tabSize('[data-tab=queue] .ti'), await tabSize('.tab-new .ti'), 'Queue button matches Dispatch');
    // The numbers bar stays on every page, and over Messages it still works
    for (const tb of ['scheduled', 'done', 'settings', 'queue']) {
      await page.evaluate((x) => switchTab(x), tb);
      assert.ok(await page.isVisible('.app-head #qbar .kp-wait'), `numbers bar on ${tb}`);
    }
    await page.click('#msg-btn');
    await page.waitForSelector('#sheet:not([hidden]) [data-msgs-view]');
    assert.ok(await page.evaluate(() => { const h = document.querySelector('.app-head').getBoundingClientRect(), sh = document.querySelector('#sheet .sheet').getBoundingClientRect(); return sh.top >= h.bottom - 1; }), 'Messages opens below the numbers bar');
    await page.click('.app-head .kp-sched');
    await page.waitForFunction(() => document.getElementById('sheet').hidden && !document.getElementById('panel-scheduled').hidden);
    // Who made it: a side strip on Scheduled cards (customer app here; a dispatcher job says Dispatcher)
    assert.strictEqual((await page.textContent('#scheduled-list .job[data-id=r3] .side-tag')).trim(), 'Customer app');
    assert.ok(await page.evaluate(() => /side-tag">Dispatcher</.test(jobCard('x', { ref_no: 1, source: 'dispatcher', company_id: 'dispatcher', company_name: 'Dispatcher', when: 'scheduled', scheduled_for: '2030-01-01', pickup: {}, delivery: {} }))));
    await page.evaluate(() => switchTab('queue'));
    // A done job's details: Group Chat and Send to driver
    await page.evaluate(() => openDetails('r4'));
    await page.waitForSelector('#sheet [data-act=resend-driver]');
    assert.ok(await page.isVisible('#sheet [data-act=recopy]:has-text("Group Chat")'));
    assert.match(await page.textContent('#sheet [data-act=resend-driver]'), /💬\s*Send to driver/);
    await page.click('#sheet [data-act=resend-driver]');
    await page.waitForSelector('#nd-pop:not([hidden]) #nd-pop-list [data-hold-driver]');
    assert.match(await page.textContent('#sp-title'), /Send #1190 again/);
    assert.match(await page.inputValue('#sp-textarea'), /Smith Co/, 'the done job\'s text is in the panel');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#nd-pop', { state: 'hidden' });
    // ⋯ menu: an emoji on every button, and the customer's whole request history with date filters
    await page.evaluate(() => jobMenu('r1'));
    await page.waitForSelector('#sheet .menu-list');
    assert.strictEqual(await page.locator('#sheet .menu-list button').count(), await page.locator('#sheet .menu-list button .em').count(), 'every ⋯ button has an emoji');
    await page.click('#sheet [data-act=cust-history]');
    await page.waitForSelector('#sheet .ch-row');
    assert.strictEqual(await page.locator('#sheet .ch-row').count(), 3, 'all of Acme Supply\'s requests in 30 days (waiting, scheduled and sent)');
    assert.match(await page.textContent('#sheet .ch-row[data-id=r4]'), /Sent to Mike/);
    await page.evaluate(() => window.__fakeDb.put('requests/r8', { ref_no: 1100, status: 'cancelled', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply' }, delivery: { name: 'Old Place' }, items_text: '1 box', payment: 'prepaid', created_at: Date.now() - 50 * 86400000 }));
    await page.evaluate(() => { CH.items = null; CH.cid = ''; openCustHistory('c1'); });
    await page.waitForSelector('#sheet .ch-row');
    assert.strictEqual(await page.locator('#sheet .ch-row').count(), 3, '30 days leaves out the 50-day-old one');
    await page.click('#sheet [data-act=ch-range][data-r="90"]');
    assert.strictEqual(await page.locator('#sheet .ch-row').count(), 4, '90 days has it');
    await page.click('#sheet [data-act=ch-range][data-r="7"]');
    assert.strictEqual(await page.locator('#sheet .ch-row').count(), 3);
    await page.click('#sheet [data-act=ch-range][data-r=custom]');
    const old = await page.evaluate(() => new Date(Date.now() - 50 * 86400000).toLocaleDateString('en-CA'));
    await page.fill('#ch-from', old); await page.dispatchEvent('#ch-from', 'change');
    await page.fill('#ch-to', old); await page.dispatchEvent('#ch-to', 'change');
    assert.strictEqual(await page.locator('#sheet .ch-row').count(), 1, 'one day only');
    assert.match(await page.textContent('#sheet .ch-row'), /Cancelled/);
    await page.click('#sheet [data-act=ch-range][data-r=all]');
    const wd = await page.evaluate(() => new Date(Date.now() - 50 * 86400000).getDay());
    await page.click(`#sheet [data-act=ch-day][data-d="${(wd + 1) % 7}"]`);
    assert.ok(await page.locator('#sheet .ch-row[data-id=r8]').count() === 0, 'weekday filter leaves out other days');
    await page.click(`#sheet [data-act=ch-day][data-d="${wd}"]`);
    assert.ok(await page.locator('#sheet .ch-row[data-id=r8]').count() === 1, 'and keeps the picked days');
    await shot(page, 'cust-history');
    await page.evaluate(() => window.__fakeDb.put('requests/r8', null));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
    // Removed and cancelled jobs also get Group Chat and Send to driver, above Move back to queue
    await page.evaluate(() => window.__fakeDb.put('requests/r7', { ref_no: 1177, status: 'removed', removed_at: Date.now(), removed_by_email: 'dana@ec.com', company_id: 'c1', company_name: 'Acme Supply', pickup: { name: 'Acme Supply', address: '12 Main St' }, delivery: { name: 'Park Road' }, items_text: '1 box', payment: 'prepaid', created_at: Date.now() - 600000 }));
    await page.waitForFunction(() => !!removedReq('r7'));
    await page.evaluate(() => openDetails('r7'));
    await page.waitForSelector('#sheet [data-act=resend-driver]');
    assert.ok(await page.evaluate(() => { const a = document.querySelector('#sheet .again-row').getBoundingClientRect(), b = document.querySelector('#sheet [data-act=restore]').getBoundingClientRect(); return a.bottom <= b.top; }), 'buttons above Move back to queue');
    await page.click('#sheet [data-act=resend-driver]');
    await page.waitForSelector('#nd-pop:not([hidden]) #nd-pop-list [data-hold-driver]');
    assert.match(await page.inputValue('#sp-textarea'), /Park Road/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#nd-pop', { state: 'hidden' });
    await page.evaluate(() => window.__fakeDb.put('requests/r7', null));
    // A scheduled job in the queue says when it was scheduled
    await page.evaluate(() => window.__fakeDb.put('requests/r6', { ref_no: 1206, status: 'new', company_id: 'c2', company_name: 'Prairie Parts', pickup: { name: 'Prairie Parts', address: '9 Rosser Ave' }, delivery: { name: 'Dock 4' }, items_text: '1 box', payment: 'prepaid', when: 'scheduled', scheduled_for: new Date().toLocaleDateString('en-CA'), created_at: Date.now() - 2 * 86400000 }));
    await page.waitForSelector('#queue-list .qrow[data-id=r6]');
    await page.evaluate(() => qShow('r6'));
    await page.waitForSelector('#queue-list .job.full[data-id=r6]');
    assert.match(await page.textContent('#queue-list .job-when'), /Scheduled on (Sun|Mon|Tue|Wed|Thu|Fri|Sat) [A-Z][a-z]{2} \d+, \d+:\d+/);
    await page.click('#queue-kpis .kp-wait', { force: true });
    // Send all to Group Chat: hold Waiting 1.2 s. Every job one line with a box, quick picks by day
    const hold = async (sel, ms) => { const bb = await page.locator(sel).boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); };
    await hold('#queue-kpis .kp-wait', 400);
    await page.waitForTimeout(1200);
    assert.ok(await page.evaluate(() => document.getElementById('sheet').hidden), 'a short press does not open it');
    await hold('#queue-kpis .kp-wait', 1400);
    await page.waitForSelector('#sheet .ga-row');
    assert.strictEqual(await page.locator('[data-act=group-all]').count(), 0, 'no Send all button on the pages any more');
    assert.strictEqual(await page.locator('#sheet .ga-row input:checked').count(), 3, 'queue: all ticked');
    await shot(page, 'group-all-queue');
    await page.locator('#sheet .ga-row:has-text("#1206") input').uncheck();
    assert.match(await page.textContent('#sheet [data-act=ga-copy]'), /Send 2 jobs to Group Chat/);
    await page.evaluate(() => { window.__copied = null; window.__launched = null; window.copySync = (t) => { window.__copied = t; return true; }; window.launch = (u) => { window.__launched = u; }; });
    await page.click('#sheet [data-act=ga-copy]');
    await page.waitForFunction(() => window.__launched);
    const copied = await page.evaluate(() => window.__copied);
    assert.strictEqual(copied.split('\n').length, 2, 'one line per ticked job');
    assert.ok(/^Acme Supply for Smith Co/.test(copied.split('\n')[0]) && /^Prairie Parts for Dock 4/.test(copied.split('\n')[1]), copied);
    assert.strictEqual(await page.evaluate(() => window.__launched), `sms:?body=${encodeURIComponent(copied)}`, 'opens Messages with the list typed in, no share menu');
    await page.waitForFunction(() => document.getElementById('sheet').hidden);
    assert.strictEqual(await page.locator('.qr-copied, .chip.copied, .ga-was').count(), 0, 'no Copied labels');
    await page.evaluate(() => window.__fakeDb.put('requests/r6', null));
    // Scheduled: hold Scheduled. The next day ticked; a day button ticks only that day
    await hold('#queue-kpis .kp-sched', 1400);
    await page.waitForSelector('#sheet .ga-row');
    assert.ok(await page.evaluate(() => !document.getElementById('panel-queue').hidden), 'holding does not switch pages');
    assert.strictEqual(await page.locator('#sheet .ga-row input:checked').count(), 1);
    assert.match(await page.textContent('#sheet .ga-picks'), /Tomorrow 1/);
    await page.click('#sheet [data-act=ga-day][data-day=none]');
    assert.strictEqual(await page.locator('#sheet .ga-row input:checked').count(), 0);
    assert.ok(await page.isDisabled('#sheet [data-act=ga-copy]'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.app-main').inert);
    // 2.6 search and filter
    assert.ok(await page.isHidden('#queue-tools'), 'search stays out of the way until asked for');
    await page.click('[data-act=queue-search]');
    assert.ok(await page.isVisible('#queue-tools'), 'the magnifier opens search and filters');
    await page.fill('#queue-q', 'prairie');
    await page.waitForFunction(() => document.querySelectorAll('#queue-list .qrow').length === 1);
    await page.fill('#queue-q', '');
    await page.click('[data-act=queue-filter][data-f=collect]');
    await page.waitForFunction(() => document.querySelectorAll('#queue-list .qrow').length === 1);
    await page.click('[data-act=queue-filter][data-f=all]');
    await page.waitForFunction(() => document.querySelectorAll('#queue-list .qrow').length === 2);
    await page.evaluate(() => qShow('r1'));
    // 2.5 a customer edit shows what changed
    await page.evaluate(() => { window.__fakeDb.put('requests/r1/pickup/address', '88 Victoria Ave'); window.__fakeDb.put('requests/r1/updated_at', Date.now()); });
    await page.waitForSelector('.job-changed');
    assert.match(await page.textContent('.job-changed'), /Pickup address \(was 12 Main St\)/);
    await page.click('[data-act=ack-all]').catch(() => {});
    await shot(page, 'queue');
    // The text is on every card, ready to edit (no pencil)
    {
      await page.evaluate(() => qShow('r2'));
      await page.waitForSelector('#queue-list .job[data-id=r2]');
      const card = '#queue-list .job[data-id=r2]';
      const ta = `${card} textarea[data-edit]`;
      assert.strictEqual(await page.locator(ta).count(), 1, 'the text is on the card');
      assert.strictEqual(await page.locator(`${card} [data-act=job-text]`).count(), 0, 'no pencil');
      // Polled: the queue can redraw right after Got it, and a card being redrawn has no size for a moment
      await page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && b.getBoundingClientRect().height >= 44; }, `${card} [data-act=pick-driver]`, { timeout: 5000 })
        .catch(() => assert.fail('Send to driver is big enough for a thumb'));
      assert.match(await page.inputValue(ta), /^Prairie Parts for Dock 4, 1 pallet 400 lbs, Collect$/, 'no space before the comma');
      // Address switch: folded into one small "Address: None" button on the card; tap it for the full row
      assert.strictEqual(await page.locator(`${card} [data-act=addr-mode]`).count(), 0, 'address row folded away on the card');
      assert.match(await page.textContent(`${card} [data-act=addr-open]`), /Address: None/);
      await page.click(`${card} [data-act=addr-open]`);
      // Address switch: None / Pickup / Delivery / Both, and Map link (pickup only)
      const mode = (m) => page.click(`${card} [data-act=addr-mode][data-mode=${m}]`);
      // Polled for the same reason as above: the card can be mid-redraw
      await page.waitForFunction((sel) => { const b = document.querySelector(sel); return b && b.getBoundingClientRect().height >= 38; }, `${card} [data-act=addr-mode]`, { timeout: 5000 })
        .catch(() => assert.fail('address switch is easy to hit'));
      await mode('pickup');
      assert.match(await page.inputValue(ta), /^Prairie Parts \(9 Rosser Ave\) for Dock 4,/);
      await mode('delivery');
      assert.match(await page.inputValue(ta), /^Prairie Parts for Dock 4 \(1 Industrial Rd\),/);
      await mode('both');
      assert.match(await page.inputValue(ta), /^Prairie Parts \(9 Rosser Ave\) for Dock 4 \(1 Industrial Rd\),/);
      assert.match(await page.textContent(`${card} [data-act=addr-open]`), /Address: Both/, 'the small button says what the text has');
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
      await page.click(ta);
      // Tapping into it marks it seen for the customer
      await page.waitForFunction(() => !!window.__fakeDb.get('requests/r2/seen_at'));
      // ⋯ menu: Details, Schedule for later and Remove
      await page.click(`${card} [data-act=job-menu]`);
      await page.waitForSelector('#sheet:not([hidden]) .menu-list');
      assert.ok(await page.isVisible('.menu-list [data-act=schedule-later]'));
      assert.ok(await page.isVisible('.menu-list [data-act=remove]'));
      await shot(page, 'menu');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
    }
    // Messages: a customer's message shows on the card, and a quick reply answers it
    {
      await page.evaluate(() => qShow('r1'));
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
      assert.strictEqual(await page.locator('#sheet .msg-list .msg-ref').count(), 2, 'the pickup shows once where it changes');
      assert.ok(await page.isVisible('#sheet-back'), 'back arrow in the title line');
      assert.match(await page.textContent('#sheet-sub'), /Waiting:[\s\S]*#1201/, 'their waiting pickups under the name');
      assert.match(await page.textContent('#sheet .msg-list'), /#1203[\s\S]*#1201/);
      assert.strictEqual(await page.inputValue('#msg-about'), 'r1', 'the reply is about the pickup they asked about');
      assert.ok(await page.isHidden('#msg-banner'), 'banner goes once opened');
      assert.ok(await page.isHidden('#msg-badge'), 'count clears once opened');
      // Read state is saved in the database as the message's own time, so it stays read after a reload
      // (even on a phone whose storage was wiped: the test page starts with empty storage)
      {
        const m1 = await page.evaluate(() => window.__fakeDb.get('messages/m1'));
        await page.waitForFunction((at) => { const r = window.__fakeDb.get('dispatch_settings/msg_read/staff1'); return r && r.r1 === at; }, m1.at)
          .catch(() => assert.fail('read mark saved with the message time'));
        const data2 = JSON.parse(JSON.stringify(DATA));
        data2.messages = { m1 };
        data2.dispatch_settings = Object.assign({}, data2.dispatch_settings, { msg_read: { staff1: await page.evaluate(() => window.__fakeDb.get('dispatch_settings/msg_read/staff1')) } });
        const again = await open(browser, base, { user: STAFF, data: data2 });
        await again.page.waitForSelector('#view-app:not([hidden]) .qrow');
        await again.page.waitForTimeout(400);
        assert.ok(await again.page.isHidden('#msg-badge'), 'a read message is not new again after a reload');
        assert.strictEqual(await again.page.locator('#queue-list .job[data-id=r1] .chip.msg').count(), 0, 'no "new message" on the card after a reload');
        assert.deepStrictEqual(again.errors, []);
        await again.page.close();
      }
      // A quick reply goes into the box (it doesn't send by itself); Enter sends it
      await page.click('#sheet .quick .chip-btn >> nth=1');
      assert.strictEqual(await page.inputValue('#sheet .msg-form textarea'), 'A driver is on the way.', 'quick reply fills the box');
      await page.press('#sheet .msg-form textarea', 'Enter');
      await page.waitForFunction(() => Object.values(window.__fakeDb.get('messages')).some((m) => m.from === 'dispatch' && m.rid === 'r1' && m.company_id === 'c1'));
      await page.fill('#sheet .msg-form textarea', 'Same driver for both.');
      await page.press('#sheet .msg-form textarea', 'Enter');
      await page.waitForFunction(() => Object.values(window.__fakeDb.get('messages')).some((m) => m.text === 'Same driver for both.' && m.rid === 'r1'));
      await page.waitForTimeout(150);
      assert.strictEqual(await page.inputValue('#sheet .msg-form textarea'), '', 'the box is empty after Send, so it can\u2019t be sent twice');
      assert.ok(!(await page.evaluate(() => document.activeElement && document.activeElement.matches('.msg-form textarea'))), 'keyboard goes away after Send');
      // A general message (not about a pickup): labelled General, and a reply goes back as general for this customer
      await page.evaluate(() => window.__fakeDb.put('messages/m5', { rid: 'general', company_id: 'c1', from: 'customer', text: 'Are you open Saturday?', at: Date.now(), by_uid: 'u9', by_name: 'Pat' }));
      await page.waitForFunction(() => /Are you open Saturday\?/.test(document.getElementById('sheet-body').textContent));
      assert.match(await page.textContent('#sheet .msg-list'), /General[\s\S]*Are you open Saturday/);
      assert.strictEqual(await page.inputValue('#msg-about'), 'general', 'the reply is about what they wrote: General');
      await page.fill('#sheet .msg-form textarea', 'Closed weekends.');
      await page.press('#sheet .msg-form textarea', 'Enter');
      await page.waitForFunction(() => Object.values(window.__fakeDb.get('messages')).some((m) => m.text === 'Closed weekends.' && m.rid === 'general' && m.company_id === 'c1' && m.from === 'dispatch'));
      await page.waitForTimeout(300);
      await shot(page, 'messages');
      // The newest message always sits at the bottom, fully in sight just above the typing bar
      await page.evaluate(() => { for (let i = 0; i < 14; i++) window.__fakeDb.put(`messages/x${i}`, { rid: 'r1', company_id: 'c1', from: i % 2 ? 'customer' : 'dispatch', text: `Older message number ${i} with a little more text so it wraps`, at: Date.now() - (20 - i) * 60000, by_uid: 'u9', by_name: 'Pat' }); });
      await page.waitForTimeout(300);
      const lastShown = () => page.evaluate(() => {
        const ms = [...document.querySelectorAll('#msg-list .msg')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const last = ms[ms.length - 1].getBoundingClientRect(), bar = document.querySelector('#sheet-body .msg-compose').getBoundingClientRect();
        return { gap: Math.round(bar.top - last.bottom), text: ms[ms.length - 1].textContent };
      });
      const shown = async (why) => { const r = await lastShown(); assert.ok(r.gap >= 0 && r.gap < 40, `${why}: newest message right above the typing bar (gap ${r.gap})`); return r; };
      await page.evaluate(() => window.__fakeDb.put('messages/x99', { rid: 'r1', company_id: 'c1', from: 'customer', text: 'Newest one', at: Date.now(), by_uid: 'u9', by_name: 'Pat' }));
      await page.waitForTimeout(300);
      assert.match((await shown('new message')).text, /Newest one/);
      await page.focus('#sheet .msg-form textarea');
      await page.setViewportSize({ width: 390, height: 500 });
      await page.waitForTimeout(500);
      await shown('keyboard up');
      await page.click('#sheet .quick .chip-btn >> nth=0');
      await page.click('#sheet .quick .chip-btn >> nth=1');
      await page.click('#sheet .quick .chip-btn >> nth=2');
      await page.waitForTimeout(300);
      await shown('quick replies grow the box');
      await page.fill('#sheet .msg-form textarea', '');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await shown('keyboard down');
      await page.evaluate(() => { document.getElementById('sheet-body').scrollTop = 0; });
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__fakeDb.put('messages/x100', { rid: 'r1', company_id: 'c1', from: 'customer', text: 'Even newer', at: Date.now() + 1000, by_uid: 'u9', by_name: 'Pat' }));
      await page.waitForTimeout(300);
      assert.match((await shown('a new message after scrolling up')).text, /Even newer/);
      await page.evaluate(() => { kbKnown = 0; try { localStorage.removeItem('ecd_kbh'); } catch (e) { /* */ } }); // the test keyboard above isn't a real one
      // Back to the list of customers
      await page.click('[data-act=msg-list]');
      await page.waitForSelector('#sheet .msg-co');
      assert.match(await page.textContent('#sheet .msg-co'), /Acme Supply/);
      await shot(page, 'messages-list');
      // A search left in the box never hides chats the next time Messages opens
      await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__fakeDb.put(`messages/y${i}`, { rid: 'general', company_id: `cx${i}`, from: 'dispatch', text: `Hello ${i}`, at: Date.now() - 5000, by_uid: 'staff1', by_name: 'dana' }); });
      await page.waitForSelector('#msg-q');
      await page.fill('#msg-q', 'zzzz');
      await page.waitForSelector('#sheet [data-act=msg-q-clear]');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
      await page.click('#msg-btn');
      await page.waitForSelector('#sheet .msg-co');
      assert.strictEqual(await page.inputValue('#msg-q'), '', 'search starts empty');
      assert.strictEqual(await page.locator('#sheet .msg-co').count(), 7, 'every chat shows');
      await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__fakeDb.put(`messages/y${i}`, null); });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
      assert.strictEqual(await page.locator('#queue-list .job[data-id=r1] .chip.msg').count(), 0, 'read once opened');
      // Details: this pickup's messages, and a way to the whole conversation
      assert.strictEqual(await page.locator('#queue-list .job[data-id=r1] .route[data-act]').count(), 0, 'tapping pickup/delivery does nothing (Details is in ⋯)');
      await page.evaluate(() => openDetails('r1'));
      await page.waitForSelector('#sheet .msgs .msg.them');
      // Keyboard up in the details: the typing bar sits right on top of it, title still in sight
      await page.focus('#sheet .msgs .msg-form textarea');
      await page.setViewportSize({ width: 390, height: 500 });
      await page.waitForTimeout(500);
      const kbChat = await page.evaluate(() => ({ below: Math.round(innerHeight - document.querySelector('#sheet .msgs .msg-form').getBoundingClientRect().bottom), head: Math.round(document.querySelector('#sheet .sheet-head').getBoundingClientRect().top) }));
      assert.ok(kbChat.below >= 0 && kbChat.below < 30, `details: typing bar right on top of the keyboard (${kbChat.below}px above it)`);
      assert.ok(kbChat.head >= 0, 'details: the title stays in sight');
      await page.evaluate(() => document.activeElement.blur());
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await page.evaluate(() => { kbKnown = 0; try { localStorage.removeItem('ecd_kbh'); } catch (e) { /* */ } }); // not a real keyboard
      await page.click('#sheet .msgs [data-act=open-msgs]');
      await page.waitForSelector('#sheet [data-msgs-view=thread]');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
    }
    // 3.3 an open sheet is the only thing reachable
    await page.evaluate(() => openDetails(document.querySelector('#queue-list .job').dataset.id));
    await page.waitForSelector('#sheet:not([hidden])');
    assert.ok(await page.evaluate(() => document.querySelector('.app-main').inert && document.querySelector('.tabbar').inert && !document.querySelector('.app-head').inert), 'page behind the sheet is inert, the numbers bar is not');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
    // New customer: a name that isn't saved shows "New customer +" and an address bar; it only saves once the address is ready
    await page.click('[data-act=new-dispatch]');
    await page.waitForSelector('#nd-pickup-name');
    await page.fill('#nd-pickup-name', 'Westman Tire');
    await page.waitForSelector('#nd-pickup-nc:not([hidden])');
    assert.ok(await page.isVisible('#nd-pickup-address'), 'an address bar opens under the name');
    assert.strictEqual(await page.getAttribute('#nd-pickup-nc-btn', 'aria-disabled'), 'true', 'New customer waits for the address');
    assert.strictEqual(await page.locator('.ac-new').count(), 0, 'no New customer row in the suggestions');
    await page.waitForTimeout(900); // the form slides up once the (absent) keyboard times out
    await shot(page, 'new-customer');
    await page.click('#nd-pickup-nc-btn', { force: true });
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'nd-pickup-address', 'New customer points at the address first');
    assert.ok(!(await page.evaluate(() => window.__fakeDb.get('address_lookup/Westman Tire'))), 'nothing saved without an address');
    await page.fill('#nd-pickup-address', '200 18th St');
    await page.fill('#nd-pickup-city', 'Brandon');
    await page.waitForSelector('#nd-pickup-nc-btn.ready');
    assert.ok(await page.isVisible('#nd-pickup-box') && await page.isHidden('#nd-pickup-line'), 'a new customer keeps the address box to tap');
    await page.click('#nd-pickup-nc-btn');
    await page.waitForFunction(() => window.__fakeDb.get('address_lookup/Westman Tire'));
    assert.strictEqual(await page.evaluate(() => window.__fakeDb.get('address_lookup/Westman Tire').address), '200 18th St');
    assert.strictEqual(await page.textContent('#nd-pickup-tag'), 'Saved');
    assert.ok(await page.isHidden('#nd-pickup-nc'), 'New customer goes away once saved');
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
    assert.strictEqual(await page.locator('#nd-more .addr-sw').count(), 0, 'the dots only hold Save to queue and Schedule');
    await page.click('[data-act=nd-more]');
    // Address in the text: its own button under "Driver gets"
    assert.match(await page.textContent('#nd-addr-chip'), /Address: None/);
    await page.click('#nd-addr-chip');
    await page.click('#nd-addr-row [data-act=nd-addr][data-mode=pickup]');
    assert.match(await page.textContent('#nd-addr-chip'), /Address: Pickup/);
    assert.match(await page.inputValue('#nd-text'), /\(/, 'the pickup address is in the text');
    await page.click('#nd-addr-row [data-act=nd-addr][data-mode=off]');
    await page.click('#nd-addr-chip');
    assert.ok(await page.isHidden('#nd-addr-row'));
    await page.click('[data-act=nd-more]');
    await page.waitForSelector('#nd-more:not([hidden]) [data-act=nd-save]');
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
    await page.click('#sheet-reset');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
    // Settings: alert check
    await page.click('#set-btn');
    await page.waitForFunction(() => /2 phones/.test((document.getElementById('alert-reach') || {}).textContent || ''));
    assert.ok(await page.isVisible('[data-act=edit-quick]'), 'quick replies in Settings');
    assert.ok(await page.isVisible('[data-nd-def=type]'), 'Settings picks how a new dispatch starts');
    await shot(page, 'settings');
    // Days closed: a weekday is closed with a reason; a holiday can be opened; both go back to normal
    {
      await page.waitForSelector('#cal-box');
      for (let i = 0; i < 14 && !(await page.evaluate(() => calMonth.getMonth() === 11)); i++) await page.click('[data-act=cal-move][data-n="1"]');
      const yr = await page.evaluate(() => calMonth.getFullYear());
      const xmas = `${yr}-12-25`;
      assert.match(await page.getAttribute(`.cal-day[data-day="${xmas}"]`, 'class'), /closed/, 'Christmas is closed already');
      const weekday = await page.evaluate((y) => { for (let d = 1; d < 24; d++) { const ds = `${y}-12-${String(d).padStart(2, '0')}`; if (!dayState(ds).closed && ds > todayStr()) return ds; } return null; }, yr);
      await page.click(`.cal-day[data-day="${weekday}"]`);
      await page.fill('#cal-note', 'Staff training');
      await page.click('form[data-cal-close] button');
      await page.waitForFunction((ds) => { const v = window.__fakeDb.get(`shop_calendar/${ds}`); return v && v.closed === true && v.note === 'Staff training'; }, weekday);
      await page.waitForFunction((ds) => /closed/.test(document.querySelector(`.cal-day[data-day="${ds}"]`).className), weekday);
      await page.click(`.cal-day[data-day="${xmas}"]`);
      await page.click('[data-act=cal-open]');
      await page.waitForFunction((ds) => { const v = window.__fakeDb.get(`shop_calendar/${ds}`); return v && v.closed === false; }, xmas);
      await page.click(`.cal-day[data-day="${xmas}"]`);
      await page.click('[data-act=cal-reset]');
      await page.waitForFunction((ds) => window.__fakeDb.get(`shop_calendar/${ds}`) === null, xmas);
      // A customer asks to delete their account: it's listed until staff tap Done
      await page.evaluate(() => window.__fakeDb.put('deletion_requests/cu9', { at: Date.now(), email: 'gone@acme.ca', name: 'Gone Person', company_name: 'Acme' }));
      await page.waitForSelector('[data-act=del-done][data-uid=cu9]');
      await page.click('[data-act=del-done][data-uid=cu9]');
      await page.click('#sheet-body [data-c="1"]');
      await page.waitForFunction(() => window.__fakeDb.get('deletion_requests/cu9') === null);
      await page.keyboard.press('Escape').catch(() => {});
    }
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
    // Send to driver: a long driver list scrolls, and vans picked in Timeclock show even without GPS
    {
      const data3 = JSON.parse(JSON.stringify(DATA));
      const names = ['Mike', 'Mike Jones', 'Sara', 'Jen', 'Tom', 'Kim', 'Ann', 'Bob', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'].concat(Array.from({ length: 16 }, (_, i) => `Extra${i + 1}`));
      data3.dispatch_contacts.drivers = Object.fromEntries(names.map((n, i) => [`d${i}`, { name: n, phone: `20455501${String(i).padStart(2, '0')}` }]));
      data3.developer = { dispatch_dashboard: {
        drivers: { g1: { name: 'Van 1', color: '#e8590c', lastLocation: { lat: 49.85, lng: -99.95 } }, g4: { name: 'Van 4', color: '#1c7ed6' } },
        driver_nicknames: { g1: 'Mike' } } };
      data3.timeclock = {
        vans: { van_9: { name: 'Van 9' } },
        vehicle_claims: {
          g1: { ek: 'mike', name: 'Mike Smith', nickname: 'Mike', vehicleName: 'Van 1' },
          van_9: { ek: 'sara', name: 'Sara Lee', nickname: 'Sara', vehicleName: 'Van 9' },
          g4: { ek: 'jen', name: 'Jen Roy', nickname: 'Jen', vehicleName: 'Van 4' },
          van_7: { ek: 'kim', name: 'Kim Day', nickname: 'Kim', vehicleName: 'Van 7', at: Date.now() - 20 * 3600000 } } };
      const p3 = await open(browser, base, { user: STAFF, data: data3 });
      const pg = p3.page;
      await pg.waitForSelector('#view-app:not([hidden]) .qrow');
      await pg.evaluate(() => qShow('r2'));
      await pg.click('#queue-list .job[data-id=r2] [data-act=pick-driver]');
      await pg.waitForSelector('#nd-pop-list [data-hold-driver]');
      await pg.waitForTimeout(500);
      const sub = (n) => pg.evaluate((nm) => { const b = [...document.querySelectorAll('#nd-pop-list [data-hold-driver]')].find((x) => (x.querySelector('.drv-name > span') || x.querySelector('.drv-name')).textContent === nm); return b && b.querySelector('small').textContent; }, n);
      assert.match(await sub('Mike'), /^Van 1$/, 'GPS van');
      assert.match(await sub('Sara'), /^Van 9 · no GPS$/, 'van with no GPS unit, picked in Timeclock');
      assert.match(await sub('Jen'), /^Van 4 · no GPS$/, 'GPS van that has no position yet');
      assert.match(await sub('Tom'), /^No van today$/);
      assert.match(await sub('Mike Jones'), /^No van today$/, "two Mikes: the other Mike doesn't get Mike's van");
      assert.match(await sub('Kim'), /^No van today$/, 'a van picked 20 hours ago (forgot to punch out) is ignored');
      assert.strictEqual(await pg.locator('#nd-pop-list .pick-note').count(), 0, 'no hint under the drivers');
      // Order: the closest driver is the first button (top left), then the next closest; no GPS, then no van, last
      const order = await pg.evaluate(() => {
        sp.at = { lat: 49.85, lng: -99.0 };
        sp.vans.g2 = { name: 'Van 2', color: '#2f9e44', lastLocation: { lat: 49.85, lng: -99.1 } }; // ~7 km
        sp.vans.g3 = { name: 'Van 3', color: '#ae3ec9', lastLocation: { lat: 49.85, lng: -99.5 } }; // ~36 km
        sp.claims.g2 = { name: 'Bob', nickname: 'Bob', vehicleName: 'Sprinter 12' };
        sp.claims.g3 = { name: 'Ann', nickname: 'Ann', vehicleName: 'Van 3' };
        sp.order = '';
        spRender();
        return [...document.querySelectorAll('#nd-pop-list [data-hold-driver]')].map((b) => b.querySelector('.drv-name > span').textContent);
      });
      assert.deepStrictEqual(order.slice(0, 3), ['Bob', 'Ann', 'Mike'], `closest first: ${order.slice(0, 5)}`);
      assert.deepStrictEqual(order.slice(3, 5).sort(), ['Jen', 'Sara'], 'vans with no GPS next');
      assert.ok(order.indexOf('Tom') > 4, 'drivers with no van after every van');
      await shot(pg, 'send-closest-first');
      // Every letter fits inside each driver button (text shrinks only as needed); the distance is one line
      const fit = await pg.evaluate(() => [...document.querySelectorAll('#nd-pop-list [data-hold-driver]')].flatMap((b) =>
        [b.querySelector('.drv-name > span'), b.querySelector('.grow > small'), b.querySelector('.drv-d')].filter(Boolean)
          .filter((el) => el.scrollWidth > el.clientWidth + 0.5 && parseFloat(getComputedStyle(el).fontSize) > 10).map((el) => el.textContent)));
      assert.deepStrictEqual(fit, [], 'text that does not fit has shrunk to the smallest size (fonts differ between machines)');
      const bob = await pg.evaluate(() => { const b = document.querySelector('#nd-pop-list [data-hold-driver]'); return { km: b.querySelector('.drv-km').innerText.trim(), van: parseFloat(b.querySelector('.grow > small').style.fontSize) || 0, name: b.querySelector('.drv-name > span').style.fontSize }; });
      assert.ok(/^CLOSEST\s+7\.2 km$/i.test(bob.km), `one line of km, no drive time: ${JSON.stringify(bob.km)}`);
      assert.ok(bob.van >= 10 && bob.van < 13, `long van name shrinks to fit (${bob.van}px)`);
      assert.strictEqual(bob.name, '', 'a short name keeps its full size');
      assert.ok(await pg.locator('#nd-pop-list [data-hold-driver]').first().evaluate((b) => b.classList.contains('best') && /Closest/.test(b.textContent)), 'the first button wears the Closest tag');
      // A job scheduled for later: its time is not coloured green or red
      assert.ok(await pg.evaluate(() => { const h = jobCard('r3', S.pending.r3); return /class="job-age" data-noage/.test(h); }), 'no red/green time on a scheduled job');
      // A quick tap on a driver whose van has no GPS says so
      const sara = pg.locator('#nd-pop-list [data-hold-driver]', { hasText: 'Sara' });
      await sara.scrollIntoViewIfNeeded();
      await sara.click();
      await pg.waitForSelector('.toast:has-text("Van 9 has no GPS yet")');
      const box = await pg.evaluate(() => { const l = document.getElementById('nd-pop-list'); const r = l.querySelector('[data-hold-driver]'); return { sh: l.scrollHeight, ch: l.clientHeight, ta: getComputedStyle(r).touchAction }; });
      assert.ok(box.sh > box.ch, '30 drivers: the list is taller than its box (so it has to scroll)');
      assert.strictEqual(box.ta, 'pan-y', 'a finger can drag the list');
      assert.strictEqual(await pg.evaluate(() => getComputedStyle(document.querySelector('#nd-pop-list .drv-list')).gridTemplateColumns.split(' ').length), 2, 'drivers in a grid of 2 on a phone');
      const lb = await pg.locator('#nd-pop-list').boundingBox();
      await pg.mouse.move(lb.x + lb.width / 2, lb.y + 20);
      await pg.evaluate(() => { document.getElementById('nd-pop-list').scrollTop = 0; });
      await pg.mouse.wheel(0, 400);
      await pg.waitForFunction(() => document.getElementById('nd-pop-list').scrollTop > 0).catch(() => assert.fail('the driver list scrolls'));
      await shot(pg, 'send-scroll');
      // Full map: the map takes the panel; Back (or the button) brings the drivers back, the panel stays open
      await pg.click('[data-act=sp-full]');
      assert.ok(await pg.isHidden('#nd-pop-list'), 'drivers hidden while the map is full');
      const mh = await pg.evaluate(() => document.querySelector('.sp-map').getBoundingClientRect().height);
      assert.ok(mh > 600, `map fills the panel (${mh}px)`);
      assert.ok(await pg.isVisible('.sp-fvan:has-text("Mike")'), 'a button for each driver whose van is on the map');
      await shot(pg, 'send-fullmap');
      await pg.goBack();
      await pg.waitForSelector('#nd-pop-list', { state: 'visible' });
      assert.ok(await pg.isVisible('#nd-pop'), 'Back leaves the full map, the panel stays');
      await pg.click('[data-act=sp-full]');
      await pg.click('[data-act=sp-full]');
      await pg.waitForSelector('#nd-pop-list', { state: 'visible' });
      await pg.click('[data-act=sp-full]');
      await pg.click('#nd-pop .sp-head [data-act=nd-pop-close]');
      await pg.waitForFunction(() => document.getElementById('nd-pop').hidden);
      assert.deepStrictEqual(p3.errors, []);
      await pg.close();
    }
    // Live GPS check: driver buttons stay locked under a spinner until fresh spots come back,
    // then a van whose spot is old shows its age; if the GPS never answers they open with a warning
    {
      const data4 = JSON.parse(JSON.stringify(DATA));
      data4.dispatch_contacts.drivers = { d1: { name: 'Mike', phone: '2045550101' }, d2: { name: 'Sara', phone: '2045550102' }, d3: { name: 'Tom', phone: '2045550103' } };
      const t = Date.now();
      data4.developer = { dispatch_dashboard: {
        drivers: { g1: { name: 'Van 1', color: '#e8590c', lastLocation: { lat: 49.85, lng: -99.95, updatedAt: t - 20000 } },
          g2: { name: 'Van 2', color: '#2f9e44', lastLocation: { lat: 49.86, lng: -99.9, updatedAt: t - 25 * 60000 } } },
        driver_nicknames: { g1: 'Mike', g2: 'Sara' } } };
      const p4 = await open(browser, base, { user: STAFF, data: data4 });
      const pg = p4.page;
      let answer = { status: 200, contentType: 'application/json', body: '{"paj":"polled","fleethunt":"recent"}' };
      // The GPS answer is held back until the test lets it go (so a slow machine can't race it)
      let polls = 0, release = null;
      let gate = new Promise((ok) => { release = ok; });
      await pg.route(/cloudfunctions\.net\/pollNow/, async (r) => { polls++; await gate; r.fulfill(answer).catch(() => {}); });
      await pg.waitForSelector('#view-app:not([hidden]) .qrow');
      await pg.evaluate(() => { window.__sent = []; const real = window.sendToDriver; window.sendToDriver = (id, did) => { window.__sent.push(did); }; });
      await pg.evaluate(() => qShow('r2'));
      await pg.click('#queue-list .job[data-id=r2] [data-act=pick-driver]');
      await pg.waitForSelector('#nd-pop-list [data-hold-driver]');
      assert.ok(await pg.evaluate(() => document.querySelector('.sp-card').classList.contains('gps-wait')), 'buttons locked while GPS loads');
      assert.match(await pg.textContent('#sp-gps'), /Getting live GPS/);
      await shot(pg, 'send-gps-wait');
      // Holding a driver while it loads sends nothing and says why
      await pg.waitForTimeout(400); // the panel finishes sliding up
      const btn = pg.locator('#nd-pop-list [data-hold-driver]').first();
      const bb = await btn.boundingBox();
      await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await pg.mouse.down();
      await pg.waitForTimeout(800);
      await pg.mouse.up();
      await pg.waitForSelector('.toast:has-text("Getting live GPS first")');
      assert.ok(!(await btn.evaluate((b) => b.classList.contains('holding') || b.classList.contains('held'))), 'no hold ring while locked');
      assert.deepStrictEqual(await pg.evaluate(() => window.__sent), [], 'nothing sent while locked');
      release();
      // GPS answers: unlocked, a small "Live" in the top line (no green pill over the buttons)
      await pg.waitForFunction(() => !document.querySelector('.sp-card').classList.contains('gps-wait'), null, { timeout: 5000 });
      assert.strictEqual((await pg.textContent('#sp-gps')).trim(), 'Live');
      assert.ok(await pg.evaluate(() => !!document.querySelector('.sp-head #sp-gps') && !document.querySelector('.gps-pill')), 'status sits in the top line');
      const sub = (n) => pg.evaluate((nm) => { const b = [...document.querySelectorAll('#nd-pop-list [data-hold-driver]')].find((x) => x.querySelector('.drv-name > span').textContent === nm); return { t: b.querySelector('small').textContent, old: b.classList.contains('gps-old') }; }, n);
      assert.deepStrictEqual(await sub('Mike'), { t: 'Van 1', old: false }, 'a fresh spot shows no age');
      assert.deepStrictEqual(await sub('Sara'), { t: 'Van 2 · 25 min old', old: true }, 'an old spot shows its age');
      await shot(pg, 'send-gps-live');
      // After loading, a hold sends
      await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await pg.mouse.down();
      await pg.waitForTimeout(900);
      await pg.mouse.up();
      await pg.waitForFunction(() => window.__sent.length === 1 && document.getElementById('nd-pop').hidden, null, { timeout: 3000 });
      assert.deepStrictEqual(await pg.evaluate(() => window.__sent), ['d1'], 'the held driver got the text');
      // GPS fails: the buttons open with a warning and every van's spot age
      answer = { status: 500, body: 'no' };
      await pg.waitForTimeout(300);
      await pg.evaluate(() => qShow('r1'));
      await pg.click('#queue-list .job[data-id=r1] [data-act=pick-driver]').catch(() => pg.click('#queue-list .job [data-act=pick-driver]'));
      await pg.waitForSelector('#nd-pop:not([hidden]) #nd-pop-list [data-hold-driver]');
      await pg.waitForFunction(() => !document.querySelector('.sp-card').classList.contains('gps-wait'), null, { timeout: 5000 });
      assert.match(await pg.textContent('#sp-gps'), /No live GPS/);
      assert.match((await sub('Mike')).t, /^Van 1 · (just now|\d min old)$/, 'with no live GPS every van shows its age');
      await shot(pg, 'send-gps-failed');
      assert.ok(polls >= 2, 'asked for GPS each time the panel opened');
      assert.deepStrictEqual(p4.errors, []);
      await pg.close();
    }
    // Keyboard up (the window shrinks): Pickup's name box and then Delivery's sit in the same spot right on it,
    // typing a new name doesn't move it, and the pieces' Done button stays above the keyboard
    {
      const p4 = await open(browser, base, { user: STAFF, data: DATA });
      const pg = p4.page;
      await pg.waitForSelector('#view-app:not([hidden]) .qrow');
      await pg.click('[data-act=new-dispatch]');
      await pg.waitForSelector('#nd-pickup-name');
      await pg.waitForTimeout(500);
      await pg.setViewportSize({ width: 390, height: 500 });
      await pg.waitForTimeout(700);
      const bottom = (sel) => pg.evaluate((q) => Math.round(document.querySelector(q).getBoundingClientRect().bottom), sel);
      const p0 = await bottom('#nd-pickup-name');
      assert.ok(p0 <= 500 && p0 >= 470, `Pickup sits right on the keyboard (${p0})`);
      await pg.type('#nd-pickup-name', 'Ac');
      await pg.waitForTimeout(600);
      assert.ok(Math.abs(await bottom('#nd-pickup-name') - p0) <= 2, "typing a saved name doesn't move the box");
      // A name nobody has: the New customer button and the address bar come up above the keyboard too
      await pg.fill('#nd-pickup-name', 'Westman Tire');
      await pg.waitForTimeout(900);
      await shot(pg, 'new-customer-keyboard');
      const nb = await bottom('#nd-pickup-nc-btn'), ab = await bottom('#nd-pickup-address');
      assert.ok(nb <= 500 && ab <= 500, `New customer (${nb}) and the address bar (${ab}) are above the keyboard`);
      assert.ok(await bottom('#nd-pickup-name') < ab, 'the name box sits above them');
      await pg.fill('#nd-pickup-name', 'Acme');
      await pg.click('.ac-item:has-text("Acme Supply")');
      await pg.waitForTimeout(900);
      assert.strictEqual(await pg.evaluate(() => document.activeElement.id), 'nd-delivery-name');
      const d0 = await bottom('#nd-delivery-name');
      assert.ok(Math.abs(d0 - p0) <= 3, `Delivery lands where Pickup was (${d0} vs ${p0})`);
      // Both places in: straight on to the weight (number pad); the form only grew, it never shrank
      const top1 = await pg.evaluate(() => document.querySelector('#sheet .sheet').getBoundingClientRect().top);
      await pg.type('#nd-delivery-name', 'Ross');
      await pg.click('.ac-item:has-text("Rosser Warehouse")');
      await pg.waitForTimeout(900);
      assert.strictEqual(await pg.evaluate(() => document.activeElement.matches('[data-nd-wt="0"]')), true, 'cursor goes to the weight');
      const done = await bottom('[data-act=nd-done]');
      assert.ok(done <= 500 && done > 300, `Done is above the keyboard (${done})`);
      assert.ok(await pg.evaluate(() => document.querySelector('#sheet .sheet').getBoundingClientRect().top) <= top1, 'the form grows as it is filled');
      // The number pad closes while the list of kinds is open: nothing moves
      const wt = await bottom('[data-nd-wt="0"]');
      await pg.evaluate(() => document.querySelector('[data-nd-type="0"]').focus());
      await pg.setViewportSize({ width: 390, height: 844 });
      await pg.waitForTimeout(900);
      assert.ok(Math.abs(await bottom('[data-nd-wt="0"]') - wt) <= 2, 'the weight stays put when the number pad closes for the list');
      await pg.selectOption('[data-nd-type="0"]', 'pallet');
      await pg.setViewportSize({ width: 390, height: 500 });
      await pg.waitForTimeout(900);
      assert.ok(Math.abs(await bottom('[data-nd-wt="0"]') - wt) <= 2, 'and when it opens again');
      // Done: the keyboard goes, the form keeps its top and Send to driver is at the bottom
      const topK = await pg.evaluate(() => document.querySelector('#sheet .sheet').getBoundingClientRect().top);
      await pg.click('[data-act=nd-done]');
      await pg.setViewportSize({ width: 390, height: 844 });
      await pg.waitForTimeout(900);
      assert.ok(Math.abs(await pg.evaluate(() => document.querySelector('#sheet .sheet').getBoundingClientRect().top) - topK) <= 2, "the form doesn't shrink back after Done");
      assert.ok(await bottom('[data-act=nd-pick-driver]') > 700, 'Send to driver at the bottom');
      assert.deepStrictEqual(p4.errors, []);
      await pg.close();
    }
    // The mic: a spoken dispatch fills the form in as it's said; with the cursor in a text box the words go there
    {
      const fakeSpeech = () => {
        window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { window.__rec = this; } stop() { setTimeout(() => this.onend && this.onend(), 10); } abort() {} };
        window.__say = (t, final) => { const r = window.__rec; const res = [Object.assign([{ transcript: t }], { isFinal: !!final })]; r.onresult({ results: res }); if (final) setTimeout(() => r.onend && r.onend(), 30); };
      };
      const data = JSON.parse(JSON.stringify(DATA));
      Object.assign(data.address_lookup, { 'GNR Electric': { address: '1420 Pacific Ave', city: 'Brandon' }, 'AAA Bobcat': { address: '33 Middleton Ave', city: 'Brandon' }, 'Virden Pinnacle': { address: '1 Nelson St', city: 'Virden' } });
      const p5 = await open(browser, base, { user: STAFF, data }, fakeSpeech);
      const pg = p5.page;
      await pg.waitForSelector('#view-app:not([hidden]) .qrow');
      await pg.waitForSelector('#mic-fab:not([hidden])');
      // Reading what was said
      const said = (t) => pg.evaluate((x) => { const p = voiceParse(x, 'pickup'); return [p.pickup && p.pickup.name, p.delivery && p.delivery.name, itemsText(p.items.map((i) => Object.assign({}, i, { type: i.type || 'piece' }))), p.payment, p.po].join('|'); }, t);
      assert.strictEqual(await said('GNR Electric to AAA Bobcat, one box, 25 pounds'), 'GNR Electric|AAA Bobcat|1 box 25 lbs||');
      assert.strictEqual(await said('GNR electric for AAA Bobcat one pallet 25 pounds'), 'GNR Electric|AAA Bobcat|1 pallet 25 lbs||');
      assert.strictEqual(await said('gnr electric 4 triple a bobcat 2 boxes 40 lb collect PO 5521'), 'GNR Electric|AAA Bobcat|2 boxes 40 lbs|collect|5521');
      assert.strictEqual(await said('GNR Electric to burden pinnacle three envelopes'), 'GNR Electric|Virden Pinnacle|3 envelopes||', 'sound-alike names, like Route Planner');
      // Tap the mic: the form opens and fills in while talking
      await pg.click('#mic-fab');
      await pg.waitForSelector('#nd-pickup-name');
      await pg.waitForTimeout(300);
      await pg.evaluate(() => __say('GNR Electric to AAA Bobcat one box', false));
      await pg.waitForTimeout(250);
      assert.ok(await pg.isHidden('#mic-hear'), 'no words beside the mic');
      assert.ok(await pg.evaluate(() => document.getElementById('mic-fab').classList.contains('on')), 'the mic glows while listening');
      assert.strictEqual(await pg.inputValue('#nd-pickup-name'), '', 'nothing fills in while still talking');
      await shot(pg, 'voice-talking');
      await pg.evaluate(() => __say('GNR Electric to AAA Bobcat one box 25 pounds', true));
      await pg.waitForFunction(() => document.getElementById('nd-delivery-name').value === 'AAA Bobcat');
      await pg.waitForFunction(() => !document.getElementById('mic-fab').classList.contains('on'));
      assert.strictEqual(await pg.inputValue('#nd-text'), 'GNR Electric for AAA Bobcat, 1 box 25 lbs, Prepaid');
      await pg.waitForTimeout(900); // the blue flash has faded
      await shot(pg, 'voice-filled');
      // Cursor in the note: the words go in there
      await pg.click('[data-act=nd-x][data-x=notes]');
      await pg.focus('#nd-notes');
      await pg.click('#mic-fab');
      await pg.evaluate(() => __say('back door ask for Dave', true));
      await pg.waitForFunction(() => document.getElementById('nd-notes').value === 'Back door ask for Dave');
      assert.match(await pg.inputValue('#nd-text'), /Prepaid, Back door ask for Dave$/);
      await shot(pg, 'voice');
      // A name that's not a saved customer never goes in a box (like Route Planner): a message says so instead
      await pg.click('[data-act=nd-reset]');
      await pg.waitForTimeout(300);
      await pg.click('#mic-fab');
      await pg.evaluate(() => __say('Brandon hospital to', false));
      await pg.waitForTimeout(200);
      assert.strictEqual(await pg.inputValue('#nd-pickup-name'), '', 'words that match no one stay out of the box while talking');
      await pg.evaluate(() => __say('Brandon hospital to AAA Bobcat one box', true));
      await pg.waitForFunction(() => document.getElementById('nd-delivery-name').value === 'AAA Bobcat');
      await pg.waitForTimeout(300);
      assert.strictEqual(await pg.inputValue('#nd-pickup-name'), '', 'and after');
      assert.match(await pg.textContent('.toasts'), /Couldn.t find "Brandon Hospital"/);
      await shot(pg, 'voice-missing');
      // Picking the right customer after the mic missed teaches it, for this person only
      await pg.fill('#nd-pickup-name', 'Acme');
      await pg.click('.ac-item:has-text("Acme Supply")');
      await pg.waitForFunction(() => (window.__fakeDb.get('dispatch_settings/voice_aliases/staff1') || {})['brandon hospital'] === 'Acme Supply');
      assert.ok(!(await pg.evaluate(() => window.__fakeDb.get('developer/route_planner/voice_aliases'))), 'the shared Route Planner list is never written');
      assert.strictEqual(await said('Brandon hospital to AAA Bobcat'), 'Acme Supply|AAA Bobcat|||', 'the mic now finds them');
      // Route Planner's shared list is still read, but a person's own teaching wins
      await pg.evaluate(() => window.__fakeDb.put('developer/route_planner/voice_aliases', { 'gee and are': 'GNR Electric', 'brandon hospital': 'AAA Bobcat' }));
      await pg.waitForTimeout(200);
      assert.strictEqual(await said('gee and are to brandon hospital'), 'GNR Electric|Acme Supply|||', 'shared list read, own list first');
      // Teach the mic from the New dispatch form: an overlay on top, closing it goes straight back to the form
      assert.ok(await pg.isVisible('#sheet-teach'), 'Teach the mic sits in the form top line');
      await pg.click('#sheet-teach');
      await pg.waitForSelector('#vl-ov:not([hidden]) #vl-name');
      assert.ok(await pg.isVisible('#sheet .sheet'), 'the form stays open underneath');
      await pg.evaluate(() => { document.querySelector('.toasts').innerHTML = ''; });
      await pg.waitForTimeout(350);
      assert.ok(await pg.evaluate(() => { const t = document.getElementById('sheet-title'); return t.scrollWidth <= t.clientWidth + 1; }), 'New dispatch title not cut off');
      await shot(pg, 'voice-teach-overlay');
      await pg.click('[data-act=vl-close]');
      await pg.waitForSelector('#vl-ov', { state: 'hidden' });
      assert.strictEqual(await pg.inputValue('#nd-pickup-name'), 'Acme Supply', 'the form kept what was typed');
      assert.ok(await pg.evaluate(() => !document.getElementById('sheet').inert), 'the form works again');
      await pg.keyboard.press('Escape');
      await pg.waitForFunction(() => !document.getElementById('view-app').inert && !document.querySelector('.app-main').inert);
      // Teach the mic (Settings › Mic): pick a customer, say the name, it's saved for this person; ✕ forgets
      await pg.click('#set-btn');
      await pg.click('[data-act=teach-mic]');
      await pg.fill('#vl-name', 'Virden');
      await pg.click('#vl-ac .ac-item:has-text("Virden Pinnacle")');
      await pg.click('#vl-rec');
      await pg.evaluate(() => __say('burden pinnacle', true));
      await pg.waitForFunction(() => (window.__fakeDb.get('dispatch_settings/voice_aliases/staff1') || {})['burden pinnacle'] === 'Virden Pinnacle');
      await pg.waitForSelector('#vl-known .vl-chip:has-text("burden pinnacle")');
      assert.match(await pg.textContent('#vl-status'), /Saved/);
      await pg.evaluate(() => { document.querySelector('.toasts').innerHTML = ''; }); // the earlier message, out of the picture
      await shot(pg, 'voice-teach');
      await pg.click('[data-act=vl-forget][data-heard="burden pinnacle"]');
      await pg.waitForFunction(() => !(window.__fakeDb.get('dispatch_settings/voice_aliases/staff1') || {})['burden pinnacle']);
      // Another customer's own name is never taught
      await pg.click('#vl-rec');
      await pg.evaluate(() => __say('AAA Bobcat', true));
      await pg.waitForFunction(() => /another customer/.test(document.getElementById('vl-status').textContent));
      assert.deepStrictEqual(p5.errors, []);
      await pg.close();
    }
    console.log('dispatch smoke test passed');
  } finally {
    await browser.close();
    srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
