package com.aqilahswimmingclub.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    private static final String PRODUCTION_URL = "https://aqilahswimmingclub.vercel.app";
    private static final String LOCAL_URL = "https://appassets.androidplatform.net/assets/public/index.html";
    private static final Set<String> INTERNAL_HOSTS = Set.of(
            "aqilahswimmingclub.vercel.app",
            "nykenupjktgmsotfzrjj.supabase.co",
            "appassets.androidplatform.net"
    );

    private final ExecutorService connectivityExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private boolean localFallback;
    private boolean pageLoadFailed;
    private long lastResumeCheck;

    static MainActivity current;
    static boolean foreground;

    public final class ASCAndroidBridge {
        @JavascriptInterface
        public void requestFcmToken() {
            FirebaseMessaging.getInstance().getToken()
                    .addOnSuccessListener(MainActivity.this::deliverFcmToken);
        }

        @JavascriptInterface
        public void retryRemote() {
            webView.post(MainActivity.this::loadProductionWebsite);
        }
    }

    private final ActivityResultLauncher<String> notificationPermissionLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestPermission(),
                    isGranted -> { });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        current = this;
        webView.addJavascriptInterface(new ASCAndroidBridge(), "ASCAndroid");

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageLoadFailed = false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showLocalFallback();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.equals(view.getUrl())) showLocalFallback();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) showLocalFallback();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showLocalFallback();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (pageLoadFailed) return;
                localFallback = url != null && url.startsWith(LOCAL_URL);
                if (localFallback) injectFallbackNotice();
                FirebaseMessaging.getInstance().getToken()
                        .addOnSuccessListener(MainActivity.this::deliverFcmToken);
                deliverDeepLink(getIntent());
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
        loadProductionWebsite();
        requestNotificationPermission();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack() && !isStartPage(webView.getUrl())) webView.goBack();
                else finish();
            }
        });
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null || uri.getScheme() == null) return true;
        if (!"https".equalsIgnoreCase(uri.getScheme())) return true;
        String host = uri.getHost();
        if (host != null && INTERNAL_HOSTS.contains(host.toLowerCase())) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) { }
        return true;
    }

    private void loadProductionWebsite() {
        pageLoadFailed = false;
        localFallback = false;
        webView.loadUrl(PRODUCTION_URL);
    }

    private void showLocalFallback() {
        if (pageLoadFailed || localFallback || webView == null) return;
        pageLoadFailed = true;
        localFallback = true;
        webView.post(() -> {
            webView.stopLoading();
            webView.loadUrl(LOCAL_URL);
            webView.clearHistory();
        });
    }

    private void injectFallbackNotice() {
        String script = "(function(){if(document.getElementById('asc-hybrid-fallback'))return;"
                + "var n=document.createElement('div');n.id='asc-hybrid-fallback';"
                + "n.style.cssText='position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;padding:14px;border-radius:12px;background:#061d3b;color:white;text-align:center;font:14px sans-serif;box-shadow:0 4px 18px #0008';"
                + "n.innerHTML='<div>Koneksi internet bermasalah. Periksa internet lalu coba lagi.</div><button style=\"margin-top:10px;padding:9px 18px;border:0;border-radius:8px;font-weight:700\" onclick=\"ASCAndroid.retryRemote()\">Coba Lagi</button>';"
                + "document.body.appendChild(n);})();";
        webView.evaluateJavascript(script, null);
    }

    private boolean isStartPage(String url) {
        if (url == null) return true;
        Uri uri = Uri.parse(url);
        String path = uri.getPath();
        boolean root = path == null || path.isEmpty() || "/".equals(path) || path.endsWith("/index.html");
        String host = uri.getHost();
        return root && ("aqilahswimmingclub.vercel.app".equalsIgnoreCase(host) || url.startsWith(LOCAL_URL));
    }

    private void checkProductionAfterResume() {
        long now = System.currentTimeMillis();
        if (!localFallback || now - lastResumeCheck < 5000) return;
        lastResumeCheck = now;
        connectivityExecutor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(PRODUCTION_URL).openConnection();
                connection.setConnectTimeout(4000);
                connection.setReadTimeout(4000);
                connection.setRequestMethod("GET");
                connection.setInstanceFollowRedirects(true);
                int status = connection.getResponseCode();
                if (status >= 200 && status < 400 && webView != null) webView.post(this::loadProductionWebsite);
            } catch (Exception ignored) {
                // Tetap gunakan fallback lokal tanpa reload loop.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    void deliverFcmToken(String token) {
        if (token == null || token.isEmpty() || webView == null) return;
        String quoted = JSONObject.quote(token);
        webView.post(() -> webView.evaluateJavascript(
                "window.ASCRegisterFcmToken&&window.ASCRegisterFcmToken(" + quoted + ",'android');"
                        + "window.dispatchEvent(new CustomEvent('aqilah-fcm-token',{detail:{token:"
                        + quoted + ",platform:'android'}}));", null));
    }

    void deliverDeepLink(Intent intent) {
        if (intent == null || webView == null) return;
        String deepLink = intent.getStringExtra("deep_link");
        if (deepLink == null || deepLink.isEmpty()) return;
        String quoted = JSONObject.quote(deepLink);
        webView.post(() -> webView.evaluateJavascript(
                "window.ASCOpenDeepLink&&window.ASCOpenDeepLink(" + quoted + ");"
                        + "window.dispatchEvent(new CustomEvent('aqilah-push-open',{detail:{deepLink:"
                        + quoted + "}}));", null));
        intent.removeExtra("deep_link");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliverDeepLink(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        checkProductionAfterResume();
    }

    @Override
    protected void onPause() {
        foreground = false;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        connectivityExecutor.shutdownNow();
        if (current == this) current = null;
        super.onDestroy();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
        }
    }
}
