package za.co.moovurides.app;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openNotificationTarget(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openNotificationTarget(intent);
    }

    private void openNotificationTarget(Intent intent) {
        if (intent == null || getBridge() == null || getBridge().getWebView() == null) return;

        String targetUrl = intent.getStringExtra("moovu_url");
        if (targetUrl == null || targetUrl.trim().isEmpty()) return;

        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(targetUrl));
    }
}
