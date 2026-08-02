package com.aqilahswimmingclub.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    static MainActivity current;
    static boolean foreground;

    public final class ASCAndroidBridge {
        @JavascriptInterface public void requestFcmToken() { FirebaseMessaging.getInstance().getToken().addOnSuccessListener(MainActivity.this::deliverFcmToken); }
    }

    private final ActivityResultLauncher<String> notificationPermissionLauncher =
            registerForActivityResult(
                    new ActivityResultContracts.RequestPermission(),
                    isGranted -> {
                        // Tidak perlu melakukan apa-apa di sini
                    });

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
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        WebViewAssetLoader assetLoader =
                new WebViewAssetLoader.Builder()
                        .addPathHandler(
                                "/assets/",
                                new WebViewAssetLoader.AssetsPathHandler(this))
                        .build();

        webView.setWebViewClient(new WebViewClientCompat() {

            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request) {

                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    String url) {

                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override public void onPageFinished(WebView view, String url) {
                FirebaseMessaging.getInstance().getToken().addOnSuccessListener(MainActivity.this::deliverFcmToken);
                deliverDeepLink(getIntent());
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        webView.loadUrl("https://appassets.androidplatform.net/assets/public/index.html");

        requestNotificationPermission();

        getOnBackPressedDispatcher().addCallback(this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            finish();
                        }
                    }
                });
    }

    void deliverFcmToken(String token) {
        if (token == null || token.isEmpty() || webView == null) return;
        String quoted = JSONObject.quote(token);
        webView.post(() -> webView.evaluateJavascript("window.ASCRegisterFcmToken&&window.ASCRegisterFcmToken(" + quoted + ",'android');window.dispatchEvent(new CustomEvent('aqilah-fcm-token',{detail:{token:" + quoted + ",platform:'android'}}));", null));
    }

    void deliverDeepLink(Intent intent) {
        if (intent == null || webView == null) return;
        String deepLink = intent.getStringExtra("deep_link");
        if (deepLink == null || deepLink.isEmpty()) return;
        String quoted = JSONObject.quote(deepLink);
        webView.post(() -> webView.evaluateJavascript("window.ASCOpenDeepLink&&window.ASCOpenDeepLink(" + quoted + ");window.dispatchEvent(new CustomEvent('aqilah-push-open',{detail:{deepLink:" + quoted + "}}));", null));
        intent.removeExtra("deep_link");
    }

    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); deliverDeepLink(intent); }
    @Override protected void onResume() { super.onResume(); foreground=true; }
    @Override protected void onPause() { foreground=false; super.onPause(); }
    @Override protected void onDestroy() { if(current==this)current=null; super.onDestroy(); }

    private void requestNotificationPermission() {

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {

            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {

                notificationPermissionLauncher.launch(
                        Manifest.permission.POST_NOTIFICATIONS);

            }

        }

    }

}
