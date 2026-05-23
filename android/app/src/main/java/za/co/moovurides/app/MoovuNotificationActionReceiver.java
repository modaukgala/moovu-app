package za.co.moovurides.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import androidx.core.app.RemoteInput;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

public class MoovuNotificationActionReceiver extends BroadcastReceiver {
    public static final String ACTION_ACCEPT = "za.co.moovurides.app.ACTION_ACCEPT_TRIP";
    public static final String ACTION_DECLINE = "za.co.moovurides.app.ACTION_DECLINE_TRIP";
    public static final String ACTION_REPLY = "za.co.moovurides.app.ACTION_REPLY_CHAT";
    public static final String KEY_TEXT_REPLY = "moovu_text_reply";

    @Override
    public void onReceive(Context context, Intent intent) {
        PendingResult pendingResult = goAsync();
        new Thread(() -> {
            try {
                sendAction(context, intent);
            } catch (Exception error) {
                Log.e("MoovuNotification", "Notification action failed", error);
            } finally {
                pendingResult.finish();
            }
        }).start();
    }

    private void sendAction(Context context, Intent intent) throws Exception {
        if (intent == null) return;

        String token = intent.getStringExtra("nativeActionToken");
        String apiUrl = intent.getStringExtra("nativeActionApiUrl");
        int notificationId = intent.getIntExtra("notificationId", 0);
        if (token == null || token.isEmpty() || apiUrl == null || apiUrl.isEmpty()) return;

        String action = "reply";
        if (ACTION_ACCEPT.equals(intent.getAction())) action = "accept";
        if (ACTION_DECLINE.equals(intent.getAction())) action = "decline";

        String replyText = "";
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results != null) {
            CharSequence text = results.getCharSequence(KEY_TEXT_REPLY);
            if (text != null) replyText = text.toString();
        }

        JSONObject payload = new JSONObject();
        payload.put("token", token);
        payload.put("action", action);
        if (!replyText.isEmpty()) payload.put("replyText", replyText);

        HttpURLConnection connection = (HttpURLConnection) new URL(apiUrl).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);

        try (OutputStream stream = connection.getOutputStream()) {
            stream.write(payload.toString().getBytes("UTF-8"));
        }

        int status = connection.getResponseCode();
        Log.i("MoovuNotification", "Notification action response: " + status);

        if (status >= 200 && status < 300 && notificationId != 0) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.cancel(notificationId);
        }

        connection.disconnect();
    }
}
