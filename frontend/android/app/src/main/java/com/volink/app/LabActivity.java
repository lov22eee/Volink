package com.volink.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.os.Message;
import android.view.View;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;
import org.json.JSONObject;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import org.json.JSONTokener;

/**
 * The lab's in-app browser for 1365 (see LabPlugin). Only https pages load here; anything else opens outside the app.
 * "이 화면 가져오기" returns the page's visible text (at most 100,000 characters). The 1365 login cookies are removed when the
 * screen closes, so nothing of the session stays in the app.
 */
public class LabActivity extends AppCompatActivity {
    private static final int MAX = 100_000;
    private WebView web;
    private TextView where;
    private TextView guide;
    private Button take;
    private String stepScript;
    private int lastStep = 0;
    private Button close;
    /** Pages taken in this visit (one 실적 page, one 신청 현황 page, others added); the window stays open until 완료. */
    private final ArrayList<String> pages = new ArrayList<>();
    private int summaryAt = -1, applicationsAt = -1;
    private String host = "";
    /** S = 봉사참여 실적, A = 신청 현황: the one page this visit is for; taking it returns to the app at once. */
    private String target = "";
    /** The 1365 page asked for; after logging in (or on the other page) the app goes there once by itself. */
    private String targetUrl = "";
    private boolean jumped = false;

    /** A login page (password box) was seen; once it is gone the person is taken as logged in. */
    private boolean sawLogin = false, loggedIn = false;

    private String stepCall(String text) {
        // Only a password box the person can see counts (1365 pages keep a hidden login form, 2026-11-06).
        return "(function(t,pw,ds,da,full,was,tg){" + stepScript + "})(" + text + ",Array.prototype.some.call(document.querySelectorAll('input[type=password]'),function(e){return e.offsetParent!==null;}),"
                + (summaryAt >= 0) + "," + (applicationsAt >= 0)
                + ",(document.body?String(document.body.textContent||'').slice(0,60000):'')," + loggedIn + ",'" + target + "')";
    }
    private final Handler timer = new Handler(Looper.getMainLooper());
    /** Every 1.5s: run the app's step script on the page and show its line (① 로그인 … ④ 이 화면 가져오기). */
    private final Runnable checkStep = new Runnable() {
        @Override public void run() {
            if (web != null && stepScript != null && !stepScript.isEmpty()) {
                String js = "(function(){try{return " + stepCall("document.body?document.body.innerText.slice(0,20000):''") + ";}catch(e){return '';}})()";
                web.evaluateJavascript(js, value -> {
                    String out;
                    try { Object parsed = new JSONTokener(value).nextValue(); out = parsed == null ? "" : parsed.toString(); } catch (Exception e) { out = ""; }
                    if (out.length() > 3 && out.charAt(2) == '|') {
                        int step = out.charAt(0) - '0';
                        // Left the login page (no password box any more) → logged in, so the guide moves on to ②.
                        // Only the password-box line mentions 간편인증. After it, the first page without the box = logged in.
                        if (out.contains("간편인증")) sawLogin = true;
                        else if (sawLogin && !loggedIn) { loggedIn = true; lastStep = 0; return; }
                        if (step == 1) jumped = false; // on the login page: once logged in, go to the page again
                        if ((step == 2 || step == 3) && !jumped && !targetUrl.isEmpty() && !targetUrl.equals(web.getUrl())) { jumped = true; web.loadUrl(targetUrl); }
                        showStep(step, out.substring(3));
                        updateTake();
                    }
                });
            }
            timer.postDelayed(this, 1500);
        }
    };

    private static final int BLUE = Color.parseColor("#2B5AA8"), GREEN = Color.parseColor("#2E7D5B"), INK = Color.parseColor("#1F2A24");
    private TextView badge, stepLabel;
    private LinearLayout card;
    private final View[] bars = new View[4];

    /** Rounded fill (and optional line) for the plain views below. */
    private GradientDrawable round(int fill, int radiusDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(dp(radiusDp));
        return shape;
    }

