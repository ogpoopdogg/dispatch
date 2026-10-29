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
function inHours(settings, now) {
  const s = hoursFrom(settings);
  if (s.enabled === false) return false;
  const t = localParts(now);
  return s.days.includes(t.day) && t.minutes >= toMinutes(s.start) && t.minutes < toMinutes(s.end);
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
function reminderFor(pending, settings, now = Date.now()) {
  if (!inHours(settings, now)) return null;
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

module.exports = { reminderFor, inHours, hoursFrom, fmtWait, localParts, DEFAULTS, TIME_ZONE };
