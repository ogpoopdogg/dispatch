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
}
```

These let each staff member save their own phone's push token, and use the
"Send a test alert" button in Settings.

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
   npx firebase-tools deploy --only functions:notifyStaffOnRequest,functions:sendTestPush --project eandccourier-36fcc
   ```

   If `login` says you're already signed in, carry on.

   Deploy only these two functions, as above. The project also has other
   functions (`fleetHuntHistory`, `pajApi`, `pollNow`) that live outside this
   repo. A plain `--only functions` deploy offers to delete them: always
   answer **No** if you see that question.

On any computer with Node.js 22, the same commands work too.

### 5. (Recommended) Create a signing key, so updates install over the old app

Without a signing key, GitHub builds a **debug** APK. Each debug build is signed
with a different key, so to install a newer build you have to uninstall the
old one first, and then sign in again.

To fix that, make one release key, using a computer with Java or Android Studio
installed:

```sh
keytool -genkeypair -v -keystore ec-dispatch.jks -alias ecdispatch \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 ec-dispatch.jks > ec-dispatch.jks.b64   # macOS: base64 -i ec-dispatch.jks -o ec-dispatch.jks.b64
```

Then add four repository secrets (*Settings* → *Secrets and variables* →
*Actions*):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `ec-dispatch.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
| `ANDROID_KEY_ALIAS` | `ecdispatch` |
| `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password if you pressed Enter) |

Keep `ec-dispatch.jks` and its password somewhere safe and **never commit
it**. If it's lost, phones won't accept updates: everyone has to uninstall and
reinstall.

---

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