    private void showStep(int step, String line) {
        // The script's lines start with ① … ④; the badge shows the number, so it is taken off the line.
        if (!line.isEmpty() && "①②③④".indexOf(line.charAt(0)) >= 0) line = line.substring(1).trim();
        guide.setText(line);
        if (step == lastStep) return;
        lastStep = step;
        boolean ready = step == 4, finished = step == 5;
        int tone = ready || finished ? GREEN : BLUE;
        card.setBackground(round(Color.parseColor(ready || finished ? "#E8F5EE" : "#EEF3FB"), 16));
        badge.setBackground(round(tone, 15));
        badge.setText(finished ? "✓" : String.valueOf(Math.max(1, step)));
        stepLabel.setText(finished ? "가져오기 완료" : Math.max(1, step) + " / 4 단계");
        stepLabel.setTextColor(tone);
        for (int i = 0; i < bars.length; i++) bars[i].setBackground(round(i < Math.min(step, 4) ? tone : Color.parseColor(ready || finished ? "#CFE6DA" : "#D5DEEC"), 2));

    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }

    private TextView text(String value, float size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private View line() {
        View view = new View(this);
        view.setBackgroundColor(Color.parseColor("#E6EBE7"));
        return view;
    }

    /** 1365 origins opened in this visit, for clearing their web storage on close. */
    private final Set<String> visited = new LinkedHashSet<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The 1365 login is typed here: no screenshots, screen recording or recent-apps preview of this screen.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        // Edge to edge (Android 15+): keep the header and the button clear of the status and navigation bars.
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets edge = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            view.setPadding(0, edge.top, 0, edge.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        LinearLayout.LayoutParams wide = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);

        // Header: ✕ · 1365 연결 (host) · 완료 (n)
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(4), dp(6), dp(14), dp(6));
        close = new Button(this);
        close.setText("✕");
        close.setTextSize(20);
        close.setTextColor(INK);
        close.setBackgroundColor(Color.TRANSPARENT);
        close.setContentDescription("닫기");
        close.setOnClickListener(v -> done());
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.addView(text("1365 연결", 16, INK, true));
        where = text("www.1365.go.kr", 11.5f, Color.parseColor("#7A867F"), false);
        titles.addView(where);
        header.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));
        header.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        // Guide card: step badge, "2 / 4 단계", the line, four bars.
        card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        card.setBackground(round(Color.parseColor("#EEF3FB"), 16));
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        badge = text("1", 14, Color.WHITE, true);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(round(BLUE, 15));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setPadding(dp(12), 0, 0, 0);
        stepLabel = text("1 / 4 단계", 11.5f, BLUE, true);
        guide = text("", 14.5f, INK, true);
        guide.setLineSpacing(dp(2), 1f);
        String guideText = getIntent().getStringExtra("guide");
        stepScript = getIntent().getStringExtra("step");
        String wanted = getIntent().getStringExtra("target");
        target = "S".equals(wanted) || "A".equals(wanted) ? wanted : "";
        guide.setText(guideText == null ? "" : guideText);
        words.addView(stepLabel);
        words.addView(guide);
        row.addView(badge, new LinearLayout.LayoutParams(dp(30), dp(30)));
        row.addView(words, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout progress = new LinearLayout(this);
        progress.setOrientation(LinearLayout.HORIZONTAL);
        progress.setPadding(0, dp(10), 0, 0);
        for (int i = 0; i < bars.length; i++) {
            bars[i] = new View(this);
            bars[i].setBackground(round(i == 0 ? BLUE : Color.parseColor("#D5DEEC"), 2));
            LinearLayout.LayoutParams part = new LinearLayout.LayoutParams(0, dp(4), 1f);
            if (i > 0) part.leftMargin = dp(4);
            progress.addView(bars[i], part);
        }
        card.addView(row);
        card.addView(progress);
        LinearLayout.LayoutParams cardAt = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        cardAt.setMargins(dp(12), 0, dp(12), dp(10));

        web = new WebView(this);
        setUp(web);
        web.setWebViewClient(new Guard(true));
        // 간편인증 (2026-11-07): the auth window is a popup that tells 1365 and closes itself. It opens over the 1365 page in
        // its own view (window.opener stays), and closing it shows the 1365 page again.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                closePopup();
                popup = new WebView(LabActivity.this);
                setUp(popup);
                popup.setWebViewClient(new Guard(false));
                popup.setWebChromeClient(new WebChromeClient() {
                    @Override public void onCloseWindow(WebView window) { closePopup(); }

                    @Override
                    public boolean onJsAlert(WebView view, String url, String message, JsResult result) { return quietAlert(message, result); }
                });
                frame.addView(popup, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }

            @Override public void onCloseWindow(WebView window) { closePopup(); }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) { return quietAlert(message, result); }
        });

        // Bottom: the button exists only on the 실적 / 신청 현황 page itself (updateTake), green.
        bottom = new LinearLayout(this);
        bottom.setPadding(dp(14), dp(10), dp(14), dp(12));
        take = new Button(this);
        // 2026-11-06 (A안): the button says what it takes; one page per visit, so no 완료 button.
        take.setText(takeLabel());
        take.setTextSize(16);
        take.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        take.setAllCaps(false);
        take.setStateListAnimator(null);
        take.setBackground(round(GREEN, 14));
        take.setTextColor(Color.WHITE);
        take.setOnClickListener(v -> takePage());
        bottom.setVisibility(View.GONE);
        bottom.addView(take, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        root.addView(header, wide);
        // 2026-11-06: the step card is gone (it guessed wrong too often); the page check still turns the button green
        // and moves to the asked page after logging in.
        root.addView(line(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        frame = new FrameLayout(this);
        frame.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(frame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(bottom, wide);
        setContentView(root);
        String start = getIntent().getStringExtra("url");
        targetUrl = start != null && !start.equals(LabPlugin.HOME) ? start : "";
        web.loadUrl(start == null ? LabPlugin.HOME : start);
        timer.postDelayed(checkStep, 1200);
    }

    private LinearLayout bottom;
    /** The two 1365 pages that may be taken (2026-11-06: never a login page, whose text could hold account details). */
    private static final String SUMMARY_PAGE = "/mypage/partcptnAcmslt.do", APPLICATIONS_PAGE = "/mypage/reqstDtls.do";

    /** True only on the page asked for (or either of the two when none was asked). */
    private boolean onAllowedPage() {
        String url = web == null ? null : web.getUrl();
        if (url == null || !url.startsWith(LabPlugin.HOME + "/")) return false;
        String path = Uri.parse(url).getPath();
        if (path == null) return false;
        if ("S".equals(target)) return path.endsWith(SUMMARY_PAGE);
        if ("A".equals(target)) return path.endsWith(APPLICATIONS_PAGE);
        return path.endsWith(SUMMARY_PAGE) || path.endsWith(APPLICATIONS_PAGE);
    }

    private void updateTake() {
        if (bottom == null) return;
        boolean show = onAllowedPage();
        if (show && bottom.getVisibility() != View.VISIBLE)
            take.animate().scaleX(1.04f).scaleY(1.04f).setDuration(160).withEndAction(() -> take.animate().scaleX(1f).scaleY(1f).setDuration(160).start()).start();
        bottom.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private String takeLabel() {
        return "S".equals(target) ? "실적 가져오기" : "A".equals(target) ? "신청 현황 가져오기" : "이 화면 가져오기";
    }

    /** The button shows "가져오는 중…" (lighter, not pressable) while the page is read, then the app takes over. */
    private void setTaking(boolean on) {
        take.setEnabled(!on);
        take.setText(on ? "가져오는 중…" : takeLabel());
        take.setBackground(round(on ? Color.parseColor("#7FB39B") : GREEN, 14));
    }

    /** Takes this page's text (and which page it is) back to the app. */
    private void takePage() {
        if (!onAllowedPage()) { updateTake(); return; }
        setTaking(true);
        String kindCall = stepScript == null || stepScript.isEmpty() ? "''" : stepCall("t");
        String js = "(function(){var t=document.body?document.body.innerText:'';var k='';try{k=" + kindCall + ";}catch(e){}"
                + "return JSON.stringify({text:t,kind:String(k).charAt(1)});})()";
        web.evaluateJavascript(js, value -> {
            String text = "", kind = "-";
            try {
                Object parsed = new JSONTokener(value).nextValue();
                JSONObject page = new JSONObject(parsed == null ? "{}" : parsed.toString());
                text = page.optString("text", "");
                kind = page.optString("kind", "-");
            } catch (Exception ignored) { }
            if (text.length() > MAX) text = text.substring(0, MAX);
            if (text.trim().isEmpty()) { setTaking(false); Toast.makeText(this, "읽을 글자가 없어요", Toast.LENGTH_SHORT).show(); return; }
            int at = "S".equals(kind) ? summaryAt : "A".equals(kind) ? applicationsAt : -1;
            if (at >= 0) pages.set(at, text); else { pages.add(text); at = pages.size() - 1; }
            if ("S".equals(kind)) summaryAt = at;
            if ("A".equals(kind)) applicationsAt = at;
            Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
            host = page.getHost() == null ? "" : page.getHost();
            lastStep = 0;
            // One page per visit: back to the app (its result screen) right after "가져오는 중…" has been seen.
            timer.postDelayed(this::done, 400);
        });
    }

    /** 닫기 / 완료: the pages taken so far go back to the app; none taken = cancelled. */
    private void done() {
        if (pages.isEmpty()) { setResult(RESULT_CANCELED); finish(); return; }
        int total = 0;
        ArrayList<String> out = new ArrayList<>();
        for (String text : pages) { if (total + text.length() > MAX) break; out.add(text); total += text.length(); }
        Intent data = new Intent();
        data.putExtra("text", String.join("\n\n", out));
        data.putStringArrayListExtra("texts", out);
        data.putExtra("host", host);
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (popup != null) { if (popup.canGoBack()) popup.goBack(); else closePopup(); }
        else if (web != null && web.canGoBack()) web.goBack();
        else done();
    }

    private FrameLayout frame;
    /** The 간편인증 window while it is open (over the 1365 page). */
    private WebView popup;

    @SuppressLint("SetJavaScriptEnabled")
    private void setUp(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSaveFormData(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        // The auth pages are framed or set their cookies from another site; everything is wiped when this screen closes.
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
    }

    /**
     * 1365 says '로그인 정보가 없습니다' when its 실적/신청 page is opened before signing in (the app opens that page directly),
     * then goes to its login page by itself: that one alert is passed over. Any other alert shows as usual.
     */
    private boolean quietAlert(String message, JsResult result) {
        if (message != null && message.replace(" ", "").contains("로그인정보가없")) { result.confirm(); return true; }
        return false;
    }

    private void closePopup() {
        if (popup == null) return;
        WebView gone = popup;
        popup = null;
        frame.removeView(gone);
        gone.stopLoading();
        gone.destroy();
        updateTake();
    }

    /**
     * Which pages may open in this screen: 1365 itself and the sign-in services its 간편인증 goes through. Anything else
     * goes to the phone's browser (a link) or is stopped (a redirect), and its host is shown so it can be added if 1365
     * needs it. Framed parts of a page are not stopped; the take button stays on the two 1365 pages only.
     */
    private class Guard extends WebViewClient {
        private final boolean main;
        Guard(boolean main) { this.main = main; }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme() == null ? "" : url.getScheme();
            if (scheme.equals("intent")) { openApp(url.toString()); return true; }
            if (!scheme.equals("https") && !scheme.equals("http")) {
                // kakaotalk://, tauthlink:// and other sign-in apps.
                try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception e) { Toast.makeText(LabActivity.this, "인증 앱을 열지 못했어요", Toast.LENGTH_SHORT).show(); }
                return true;
            }
            if (!request.isForMainFrame() || allowed(url)) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception ignored) { }
            Toast.makeText(LabActivity.this, "1365 밖의 주소는 브라우저로 열어요 (" + url.getHost() + ")", Toast.LENGTH_LONG).show();
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            Uri page = Uri.parse(url);
            if (url.startsWith("about:") || allowed(page)) { if (page.getHost() != null) visited.add(page.getScheme() + "://" + page.getHost()); return; }
            // A redirect that slipped past the check above: stop before anything is shown or typed, and say which host it was.
            view.stopLoading();
            Toast.makeText(LabActivity.this, "막힌 주소: " + page.getHost(), Toast.LENGTH_LONG).show();
            if (!main) return;
            if (view.canGoBack()) view.goBack(); else view.loadUrl(LabPlugin.HOME);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!main) return;
            Uri page = Uri.parse(url);
            where.setText(page.getHost() == null ? "" : page.getHost());
            updateTake();
        }
    }

    /** An intent:// link (a sign-in app): open the app, or its web fallback, or its store page. */
    private void openApp(String link) {
        try {
            Intent intent = Intent.parseUri(link, Intent.URI_INTENT_SCHEME);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setComponent(null);
            intent.setSelector(null);
            try { startActivity(intent); return; } catch (Exception notInstalled) { /* below */ }
            String fallback = intent.getStringExtra("browser_fallback_url");
            if (fallback != null && allowed(Uri.parse(fallback)) && popup != null) { popup.loadUrl(fallback); return; }
            if (fallback != null && allowed(Uri.parse(fallback))) { web.loadUrl(fallback); return; }
            if (intent.getPackage() != null) startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + intent.getPackage())));
        } catch (Exception e) {
            Toast.makeText(LabActivity.this, "인증 앱을 열지 못했어요", Toast.LENGTH_SHORT).show();
        }
    }

    /** 1365 (also over http, which 1365 sometimes redirects through). */
    static boolean is1365(Uri url) {
        String host = url.getHost();
        String scheme = url.getScheme();
        return ("https".equals(scheme) || "http".equals(scheme)) && host != null && (host.equals("1365.go.kr") || host.endsWith(".1365.go.kr"));
    }

    /**
     * Sign-in services 1365's 간편인증 may pass through (2026-11-07, white screen after 카카오 인증): government sign-in
     * (*.go.kr) and the 간편인증 companies. Only https. Checked on the phone with the host shown when something is stopped.
     */
    private static final String[] AUTH_HOSTS = { "go.kr", "kakao.com", "naver.com", "toss.im", "tosspayments.com", "payco.com",
            "kbstar.com", "shinhan.com", "samsungpass.com", "pass.go.kr", "passauth.co.kr", "kcb.co.kr", "niceid.co.kr", "nice.co.kr",
            "sktelecom.com", "kt.com", "uplus.co.kr", "yessign.or.kr", "kftc.or.kr", "signkorea.com", "dreamsecurity.com", "raonsecure.com" };

    static boolean allowed(Uri url) {
        if (is1365(url)) return true;
        String host = url.getHost();
        if (!"https".equals(url.getScheme()) || host == null) return false;
        for (String suffix : AUTH_HOSTS) if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        return false;
    }

    @Override
    protected void onDestroy() {
        // Log out of 1365 and leave nothing behind: every cookie (the Volink app itself keeps none: its token is not a cookie),
        // the 1365 sites' web storage, this screen's cache, form data and history.
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeSessionCookies(null);
        cookies.removeAllCookies(null);
        cookies.flush();
        WebStorage storage = WebStorage.getInstance();
        for (String origin : visited) storage.deleteOrigin(origin);
        timer.removeCallbacks(checkStep);
        closePopup();
        if (web != null) {
            web.stopLoading();
            web.clearCache(true);
            web.clearFormData();
            web.clearHistory();
            web.destroy();
        }
        super.onDestroy();
    }
}
