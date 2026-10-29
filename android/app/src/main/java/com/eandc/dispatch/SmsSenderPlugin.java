package com.eandc.dispatch;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Texts for the dispatch page.
 * send:    sends a one-to-one text straight from this phone's number (asks once for permission).
 * compose: opens the phone's messaging app with several recipients and the text typed in,
 *          so a group text lands in the existing group conversation with those people.
 */
@CapacitorPlugin(name = "SmsSender", permissions = { @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }) })
public class SmsSenderPlugin extends Plugin {

    private static final String ACTION_SENT = "com.eandc.dispatch.SMS_SENT.";
    // Unique per send, also across app restarts, so a result can never be matched to an older text
    private static final AtomicInteger nextId = new AtomicInteger((int) (System.currentTimeMillis() & 0xFFFFF) * 16);

    @PluginMethod
    public void send(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermission");
            return;
        }
        doSend(call);
    }

    @PermissionCallback
    private void smsPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) doSend(call);
        else call.reject("The app isn’t allowed to send texts. Allow SMS for E&C Dispatch in the phone’s Settings > Apps.", "PERMISSION_DENIED");
    }

    private void doSend(PluginCall call) {
        String to = call.getString("to");
        String body = call.getString("body");
        if (to == null || to.trim().isEmpty() || body == null || body.isEmpty()) {
            call.reject("Missing phone number or text.");
            return;
        }
        Context ctx = getContext();
        SmsManager sms;
        try {
            sms = smsManager(ctx);
        } catch (Exception e) {
            sms = null;
        }
        if (sms == null) {
            call.reject("This phone can’t send texts.", "NO_SMS");
            return;
        }

        ArrayList<String> parts = sms.divideMessage(body);
        int id = nextId.incrementAndGet();
        String action = ACTION_SENT + id;
        AtomicInteger left = new AtomicInteger(parts.size());
        AtomicBoolean failed = new AtomicBoolean(false);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                int code = getResultCode();
                if (code != Activity.RESULT_OK && failed.compareAndSet(false, true)) {
                    int detail = intent.getIntExtra("errorCode", -1);
                    call.reject("The phone’s texting service said no (" + reason(code) + (detail != -1 ? ", " + detail : "") + ").", "SEND_FAILED_" + code);
                }
                if (left.decrementAndGet() == 0) {
                    try { ctx.unregisterReceiver(this); } catch (Exception ignored) { }
                    if (!failed.get()) call.resolve();
                }
            }
        };
        ContextCompat.registerReceiver(ctx, receiver, new IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED);

        ArrayList<PendingIntent> sent = new ArrayList<>();
        for (int i = 0; i < parts.size(); i++) {
            Intent intent = new Intent(action).setPackage(ctx.getPackageName());
            sent.add(PendingIntent.getBroadcast(ctx, id * 8 + i, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT));
        }
        try {
            if (parts.size() == 1) sms.sendTextMessage(to.trim(), null, body, sent.get(0), null);
            else sms.sendMultipartTextMessage(to.trim(), null, parts, sent, null);
        } catch (Exception e) {
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) { }
            call.reject("The text didn’t send: " + e.getMessage(), "SEND_FAILED");
        }
    }

    /**
     * The SmsManager for the SIM that's set for texts. On phones with two SIMs (or a SIM and an eSIM)
     * the plain default manager can fail when no SIM is picked for texts, so pick one explicitly.
     */
    private static SmsManager smsManager(Context ctx) {
        int sub = SubscriptionManager.getDefaultSmsSubscriptionId();
        if (sub == SubscriptionManager.INVALID_SUBSCRIPTION_ID) sub = SubscriptionManager.getDefaultSubscriptionId();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SmsManager base = ctx.getSystemService(SmsManager.class);
            if (base != null && sub != SubscriptionManager.INVALID_SUBSCRIPTION_ID) return base.createForSubscriptionId(sub);
            return base;
        }
        return sub != SubscriptionManager.INVALID_SUBSCRIPTION_ID ? SmsManager.getSmsManagerForSubscriptionId(sub) : SmsManager.getDefault();
    }

    /** Android's reason for a failed text, in words (SmsManager.RESULT_* codes). */
    private static String reason(int code) {
        switch (code) {
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE: return "general failure, code 1";
            case SmsManager.RESULT_ERROR_RADIO_OFF: return "radio off / airplane mode";
            case SmsManager.RESULT_ERROR_NULL_PDU: return "no message data";
            case SmsManager.RESULT_ERROR_NO_SERVICE: return "no service";
            case SmsManager.RESULT_ERROR_LIMIT_EXCEEDED: return "too many texts, limit reached";
            case SmsManager.RESULT_ERROR_FDN_CHECK_FAILURE: return "fixed dialing blocked it";
            case SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED:
            case SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED: return "short code not allowed";
            case SmsManager.RESULT_RADIO_NOT_AVAILABLE: return "radio not available";
            case SmsManager.RESULT_NETWORK_REJECT: return "network rejected it";
            case SmsManager.RESULT_INVALID_ARGUMENTS: return "invalid number or text";
            case SmsManager.RESULT_INVALID_STATE: return "phone not ready";
            case SmsManager.RESULT_INVALID_SMS_FORMAT: return "invalid text format";
            case SmsManager.RESULT_NETWORK_ERROR: return "network error";
            case SmsManager.RESULT_ENCODING_ERROR: return "text encoding error";
            case SmsManager.RESULT_INVALID_SMSC_ADDRESS: return "carrier message centre address invalid";
            case SmsManager.RESULT_OPERATION_NOT_ALLOWED: return "not allowed";
            case SmsManager.RESULT_NO_DEFAULT_SMS_APP: return "no default texting app set";
            default: return "code " + code;
        }
    }

    @PluginMethod
    public void compose(PluginCall call) {
        JSArray to = call.getArray("to");
        String body = call.getString("body", "");
        List<String> numbers = new ArrayList<>();
        try {
            for (Object n : to.toList()) {
                String s = String.valueOf(n).trim();
                if (!s.isEmpty()) numbers.add(s);
            }
        } catch (Exception e) {
            call.reject("Missing phone numbers.");
            return;
        }
        if (numbers.isEmpty()) {
            call.reject("Missing phone numbers.");
            return;
        }
        // Samsung's messaging app separates recipients with commas; others use semicolons.
        String sep = "samsung".equalsIgnoreCase(Build.MANUFACTURER) ? "," : ";";
        Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(String.join(sep, numbers), ",;+")));
        intent.putExtra("sms_body", body);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("No messaging app opened: " + e.getMessage(), "NO_APP");
        }
    }
}
