/* E&C Dispatch – push notifications.
   Sends a push notification to every signed-in staff phone when a customer
   request arrives, is changed or is cancelled, so the alert shows even when
   the app is closed or the phone is locked.

   Phones save their push token under push_tokens/<uid>/<key> when a staff
   member signs in to the app (see setupPush in index.html). */
'use strict';

const { onValueWritten } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();

// The default Realtime Database (…-default-rtdb.firebaseio.com) lives in us-central1;
// database triggers have to run in the same region as the database.
setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

// Must match ALERT_CHANNEL_ID in android/app/src/main/java/com/eandc/dispatch/MainActivity.java
const ANDROID_CHANNEL_ID = 'dispatch_alerts_v1';

// Tokens FCM reports as gone for good (app uninstalled, data cleared, token rotated)
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

const { describeChange } = require('./alerts');
const { reminderFor, TIME_ZONE } = require('./reminders');

/** Collects push tokens for staff (staff/<uid> === true), optionally for one person only. */
async function staffTokens(onlyUid) {
  const db = admin.database();
  const [staffSnap, tokensSnap] = await Promise.all([
    db.ref('staff').once('value'),
    db.ref(onlyUid ? `push_tokens/${onlyUid}` : 'push_tokens').once('value')
  ]);
  const staff = staffSnap.val() || {};
  const byUid = onlyUid ? { [onlyUid]: tokensSnap.val() || {} } : tokensSnap.val() || {};
  const out = [];
  for (const [uid, devices] of Object.entries(byUid)) {
    if (staff[uid] !== true) continue;
    for (const [key, d] of Object.entries(devices || {})) {
      if (d && d.token) out.push({ token: d.token, path: `push_tokens/${uid}/${key}` });
    }
  }
  return out;
}

async function send(targets, { title, body, tag, data }) {
  if (!targets.length) { logger.info('No staff phones registered for push'); return; }
  const db = admin.database();
  for (let i = 0; i < targets.length; i += 500) { // FCM accepts up to 500 tokens per call
    const batch = targets.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: batch.map((t) => t.token),
      notification: { title, body },
      data,
      android: {
        priority: 'high', // delivered immediately, even when the phone is dozing
        notification: {
          channelId: ANDROID_CHANNEL_ID,
          icon: 'ic_stat_dispatch',
          color: '#FFD100',
          sound: 'dispatch_alarm', // Android 7 and older; newer phones use the channel's sound
          tag, // a later alert for the same request replaces the earlier one
          priority: 'max',
          visibility: 'public'
        }
      },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } }
    });
    const dead = [];
    res.responses.forEach((r, j) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (DEAD_TOKEN_CODES.has(code)) dead.push(db.ref(batch[j].path).remove());
      else logger.warn('Push failed', { code, message: r.error && r.error.message });
    });
    await Promise.all(dead);
    logger.info(`Push "${title}": ${res.successCount} sent, ${res.failureCount} failed, ${dead.length} stale tokens removed`);
  }
}

exports.notifyStaffOnRequest = onValueWritten('/requests/{id}', async (event) => {
  const msg = describeChange(event.data.before.val(), event.data.after.val());
  if (!msg) return;
  const id = event.params.id;
  await send(await staffTokens(), {
    title: msg.title,
    body: msg.body,
    tag: `request-${id}`,
    data: { requestId: String(id), kind: msg.kind }
  });
});

// "Send a test alert to this phone" in the app's Settings writes push_tests/<uid>
exports.sendTestPush = onValueWritten('/push_tests/{uid}', async (event) => {
  if (!event.data.after.exists()) return;
  const uid = event.params.uid;
  await send(await staffTokens(uid), {
    title: 'Test alert',
    body: 'Phone alerts are working. New requests will look and sound like this.',
    tag: 'test',
    data: { kind: 'test' }
  });
  await admin.database().ref(`push_tests/${uid}`).remove();
});

// Every 10 minutes during business hours (Settings > Queue reminders, saved in dispatch_settings/reminders):
// "Jobs waiting in queue: 25 min" while anything has waited 10 minutes or more.
exports.remindQueue = onSchedule({ schedule: 'every 10 minutes', timeZone: TIME_ZONE }, async () => {
  const db = admin.database();
  const [settingsSnap, pendingSnap] = await Promise.all([
    db.ref('dispatch_settings/reminders').once('value'),
    db.ref('requests').orderByChild('status').equalTo('new').once('value')
  ]);
  const msg = reminderFor(pendingSnap.val(), settingsSnap.val());
  if (!msg) return;
  await send(await staffTokens(), { ...msg, tag: 'queue-reminder', data: { kind: 'reminder' } });
});
