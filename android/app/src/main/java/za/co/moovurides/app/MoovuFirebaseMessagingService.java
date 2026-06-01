package za.co.moovurides.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class MoovuFirebaseMessagingService extends FirebaseMessagingService {
    private static final String CHANNEL_ID = "moovu_premium_v1";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return;

        String token = data.get("nativeActionToken");
        if (token == null || token.isEmpty()) return;

        showNativeActionNotification(data);
    }

    private void showNativeActionNotification(Map<String, String> data) {
        createNotificationChannel();

        String title = valueOr(data.get("title"), "MOOVU");
        String body = valueOr(data.get("body"), "Open MOOVU for details.");
        String actionType = valueOr(data.get("nativeActionType"), "");
        int notificationId = Math.abs(valueOr(data.get("tripId"), valueOr(data.get("nativeActionToken"), "moovu")).hashCode());

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("moovu_url", valueOr(data.get("nativeClickUrl"), data.get("url")));

        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            notificationId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setVibrate(new long[] {0, 180, 80, 260})
            .setSound(soundUri())
            .setContentIntent(contentIntent);

        if ("trip_offer".equals(actionType)) {
            builder.addAction(action(data, notificationId, MoovuNotificationActionReceiver.ACTION_ACCEPT, "Accept"));
            builder.addAction(action(data, notificationId, MoovuNotificationActionReceiver.ACTION_DECLINE, "Decline"));
        }

        if ("chat_reply".equals(actionType)) {
            RemoteInput remoteInput = new RemoteInput.Builder(MoovuNotificationActionReceiver.KEY_TEXT_REPLY)
                .setLabel("Reply to MOOVU")
                .build();

            Intent replyIntent = baseActionIntent(data, notificationId, MoovuNotificationActionReceiver.ACTION_REPLY);
            PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                this,
                notificationId + 3,
                replyIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag()
            );

            builder.addAction(
                new NotificationCompat.Action.Builder(R.mipmap.ic_launcher, "Reply", replyPendingIntent)
                    .addRemoteInput(remoteInput)
                    .setAllowGeneratedReplies(true)
                    .build()
            );
        }

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(notificationId, builder.build());
    }

    private NotificationCompat.Action action(Map<String, String> data, int notificationId, String action, String label) {
        Intent intent = baseActionIntent(data, notificationId, action);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
            this,
            notificationId + label.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Action.Builder(R.mipmap.ic_launcher, label, pendingIntent).build();
    }

    private Intent baseActionIntent(Map<String, String> data, int notificationId, String action) {
        Intent intent = new Intent(this, MoovuNotificationActionReceiver.class);
        intent.setAction(action);
        intent.putExtra("nativeActionToken", data.get("nativeActionToken"));
        intent.putExtra("nativeActionApiUrl", data.get("nativeActionApiUrl"));
        intent.putExtra("notificationId", notificationId);
        return intent;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "MOOVU premium ride alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Clear but softer MOOVU trip offers, chat replies, and urgent ride updates.");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] {0, 180, 80, 260});
        channel.setSound(soundUri(), audioAttributes);
        manager.createNotificationChannel(channel);
    }

    private Uri soundUri() {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + R.raw.moovu_premium_alert);
    }

    private int mutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? PendingIntent.FLAG_MUTABLE
            : 0;
    }

    private String valueOr(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
