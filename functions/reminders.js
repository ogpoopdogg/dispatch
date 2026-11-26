/* Decides whether the 10-minute "jobs waiting" reminder should go out, and what it says. */
'use strict';

const TIME_ZONE = 'America/Winnipeg'; // Brandon, MB
const DEFAULTS = { enabled: true, start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] }; // Mon–Fri, 8–5
const MIN_WAIT_MS = 10 * 60000; // a job only counts once it has waited 10 minutes

/** Local date ("2026-10-28"), minutes since midnight and weekday (0 = Sunday) in Brandon. */
function localParts(now, tz = TIME_ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), day };
}
const toMinutes = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + (m || 0); };

/** Business hours from dispatch_settings/reminders, with the defaults filled in. */
function hoursFrom(saved) {
  const s = Object.assign({}, DEFAULTS, saved || {});
  if (!Array.isArray(s.days)) s.days = Object.keys(s.days || {}).filter((k) => s.days[k]).map(Number);
  return s;
}
/* Manitoba's general holidays, the same list as both apps (shopHolidays in index.html and in
   requestpickup/index.html). Dates are worked out in UTC so the server's own time zone doesn't matter. */
const ymd = (d) => d.toISOString().slice(0, 10);
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
}
const nthMonday = (y, month, n) => { const first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return new Date(Date.UTC(y, month, 1 + ((8 - first) % 7) + 7 * (n - 1))); };
function shopHolidays(y) {
  const may25 = new Date(Date.UTC(y, 4, 25)).getUTCDay();
  const victoria = new Date(Date.UTC(y, 4, 25 - ((may25 + 6) % 7 || 7))); // the Monday before May 25
  const goodFriday = easterSunday(y); goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  return {
    [`${y}-01-01`]: 'New Year’s Day', [ymd(nthMonday(y, 1, 3))]: 'Louis Riel Day', [ymd(goodFriday)]: 'Good Friday',
    [ymd(victoria)]: 'Victoria Day', [`${y}-07-01`]: 'Canada Day', [ymd(nthMonday(y, 8, 1))]: 'Labour Day',
    [`${y}-09-30`]: 'Truth and Reconciliation Day', [ymd(nthMonday(y, 9, 2))]: 'Thanksgiving', [`${y}-12-25`]: 'Christmas Day'
  };
}
/* Whether dispatch is closed on a day ("2026-12-25"). calendarDay is shop_calendar/<that day> from
   Settings > Days closed: { closed: true } closes it, { closed: false } opens a holiday or weekend. */
function closedDay(date, calendarDay) {
  if (calendarDay && calendarDay.closed === false) return false;
  if (calendarDay && calendarDay.closed) return true;
  return !!shopHolidays(Number(date.slice(0, 4)))[date];
}
// calendarDay: today's shop_calendar entry, or null
function inHours(settings, now, calendarDay) {
  const s = hoursFrom(settings);
  if (s.enabled === false) return false;
  const t = localParts(now);
  if (closedDay(t.date, calendarDay)) return false;
  const workDay = s.days.includes(t.day) || !!(calendarDay && calendarDay.closed === false); // a weekend opened in Settings counts
  return workDay && t.minutes >= toMinutes(s.start) && t.minutes < toMinutes(s.end);
}
function fmtWait(ms) {
  const min = Math.max(1, Math.floor(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} hr ${m} min` : `${h} hr`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

/** The reminder for the requests waiting now, or null. `pending` is requests with status "new". */
function reminderFor(pending, settings, now = Date.now(), calendarDay = null) {
  if (!inHours(settings, now, calendarDay)) return null;
  const today = localParts(now).date;
  const waiting = Object.values(pending || {}).filter((r) => r && r.status === 'new'
    && !(r.when === 'scheduled' && r.scheduled_for && r.scheduled_for > today)) // later days aren't in the queue yet
    .map((r) => ({ r, since: Number(r.created_at) || now }));
  if (!waiting.length) return null;
  waiting.sort((a, b) => a.since - b.since);
  const oldest = waiting[0];
  const wait = now - oldest.since;
  if (wait < MIN_WAIT_MS) return null;
  const n = waiting.length;
  const who = [oldest.r.ref_no ? `#${oldest.r.ref_no}` : '', oldest.r.company_name || ''].filter(Boolean).join(' ');
  return {
    title: `Jobs waiting in queue: ${fmtWait(wait)}`,
    body: `${n} ${n === 1 ? 'job' : 'jobs'} waiting${who ? `. Oldest: ${who}` : ''}`
  };
}

module.exports = { reminderFor, inHours, hoursFrom, fmtWait, localParts, closedDay, shopHolidays, DEFAULTS, TIME_ZONE };
