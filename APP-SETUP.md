# E&C Dispatch: Android app setup

`index.html` is still the whole app. The `android/` folder wraps it as a real
Android app (built with [Capacitor](https://capacitorjs.com)) and adds **push
notifications**: when a customer request arrives, every signed-in staff phone
gets an alert with the dispatch alarm sound, even if the app is closed or the
phone is locked.

How it fits together:

```
customer submits request ──▶ Realtime Database  requests/<id>
                                   │
                                   ▼
             Cloud Function  notifyStaffOnRequest   (functions/index.js)
                                   │  reads staff/ and push_tokens/
                                   ▼
          Firebase Cloud Messaging ──▶ staff phones (alarm sound, lock screen)
```

The app sends alerts for **new requests**, **requests a customer changed**, and
**requests a customer cancelled**. It does not send them for dispatching or for
Undo.

The web version (`index.html` opened in a browser) still works as before.

---

## One-time setup

### 1. Put the Firebase project on the Blaze plan

Cloud Functions only deploy on the pay-as-you-go **Blaze** plan. Blaze still
has a free monthly allowance, and sending push notifications through Firebase
Cloud Messaging is free. Check current prices at
<https://firebase.google.com/pricing>.

Firebase console → project **eandccourier-36fcc** → ⚙ → *Usage and billing* →
*Details & settings* → *Modify plan*.

### 2. Register the Android app in Firebase and get `google-services.json`

1. Firebase console → ⚙ *Project settings* → *General* → *Your apps* →
   **Add app** → Android.
2. Android package name: **`com.eandc.dispatch`** (it must match exactly).
3. App nickname: `E&C Dispatch`. Leave the SHA-1 empty.
4. Download **google-services.json**.
5. Give it to the build in **one** of these ways:
   - **Upload it to the repo** at `android/app/google-services.json`. On
     GitHub: open the `android/app` folder → *Add file* → *Upload files*.
     The file holds the same kind of project ID and API key that are already
     public in `index.html`.
   - **Or** keep it out of the repo: GitHub repo → *Settings* → *Secrets and
     variables* → *Actions* → *New repository secret*, name it
     `GOOGLE_SERVICES_JSON`, and paste the whole file in as the value.

### 3. Add two database rules

In the Firebase console → *Realtime Database* → *Rules*, add these two blocks
**inside your existing `"rules": { … }`**, next to what is already there. Do
not replace your current rules.

```json
"push_tokens": {
  "$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": "auth != null && auth.uid === $uid && root.child('staff').child(auth.uid).val() === true"
  }
},
"push_tests": {
  "$uid": {
    ".write": "auth != null && auth.uid === $uid && root.child('staff').child(auth.uid).val() === true"
  }
},
"dispatch_contacts": {
  ".read": "auth != null && root.child('staff').child(auth.uid).val() === true",
  ".write": "auth != null && root.child('staff').child(auth.uid).val() === true"
}
```

These let each staff member save their own phone's push token, use the
"Send a test alert" button in Settings, and share the **Drivers** and **Group
chats** lists in Settings with every dispatcher phone.

Also add this inside `"requests"` → `"$rid"`, next to `"dispatched_by_email"`.
The app saves who each request was sent to, and without it the database
refuses every dispatch:

```json
"dispatched_to": {
  ".write": "auth != null && root.child('staff').child(auth.uid).val() == true && data.parent().exists()",
  ".validate": "newData.isString() && newData.val().length <= 100"
}
```

**Remove from queue** marks a request `"status": "removed"` with `removed_at`,
`removed_by` and `removed_by_email`, and *Move back to queue* clears them. The
rules must allow it: in `"requests"` add `"removed_at"` to `".indexOn"`, add
`'removed'` to the `status` rule's allowed values and staff transitions
(`new` → `removed` and `removed` → `new`), and add `removed_at`, `removed_by` and
`removed_by_email` next to `dispatched_by_email`, written the same way as the
`dispatched_*` fields. The customer `.write` rule also refuses those three fields,
as it does the `dispatched_*` ones. Without these, Remove shows an error and the
request stays in the queue.

### 4. Deploy the push function

You need to do this once, and again whenever `functions/` changes. The easiest
way, with nothing to install, is **Google Cloud Shell**:

1. Open <https://shell.cloud.google.com> while signed in with the Google
   account that owns the Firebase project.
2. Run:

   ```sh
   git clone https://github.com/ogpoopdogg/dispatch.git
   cd dispatch/functions
   npm install
   npx firebase-tools login --no-localhost
   npx firebase-tools deploy --only functions:notifyStaffOnRequest,functions:notifyStaffOnMessage,functions:sendTestPush,functions:remindQueue,functions:alertCheck,functions:stampHistoryKey,functions:fillHistoryKeys,functions:notifyCustomerOnRequest,functions:notifyCustomerOnMessage --project eandccourier-36fcc
   ```

   If `login` says you're already signed in, carry on.

   `remindQueue` sends the 10-minute "Jobs waiting in queue" reminders during
   the hours set in the app (Settings > Queue reminders). The first time it
   deploys, Firebase may ask to turn on Cloud Scheduler: answer **Yes**.

   `alertCheck` tells Settings > Alerts how many staff phones get push alerts.
   Until it's deployed, that line says it couldn't check.

   `stampHistoryKey` and `fillHistoryKeys` keep the key the pickup app's
   History uses (`company_created` on each request). `fillHistoryKeys` fills
   it in on older requests within 30 minutes of deploying, then sets
   `config/history_keys_ready`; until then the pickup app loads History the
   old way. It also needs the updated database rules (they let the app read
   that flag and run the new History query), so the order you do the two in
   doesn't matter.

   `notifyCustomerOnRequest` and `notifyCustomerOnMessage` send phone alerts
   to customers who turned them on in the Request Pickup app (Account >
   Phone alerts): when their pickup is removed, and when dispatch writes to
   them. There is no alert when a pickup goes to a driver. The alert goes to
   whoever sent the pickup and anyone in their company who wrote to dispatch
   about it. They need the
   `customer_push` section in the database rules.

   Deploy only these nine functions, as above. The project also has other
   functions (`fleetHuntHistory`, `pajApi`, `pollNow`) that live outside this
   repo. A plain `--only functions` deploy offers to delete them: always
   answer **No** if you see that question.

On any computer with Node.js 22, the same commands work too.

### 5. Signing key, so updates install over the old app

Android only installs an update over the app when both are signed with the
**same key**. Without one, GitHub builds a **debug** APK with a new random key
every time, so each update means uninstalling first.

The app's key is already made and saved in this repo **encrypted**:
`android/signing/ec-dispatch.p12.enc` (alias `ecdispatch`). It can't be used
without its password. To switch it on, add **one** repository secret
(*Settings* → *Secrets and variables* → *Actions* → *New repository secret*):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_PASSWORD` | the key password (kept by the owner, not in this repo) |

After that every build is a `-release` APK signed with the same key, and the
build log prints the key's fingerprint, which must never change:

- SHA-1 `58:68:BC:33:56:99:27:CF:46:0F:03:2F:95:4F:4C:0E:C0:21:28:58`
- SHA-256 `0C:BA:77:FB:5B:9F:21:52:3B:8B:FE:1D:3C:25:A5:F7:AC:9C:6F:CE:E0:B4:96:18:22:94:46:5B:C3:DD:75:44`

Keep the password in a password manager. **If the password is lost, phones
can never get an update again** without uninstalling. Never change or delete
the `.enc` file. (Phones moving from a debug build to the first signed build
must uninstall once; after that, never again.)

The SHA-1 above is also what you add to the Google Maps key's Android
restriction (package `com.eandc.dispatch`).

The older way (four secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) still works and wins if
`ANDROID_KEYSTORE_BASE64` is set. Don't set it unless you mean to replace the key.

---

## Updates without a new APK

Phones with the app get new screens by themselves after a merge to `main`:

1. The GitHub workflow tests the app, then publishes the screens (`www/app.html`) to the
   `live` branch of this repo. Never edit that branch by hand.
2. The app checks for them when it opens, when it comes back to the front, and every 30 minutes.
   It keeps the newest copy on the phone.
3. It switches to them the next time it starts, or after it has been in the background for
   30 seconds with nothing being sent. It then shows "App updated (build N)" once.

Safety:
- A version that doesn't start properly is never used again. Within 15 seconds the phone goes
  back to the screens packed in its APK.
- With no internet, the phone keeps using what it has.

**When a new APK is still needed:** any change to `android/`, a new Capacitor plugin, or a new
permission. Raise `NATIVE_API` by 1 in `scripts/copy-web.mjs` in that same change. Phones with an
older APK keep their current screens and show "A new version of the app needs installing" until
the new APK is installed.

## Getting the app onto phones

Every push to GitHub builds the app (see the **Actions** tab → *Build Android
app*).

- **Easiest for phones:** Actions → *Build Android app* → *Run workflow* →
  tick **Also publish the APK as a GitHub Release** → *Run workflow*. When it
  finishes, open the repo's **Releases** page on the phone and tap the `.apk`.
- **Or:** open a finished run and download the APK from *Artifacts* (it comes
  as a .zip; unzip it to get the .apk).

On the phone, Android will ask to allow installs from your browser or Files
app ("Install unknown apps"). Allow it, then install.

### First launch on each phone

1. Sign in with email and password. (Google sign-in is hidden in the app,
   because Google blocks its sign-in page inside apps. Staff who only use
   Google sign-in need a password added to their account.)
2. Tap **Allow** when Android asks about notifications.
3. Settings (⚙) → **Send a test alert to this phone**, then lock the phone.
   The alert should arrive with the alarm sound within a few seconds.
4. If alerts arrive late or not at all while the phone is idle: phone
   Settings → Apps → E&C Dispatch → Battery → **Unrestricted**. Some brands
   (Samsung, Xiaomi, Huawei, OnePlus…) put apps to sleep aggressively unless
   you do this.
5. To change the sound or volume: phone Settings → Apps → E&C Dispatch →
   Notifications → *New requests*.

Signing out removes that phone from the alert list.

---

## Pre-launch security steps (November 2026)

These go with the new database rules and the two new functions.

### Block staff-email sign-ups (`blockStaffEmailSignUp`)

The function refuses any new account whose email ends in `@ec.com`, so nobody
can make a customer account with a staff address. It is a "blocking" function,
so the project must first use **Firebase Authentication with Identity
Platform**:

1. Firebase console > Authentication > Settings > **Upgrade** (to Identity
   Platform). Existing users and sign-in methods carry over.
2. Deploy: `firebase deploy --only functions`.
3. Firebase console > Authentication > Settings > **Blocking functions** >
   check that `blockStaffEmailSignUp` is set for "Before account creation".

To let one staff address make an account anyway, add this in the database:
`config/ec_signup_allow/<email key> = true`, where the key is the email in
lower case with its first `.` changed to `,` (for example
`jane@ec,com`). Remove it once the account exists.

### Deletion requests (`notifyStaffOnDeletionRequest`)

Customers can ask for their account to be deleted from the customer app. The
request appears in Settings > **Account deletion requests**, and staff phones
get an alert. Delete the account by hand (Authentication > Users, and the
customer's `users/<uid>` record), then tap **Done**.

### Closed days

Settings > **Closed days** shows a calendar. Weekends and Manitoba stat
holidays are closed by default. Tap a day to close it (with a short note) or
open it. The customer app reads this list right away.

These Settings cards are part of `index.html`, so phones need the new APK.

## Changing things later

- **Edit the app:** edit `index.html` as before. The next GitHub build puts the
  change into the APK. Phones need the new APK installed to see it.
- **Icons, splash screen, alarm sound:** `python3 scripts/make-android-assets.py`
  regenerates them from `icon2.png`.
- **Notification channel:** Android fixes a channel's sound when the app first
  creates it. If you change `dispatch_alarm.wav`, also change the channel ID in
  both `MainActivity.java` and `functions/index.js` (for example
  `dispatch_alerts_v2`).
- **Building locally** (needs Node 22 and Android Studio):
  `npm install && npm run sync && npm run open:android`.

## iPhone

The same Capacitor project can also produce an iPhone app (`npx cap add ios`),
but that needs a Mac with Xcode, a paid Apple Developer account, and an APNs key
uploaded to Firebase. It is not set up yet.
