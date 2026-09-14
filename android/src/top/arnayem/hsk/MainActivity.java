package top.arnayem.hsk;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * HSK 4 Prep for Android: shows https://hsk.arnayem.top full-screen.
 * Everything else (questions, accounts, progress) lives in the web app, so deploying the website updates the app.
 * The one native piece is speech: Android's WebView has no Web Speech voices, so the page's listening audio
 * is sent to the phone's TextToSpeech engine through the "HSKNative" JavaScript bridge (see IN_APP in src/app.js).
 */
public class MainActivity extends Activity {
    private static final String HOST = "hsk.arnayem.top";
    private static final String HOME = "https://" + HOST + "/";

    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private final Map<String, Voice> voiceByName = new HashMap<>();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean clearHistoryAfterLoad;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // test builds only (build-apk.sh --debug)
        }

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.page_bg));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 35) {
            // Android 15+ always draws apps edge-to-edge: keep the page clear of the status bar, notch and keyboard.
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " HSK4PrepApp/" + versionName());
        CookieManager.getInstance().setAcceptCookie(true); // the sign-in cookie keeps users logged in for 30 days

        web.addJavascriptInterface(new Bridge(), "HSKNative");
        web.setWebChromeClient(new WebChromeClient()); // enables the page's confirm() dialogs
        web.setWebViewClient(new Client());

        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { fire(id, "end"); }
                @Override @SuppressWarnings("deprecation") public void onError(String id) { fire(id, "error"); }
                @Override public void onError(String id, int code) { fire(id, "error"); }
            });
            ttsReady = true;
            ui.post(() -> js("window.__hskVoices&&window.__hskVoices()"));
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }

        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    private void goBack() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // keep the app (and any exam in progress) alive instead of closing it
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() { // Android 12 and older
        goBack();
    }

    @Override
    protected void onPause() {
        super.onPause();
        js("typeof TTS!=='undefined'&&TTS.stop()"); // stop listening audio when the app goes to the background
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private void js(String code) {
        if (web != null) web.evaluateJavascript(code, null);
    }

    private void fire(String utteranceId, String event) {
        final int id;
        try {
            id = Integer.parseInt(utteranceId);
        } catch (NumberFormatException e) {
            return;
        }
        ui.post(() -> js("window.__hskTTS&&window.__hskTTS(" + id + ",'" + event + "')"));
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private void showOffline() {
        clearHistoryAfterLoad = true;
        String html = "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;font:16px/1.5 system-ui,Roboto,sans-serif;background:#f5f2ec;color:#1f1c18;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box}"
                + "@media(prefers-color-scheme:dark){body{background:#141312;color:#ece7df}p{color:#a59e93!important}}"
                + ".s{width:56px;height:56px;border-radius:12px;background:#b3302a;color:#fff;display:grid;place-items:center;font-size:30px;margin:0 auto 14px}"
                + "h2{margin:0 0 6px}p{color:#6e685f;max-width:320px;margin:0 auto}"
                + "a{display:inline-block;margin-top:20px;background:#b3302a;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600}</style></head>"
                + "<body><div><div class=s>考</div><h2>Can't reach HSK 4 Prep</h2><p>Check your internet connection (or VPN), then try again.</p>"
                + "<a href='" + HOME + "'>Try again</a></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            boolean ours = "https".equals(u.getScheme()) && HOST.equalsIgnoreCase(u.getHost());
            String path = u.getPath() == null ? "" : u.getPath();
            if (ours && !path.endsWith(".apk")) return false; // stay inside the app
            openOutside(u); // other sites, email links, APK downloads: hand to the phone's browser/apps
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (clearHistoryAfterLoad && url != null && url.startsWith(HOME)) {
                clearHistoryAfterLoad = false;
                view.clearHistory(); // so Back doesn't return to the "can't reach" page
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) showOffline();
        }
    }

    /** window.HSKNative in the page. Called on WebView's background bridge thread. */
    private class Bridge {
        @JavascriptInterface
        public String voices() {
            JSONArray out = new JSONArray();
            if (!ttsReady) return "[]";
            try {
                synchronized (voiceByName) {
                    voiceByName.clear();
                    Set<Voice> all = tts.getVoices();
                    if (all != null) {
                        for (Voice v : all) {
                            Locale l = v.getLocale();
                            String lang = l.getLanguage(), country = l.getCountry();
                            if (!("zh".equals(lang) || "cmn".equals(lang))) continue; // Mandarin only
                            if ("TW".equals(country) || "HK".equals(country) || "MO".equals(country) || "Hant".equals(l.getScript())) continue;
                            Set<String> f = v.getFeatures();
                            if (f != null && f.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                            voiceByName.put(v.getName(), v);
                            JSONObject o = new JSONObject();
                            o.put("name", v.getName());
                            o.put("lang", "zh-CN");
                            o.put("localService", !v.isNetworkConnectionRequired());
                            out.put(o);
                        }
                    }
                }
                if (out.length() == 0 && tts.isLanguageAvailable(Locale.SIMPLIFIED_CHINESE) >= TextToSpeech.LANG_AVAILABLE) {
                    // Some engines (common on Chinese phones) speak Chinese but don't list voices.
                    JSONObject o = new JSONObject();
                    o.put("name", "Phone voice (Chinese)");
                    o.put("lang", "zh-CN");
                    o.put("localService", true);
                    out.put(o);
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public void speak(int id, String text, String voiceName, String lang, double rate, double pitch) {
            if (!ttsReady || text == null) {
                fire(String.valueOf(id), "error");
                return;
            }
            synchronized (voiceByName) { // voice/rate/pitch are read when speak() is called, so set them together
                Voice v = voiceName == null ? null : voiceByName.get(voiceName);
                if (v != null) tts.setVoice(v);
                else tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                tts.setSpeechRate((float) rate);
                tts.setPitch((float) pitch);
                if (tts.speak(text, TextToSpeech.QUEUE_ADD, null, String.valueOf(id)) != TextToSpeech.SUCCESS) {
                    fire(String.valueOf(id), "error");
                }
            }
        }

        @JavascriptInterface
        public void stop() {
            if (tts != null) tts.stop();
        }
    }
}
