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
    private static final AtomicInteger nextId = new AtomicInteger();

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
            sms = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? ctx.getSystemService(SmsManager.class) : SmsManager.getDefault();
        } catch (Exception e) {
            sms = null;
        }
        if (sms == null) {
            call.reject("This phone can’t send texts.", "NO_SMS");
            return;
        }

        ArrayList<String> parts = sms.divideMessage(body);
        String action = ACTION_SENT + nextId.incrementAndGet();
        AtomicInteger left = new AtomicInteger(parts.size());
        AtomicBoolean failed = new AtomicBoolean(false);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                if (getResultCode() != Activity.RESULT_OK && failed.compareAndSet(false, true)) {
                    call.reject("The text didn’t send. Check the phone has signal and try again.", "SEND_FAILED");
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
            sent.add(PendingIntent.getBroadcast(ctx, i, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT));
        }
        try {
            if (parts.size() == 1) sms.sendTextMessage(to.trim(), null, body, sent.get(0), null);
            else sms.sendMultipartTextMessage(to.trim(), null, parts, sent, null);
        } catch (Exception e) {
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) { }
            call.reject("The text didn’t send: " + e.getMessage(), "SEND_FAILED");
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
