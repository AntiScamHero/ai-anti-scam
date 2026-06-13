package com.xiaoshouhu.aishieldtest;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (android.os.Build.VERSION.SDK_INT >= 23
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 1001);
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        if (android.os.Build.VERSION.SDK_INT >= 21) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // 讓 app.js 可優先呼叫 AndroidShare.shareToLine(text)，避免 WebView 直接載入 intent://share。
        webView.addJavascriptInterface(new AndroidShareBridge(this), "AndroidShare");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleExternalUrl(view, request.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternalUrl(view, url);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                android.util.Log.d("XiaoShouHuWeb", consoleMessage.message());
                return true;
            }
        });

        WebView.setWebContentsDebuggingEnabled(true);

        // 目前你的 APK 載入的是 app/src/main/assets/index.html
        webView.loadUrl("file:///android_asset/index.html");
    }

    /**
     * 修正 Android WebView 無法處理 intent://、line:// 等外部 App 連結的問題。
     * 尤其是 LINE 分享 fallback 產生的 intent://share?text=...，不能讓 WebView 當網頁載入。
     */
    private boolean handleExternalUrl(WebView view, String url) {
        if (url == null || url.trim().isEmpty()) {
            return false;
        }

        String lowerUrl = url.trim().toLowerCase();

        // App 內本機頁面與一般 about 頁面，交給 WebView 自己處理。
        if (lowerUrl.startsWith("file://") || lowerUrl.startsWith("about:")) {
            return false;
        }

        // line.me 應交給系統/LINE App，不要塞回 WebView。
        if (lowerUrl.startsWith("https://line.me/")
                || lowerUrl.startsWith("http://line.me/")
                || lowerUrl.contains("://line.me/")
                || lowerUrl.contains("://liff.line.me/")) {
            openViewIntent(url);
            return true;
        }

        // 一般 http/https 網址仍由 WebView 載入。
        if (lowerUrl.startsWith("http://") || lowerUrl.startsWith("https://")) {
            return false;
        }

        // 特別處理 intent://share?text=...，直接用 Android 原生分享送到 LINE。
        if (lowerUrl.startsWith("intent://share")) {
            try {
                Uri uri = Uri.parse(url);
                String text = uri.getQueryParameter("text");

                if (text != null && !text.trim().isEmpty()) {
                    shareTextToLine(text);
                    return true;
                }
            } catch (Exception ignored) {
                // 若解析失敗，往下交給一般 intent:// 處理。
            }
        }

        // 處理 intent://、line://、market://、tel:、mailto: 等外部 App scheme。
        if (lowerUrl.startsWith("intent://")) {
            return openIntentScheme(view, url);
        }

        openViewIntent(url);
        return true;
    }

    private boolean openIntentScheme(WebView view, String url) {
        try {
            Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setComponent(null);
            intent.setSelector(null);

            startActivity(intent);
            return true;

        } catch (ActivityNotFoundException e) {
            handleIntentFallback(view, url);
            return true;

        } catch (Exception e) {
            handleIntentFallback(view, url);
            return true;
        }
    }

    private void handleIntentFallback(WebView view, String url) {
        try {
            Intent parsedIntent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            String fallbackUrl = parsedIntent.getStringExtra("browser_fallback_url");

            if (fallbackUrl != null && !fallbackUrl.trim().isEmpty()) {
                // line.me fallback 也交給系統處理，避免 WebView 再次卡住。
                if (fallbackUrl.startsWith("https://line.me/")
                        || fallbackUrl.startsWith("http://line.me/")
                        || fallbackUrl.contains("://line.me/")
                        || fallbackUrl.contains("://liff.line.me/")) {
                    openViewIntent(fallbackUrl);
                } else {
                    view.loadUrl(fallbackUrl);
                }
                return;
            }

            String packageName = parsedIntent.getPackage();
            if (packageName != null && !packageName.trim().isEmpty()) {
                Intent marketIntent = new Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("market://details?id=" + packageName)
                );
                startActivity(marketIntent);
            }

        } catch (Exception ignored) {
            // 沒有可用 fallback 時直接忽略，避免 App 閃退。
        }
    }

    private void openViewIntent(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (Exception ignored) {
            // 避免沒有對應 App 時閃退。
        }
    }

    private void shareTextToLine(String text) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_TEXT, text);
        intent.setPackage("jp.naver.line.android");

        try {
            startActivity(intent);
        } catch (Exception e) {
            // 沒有 LINE 或 LINE 無法接收時，退回 Android 分享選單。
            intent.setPackage(null);
            Intent chooser = Intent.createChooser(intent, "分享 LINE 邀請");
            startActivity(chooser);
        }
    }

    public static class AndroidShareBridge {
        private final Activity activity;

        public AndroidShareBridge(Activity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void shareToLine(String text) {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, text);
            intent.setPackage("jp.naver.line.android");

            try {
                activity.startActivity(intent);
            } catch (Exception e) {
                intent.setPackage(null);
                Intent chooser = Intent.createChooser(intent, "分享 LINE 邀請");
                activity.startActivity(chooser);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
