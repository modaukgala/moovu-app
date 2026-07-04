package za.co.moovurides.app;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private String pendingNotificationUrl;

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        captureNotificationTarget(getIntent());
        openPendingNotificationTarget();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureNotificationTarget(intent);
        openPendingNotificationTarget();
    }

    @Override
    public void onResume() {
        super.onResume();
        openPendingNotificationTarget();
    }

    private void captureNotificationTarget(Intent intent) {
        if (intent == null) return;

        String targetUrl = firstValue(
            intent.getStringExtra("moovu_url"),
            intent.getStringExtra("nativeClickUrl"),
            intent.getStringExtra("url")
        );
        if (targetUrl != null && !targetUrl.trim().isEmpty()) {
            pendingNotificationUrl = targetUrl.trim();
        }
    }

    private void openPendingNotificationTarget() {
        if (pendingNotificationUrl == null || pendingNotificationUrl.isEmpty()) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;

        final String targetUrl = pendingNotificationUrl;
        getBridge().getWebView().postDelayed(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) return;
            String resolvedUrl = targetUrl;
            if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
                String currentUrl = getBridge().getWebView().getUrl();
                if (currentUrl != null && currentUrl.startsWith("http")) {
                    android.net.Uri current = android.net.Uri.parse(currentUrl);
                    resolvedUrl = current.getScheme() + "://" + current.getAuthority()
                        + (targetUrl.startsWith("/") ? targetUrl : "/" + targetUrl);
                }
            }
            pendingNotificationUrl = null;
            getBridge().getWebView().loadUrl(resolvedUrl);
        }, 250);
    }

    private String firstValue(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value;
        }
        return null;
    }
}
