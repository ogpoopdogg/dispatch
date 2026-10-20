package com.eandc.dispatch;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Must match ANDROID_CHANNEL_ID in functions/index.js. Android fixes a channel's sound when it is
    // first created, so if the sound ever changes, use a new channel ID here and in the function.
    public static final String ALERT_CHANNEL_ID = "dispatch_alerts_v1";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsSenderPlugin.class);
        super.onCreate(savedInstanceState);
        createAlertChannel();
    }

    private void createAlertChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(ALERT_CHANNEL_ID) != null) return;

        NotificationChannel ch = new NotificationChannel(ALERT_CHANNEL_ID, "New requests", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Customer pickup requests. Plays the dispatch alarm and shows on the lock screen.");
        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + R.raw.dispatch_alarm);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        ch.setSound(sound, attrs);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 400, 150, 400, 150, 400 });
        ch.enableLights(true);
        ch.setLightColor(0xFFFFD100);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }
}
