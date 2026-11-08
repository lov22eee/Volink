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
                        maybeStartHarvest();
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
        target = "S".equals(wanted) || "A".equals(wanted) || "P".equals(wanted) ? wanted : "";
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
        take.setOnClickListener(v -> { if ("P".equals(target) && !jumped && !applied) goToProgram(); else takePage(); });
        bottom.setVisibility(View.GONE);
        bottom.addView(take, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        root.addView(header, wide);
        // 2026-11-06: the step card is gone (it guessed wrong too often); the page check still turns the button green
        // and moves to the asked page after logging in.
        root.addView(line(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        frame = new FrameLayout(this);
        frame.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        progressCard = buildProgressCard();
        FrameLayout.LayoutParams cardPlace = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        cardPlace.setMargins(dp(12), 0, dp(12), dp(12));
        frame.addView(progressCard, cardPlace);
        slim = text("", 13.5f, Color.parseColor("#1E3A8A"), true);
        slim.setPadding(dp(14), dp(11), dp(14), dp(11));
        slim.setVisibility(View.GONE);
        FrameLayout.LayoutParams slimPlace = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        slimPlace.setMargins(dp(12), 0, dp(12), dp(12));
        frame.addView(slim, slimPlace);
        root.addView(frame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(bottom, wide);
        setContentView(root);
        String start = getIntent().getStringExtra("url");
        targetUrl = start != null && !start.equals(LabPlugin.HOME) ? start : "";
        web.loadUrl(start == null ? LabPlugin.HOME : start);
        timer.postDelayed(checkStep, 1200);
        String other = getIntent().getStringExtra("other");
        otherUrl = other != null && other.startsWith(LabPlugin.HOME + "/") ? other : "";
        if ("P".equals(target)) {
            String next = getIntent().getStringExtra("next");
            listUrl = next != null && next.startsWith(LabPlugin.HOME + "/") ? next : "";
            // Login first (the 신청 현황 page asks for it), then the program page (2026-11-08, user decision).
            String program = getIntent().getStringExtra("program");
            targetUrl = program != null && program.startsWith(LabPlugin.HOME + "/") ? program : "";
            progressMain.setOnClickListener(v -> done());
            progressAgain.setOnClickListener(v -> retryRead());
            showSlim("① 1365에 로그인해 주세요", 1, false);
            timer.postDelayed(applyTick, 1500);
        }
    }

    // ---- 1365 신청 반자동 (2026-11-08, target P): the person applies on the 1365 program page themselves; when 1365 says the
    // application is done (an alert or the page's words), the app opens the 신청 현황 page, reads it and returns to Volink.
    // The app never presses 신청 or ticks a consent box.
    private boolean applied = false, applyRead = false;
    /** Ticks in a row without a password box: the login is taken as finished after two (so its redirects can end first). */
    private int clearTicks = 0;
    private String listUrl = "";
    private static final java.util.regex.Pattern APPLIED_WORDS = java.util.regex.Pattern.compile(
            "신청이완료|신청완료되었|신청되었습니다|신청이되었습니다|정상적으로신청|신청이접수|접수되었습니다|이미신청");
    private static boolean appliedText(String text) {
        return text != null && APPLIED_WORDS.matcher(text.replaceAll("\\s+", "")).find();
    }
    private final Runnable applyTick = new Runnable() {
        @Override public void run() {
            if (web == null || !"P".equals(target)) return;
            String js = "(function(){var pw=Array.prototype.some.call(document.querySelectorAll('input[type=password]'),function(e){return e.offsetParent!==null;});"
                    + "var t=document.body?String(document.body.innerText||'').slice(0,20000):'';"
                    + "var h=document.documentElement?String(document.documentElement.innerHTML||'').slice(0,300000):'';var c=document.body?String(document.body.textContent||''):'';return JSON.stringify({pw:pw,len:t.length,out:/로그아웃/.test(c)||/logout/i.test(h)||/님\\s*(환영|안녕)/.test(t),done:/(신청이\\s*완료|신청\\s*되었습니다|정상적으로\\s*신청|신청이\\s*접수)/.test(t)});})()";
            web.evaluateJavascript(js, value -> {
                try {
                    Object parsed = new JSONTokener(value).nextValue();
                    JSONObject page = new JSONObject(parsed == null ? "{}" : parsed.toString());
                    boolean pw = page.optBoolean("pw"), done = page.optBoolean("done");
                    if (pw) { sawLogin = true; jumped = false; clearTicks = 0; } else clearTicks++;
                    // Logged in = the page offers 로그아웃 (or the 신청 현황 list opened), no password box for two ticks, no 간편인증 window open.
                    String at = web.getUrl() == null ? "" : web.getUrl().toLowerCase();
                    if (!pw && !applied && !jumped && !targetUrl.isEmpty() && clearTicks >= 2 && !at.contains("login")
                            && (page.optBoolean("out") || (onApplicationsPage() && page.optInt("len") > 300))) {
                        // to the program page (a 간편인증 window still open is closed first).
                        if (popup != null) closePopup();
                        goToProgram();
                    }
                    updateTake();
                    // Only on the program (after the login step), so nothing on the 신청 현황 page is taken for a new application.
                    if (done && !applied && jumped && !onApplicationsPage()) applyDetected();
                    if (applied && !applyRead && onApplicationsPage() && page.optInt("len") > 100) readApplications();
                } catch (Exception ignored) { }
            });
            if (!applyRead) timer.postDelayed(this, 1500);
        }
    };

    /** 로그인 → 이 봉사 페이지 (by itself after the login, or with the button [로그인했어요 · 이 봉사로 가기]). */
    private void goToProgram() {
        if (jumped || targetUrl.isEmpty() || web == null) return;
        loggedIn = true; jumped = true;
        web.loadUrl(targetUrl);
        updateTake();
        applyCard("1365 신청을 도와드릴게요", 1, 30, "");
        // The person's turn again: fold the card to one line so the 신청 page is not covered.
        timer.postDelayed(() -> { if (!applied) showSlim("③ 신청 진행하기", 3, true); }, 2500);
    }

    /** One line at the bottom (the person's turn): ① login (blue) or ③ 신청 진행하기 (orange), with "n / 4". */
    private void showSlim(String line, int step, boolean warm) {
        progressCard.setVisibility(View.GONE);
        slim.setText(line + "      " + step + " / 4");
        slim.setTextColor(Color.parseColor(warm ? "#9A4F00" : "#1E3A8A"));
        GradientDrawable bg = round(Color.parseColor(warm ? "#FFF8EF" : "#EEF3FB"), 14);
        bg.setStroke(dp(1), Color.parseColor(warm ? "#F1C99A" : "#B9CBE8"));
        slim.setBackground(bg);
        slim.setVisibility(View.VISIBLE);
    }

    /** The step card (the app's turn): done steps ✓, the current one ●, the rest ○. */
    private void applyCard(String title, int current, int percent, String note) {
        String[] steps = { "로그인", "신청 페이지로 이동", "신청 진행하기", "신청 내역 확인 · 내 활동에 넣기" };
        String[] doing = { "1365에 로그인해 주세요", "신청 페이지로 이동하는 중…", "신청 진행하기", "신청 내역 확인하는 중…" };
        String[] done = { "로그인 확인됐어요", "신청 페이지", "신청 완료 (1365)", "신청 내역을 읽었어요" };
        TextView[] lines = { progressPeriod, progressTime, progressActivity, progressExtra };
        for (int i = 0; i < 4; i++) {
            lines[i].setVisibility(View.VISIBLE);
            lines[i].setText(i < current ? "✓ " + done[i] : i == current ? "● " + doing[i] : "○ " + steps[i]);
            lines[i].setTextColor(i < current ? GREEN : i == current ? INK : Color.parseColor("#9AA3A0"));
            lines[i].setTypeface(Typeface.DEFAULT, i == current ? Typeface.BOLD : Typeface.NORMAL);
        }
        progressTitle.setText(title);
        progressBar.setIndeterminate(false);
        progressBar.setProgress(percent);
        progressNote.setText(note);
        progressNote.setVisibility(note.isEmpty() ? View.GONE : View.VISIBLE);
        progressButtons.setVisibility(View.GONE);
        slim.setVisibility(View.GONE);
        progressCard.setVisibility(View.VISIBLE);
    }

    /** 신청 내역 not read in 20 s: [다시 시도] reads the 신청 현황 page again, [닫기] goes back with what there is. */
    private void retryRead() {
        applyRead = false;
        applyCard("신청됐어요!", 3, 80, "신청 현황에서 이 봉사만 읽어요");
        if (web != null && !listUrl.isEmpty()) web.loadUrl(listUrl);
        timer.postDelayed(applyTick, 1500);
        timer.postDelayed(this::readStuck, 20000);
    }

    private void readStuck() {
        if (applyRead || isFinishing()) return;
        applyRead = true;
        timer.removeCallbacks(applyTick);
        applyCard("신청 내역을 읽지 못했어요", 3, 80, "1365 화면이 달라졌을 수 있어요. 닫으면 날짜를 직접 골라 넣을 수 있어요");
        progressMain.setText("닫기");
        progressButtons.setVisibility(View.VISIBLE);
    }

    private boolean onApplicationsPage() {
        String url = web == null ? null : web.getUrl();
        if (url == null || !url.startsWith(LabPlugin.HOME + "/")) return false;
        String path = Uri.parse(url).getPath();
        return path != null && path.endsWith(APPLICATIONS_PAGE);
    }

    /** 1365 said the application went through: show it, then go to 신청 현황 (20 s at most, then back with what we have). */
    private void applyDetected() {
        if (applied) return;
        applied = true;
        bottom.setVisibility(View.GONE);
        applyCard("신청됐어요!", 3, 80, "신청 현황에서 이 봉사만 읽어요");
        timer.postDelayed(() -> { if (web != null && !listUrl.isEmpty() && !onApplicationsPage()) web.loadUrl(listUrl); }, 1200);
        timer.postDelayed(this::readStuck, 20000);
    }

    private void readApplications() {
        applyRead = true;
        timer.postDelayed(() -> web.evaluateJavascript("(function(){return document.body?document.body.innerText:'';})()", value -> {
            String text = "";
            try { Object parsed = new JSONTokener(value).nextValue(); text = parsed == null ? "" : parsed.toString(); } catch (Exception ignored) { }
            if (text.length() > MAX) text = text.substring(0, MAX);
            if (!text.trim().isEmpty()) { pages.add(text); applicationsAt = pages.size() - 1; }
            Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
            host = page.getHost() == null ? "" : page.getHost();
            applyCard("✓ 다 됐어요", 4, 100, "Volink로 돌아가요…");
            timer.postDelayed(this::done, 1000);
        }), 1200);
    }

    private LinearLayout bottom;
    /** 실적 목록 자동 읽기 (2026-11-07): one step on the page per call; the activity drives the order (see harvestTick). */
    private static final String HARVEST = ""
            + "var T=document.body?document.body.innerText:'';\n"
            + "function nz(s){return String(s||'').replace(/\\s+/g,'');}\n"
            + "var C=nz(T);\n"
            + "if(C.indexOf('현재페이지')<0)return JSON.stringify({a:'wait'});\n"
            + "var inA=C.indexOf('활동인증형자원봉사실적')>=0,inT=C.indexOf('시간인증형자원봉사실적')>=0;\n"
            + "var tab=inA&&!inT?'activity':(inT&&!inA?'time':'');\n"
            + "function vis(e){return !!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);}\n"
            + "function find(sel,txt,scope){var els=(scope||document).querySelectorAll(sel);for(var i=0;i<els.length;i++){var e=els[i];if(!vis(e))continue;var t=nz(e.innerText||e.value||e.textContent);if(t===txt)return e;}return null;}\n"
            + "if(tab!==st.phase){var want=st.phase==='time'?'시간인증형':'활동인증형';var b=find('a,button',want)||find('li,span,strong,div',want);if(!b)return JSON.stringify({a:'stuck',m:'tab'});b.click();return JSON.stringify({a:'tab'});}\n"
            + "var all=null,rs=document.querySelectorAll('input[type=radio]');\n"
            + "for(var i=0;i<rs.length;i++){var r=rs[i];var l=r.id?document.querySelector('label[for=\"'+r.id+'\"]'):null;var t=nz(l?l.innerText:'');if(!t&&r.nextSibling)t=nz(r.nextSibling.textContent);if(!t&&r.parentNode&&r.parentNode.tagName==='LABEL')t=nz(r.parentNode.innerText);if(t==='전체'){all=r;break;}}\n"
            + "var early=false,ds=document.querySelectorAll('input');for(var j=0;j<ds.length;j++){var m=/^(\\d{4})[-.]\\d{1,2}[-.]\\d{1,2}$/.exec(String(ds[j].value||''));if(m){early=Number(m[1])<=2000;break;}}\n"
            + "if(all&&!all.checked&&!early&&st.searched<2){all.click();var s=find('button,a,input[type=button],input[type=submit]','검색');if(!s)return JSON.stringify({a:'stuck',m:'search'});setTimeout(function(){s.click();},200);return JSON.stringify({a:'search'});}\n"
            + "var pm=/현재페이지\\s*(\\d+)\\s*\\/\\s*(\\d+)/.exec(T);var cur=pm?Number(pm[1]):1,last=pm?Number(pm[2]):1;\n"
            + "var tm=/전체\\s*(\\d+)\\s*건/.exec(T);var total=tm?Number(tm[1]):-1;\n"
            + "var key=st.phase+'-'+cur;\n"
            + "if(st.seen.indexOf(key)<0){\n"
            + "var s0=T.indexOf('현재페이지');var e0=T.lastIndexOf('중복여부');if(e0<s0)e0=s0+12000;\n"
            + "var head=(st.phase==='time'&&cur===1)?T.slice(0,Math.min(s0,8000)):'';\n"
            + "var body=T.slice(Math.max(0,s0-1500),Math.min(T.length,e0+300));\n"
            + "var n=(body.match(/(봉사|활동)\\s*일자/g)||[]).length;\n"
            + "return JSON.stringify({a:'read',key:key,cur:cur,last:last,total:total,rows:n,text:(st.phase==='time'?'시간인증형 자원봉사 실적':'활동인증형 자원봉사 실적')+'\\n'+head+'\\n'+body});}\n"
            + "if(cur<last){var nx=String(cur+1);var pg=document.querySelector('[class*=pag],[id*=pag],[class*=Pag]');var a=(pg&&find('a,button',nx,pg))||find('a',nx)||(pg&&(find('a,button','다음',pg)||pg.querySelector('[class*=next],[title*=다음],[aria-label*=다음]')));if(!a)return JSON.stringify({a:'stuck',m:'page'});a.click();return JSON.stringify({a:'next',cur:cur,last:last});}\n"
            + "return JSON.stringify({a:st.phase==='time'?'phase':'done'});\n";

    // ---- 실적 목록 자동 읽기 (2026-11-07, target S): on the 실적 page the app sets 기간 전체 and 검색, reads every page of
    // 시간인증형 then 활동인증형, shows its progress and returns to Volink by itself. Only while the person has this screen
    // open, at most MAX_PAGES pages, never past a login or security step: anything unexpected stops and asks.
    private static final int MAX_PAGES = 20, MAX_TICKS = 150;
    private boolean harvesting = false, harvestStarted = false;
    private String harvestPhase = "time";
    private final java.util.List<String> harvestSeen = new ArrayList<>();
    private final java.util.LinkedHashMap<String, String> harvestTexts = new java.util.LinkedHashMap<>();
    private int harvestSearched = 0, harvestIdle = 0, harvestCool = 0, harvestTries = 0, harvestTicks = 0, harvestRows = 0;
    private LinearLayout progressCard, progressButtons;
    private TextView progressTitle, progressNote, progressPeriod, progressTime, progressActivity, progressExtra;
    /** 신청 반자동: the one-line note at the bottom while it is the person's turn (login, then 신청). */
    private TextView slim;
    private android.widget.ProgressBar progressBar;
    private Button progressMain, progressAgain;

    private final Runnable harvestTick = new Runnable() {
        @Override public void run() {
            if (!harvesting || web == null) return;
            if (++harvestTicks > MAX_TICKS) { harvestStuck(); return; }
            if (harvestCool > 0) { harvestCool--; timer.postDelayed(this, 900); return; }
            String state;
            try {
                state = new JSONObject().put("phase", harvestPhase).put("searched", harvestSearched).put("seen", new org.json.JSONArray(harvestSeen)).toString();
            } catch (Exception e) { harvestStuck(); return; }
            String js = "(function(st){try{" + HARVEST + "}catch(e){return JSON.stringify({a:'err'});}})(" + state + ")";
            web.evaluateJavascript(js, value -> {
                if (!harvesting) return;
                JSONObject out;
                try { Object parsed = new JSONTokener(value).nextValue(); out = new JSONObject(parsed == null ? "{}" : parsed.toString()); } catch (Exception e) { out = new JSONObject(); }
                handleHarvest(out);
                if (harvesting) timer.postDelayed(harvestTick, 900);
            });
        }
    };

    private void handleHarvest(JSONObject out) {
        String a = out.optString("a", "");
        switch (a) {
            case "wait":
                if (++harvestIdle > 20) harvestStuck();
                break;
            case "tab":
            case "next":
                harvestIdle = 0; harvestCool = 2;
                if (++harvestTries > 4) harvestStuck();
                break;
            case "search":
                harvestIdle = 0; harvestCool = 2; harvestSearched++;
                progressPeriod.setText("✓ 기간을 전체로 맞췄어요");
                break;
            case "read":
                harvestIdle = 0; harvestTries = 0;
                String key = out.optString("key", "");
                if (!harvestSeen.contains(key)) {
                    harvestSeen.add(key);
                    harvestTexts.put(key, out.optString("text", ""));
                    harvestRows += out.optInt("rows", 0);
                }
                int cur = out.optInt("cur", 1), last = Math.max(1, out.optInt("last", 1));
                if (harvestSearched == 0) progressPeriod.setText("✓ 기간을 전체로 맞췄어요");
                if ("time".equals(harvestPhase)) {
                    progressTime.setText("● 시간인증형 " + last + "쪽 중 " + cur + "쪽");
                    progressBar.setProgress(10 + (int) (55.0 * cur / last));
                } else {
                    progressActivity.setText("● 활동인증형 " + last + "쪽 중 " + cur + "쪽");
                    progressBar.setProgress(70 + (int) (25.0 * cur / last));
                }
                if (harvestSeen.size() >= MAX_PAGES) harvestFinish();
                break;
            case "phase":
                harvestPhase = "activity"; harvestSearched = 0; harvestTries = 0; harvestIdle = 0;
                progressTime.setText("✓ 시간인증형을 읽었어요");
                progressActivity.setText("● 활동인증형 읽는 중");
                break;
            case "done":
                progressActivity.setText("✓ 활동인증형을 읽었어요");
                harvestFinish();
                break;
            default:
                harvestStuck();
        }
    }

    /** The card's two buttons as the 실적 reading uses them ([n건만 가져가기]/[닫기] and [다시 읽기]). */
    private void harvestButtons() {
        progressMain.setOnClickListener(v -> {
            pages.clear();
            pages.addAll(carried);
            pages.addAll(harvestTexts.values());
            done();
        });
        progressAgain.setText("다시 읽기");
        progressAgain.setOnClickListener(v -> startHarvest());
    }

    private void startHarvest() {
        harvestButtons();
        harvestStarted = true;
        harvesting = true;
        harvestPhase = "time";
        harvestSeen.clear(); harvestTexts.clear();
        harvestSearched = 0; harvestIdle = 0; harvestCool = 0; harvestTries = 0; harvestTicks = 0; harvestRows = 0;
        bottom.setVisibility(View.GONE);
        progressTitle.setText("1365 실적을 읽고 있어요");
        progressNote.setText("화면을 닫지 말고 잠깐만 기다려 주세요");
        progressPeriod.setText("● 기간을 전체로 맞추는 중");
        progressTime.setText("○ 시간인증형");
        progressActivity.setText("○ 활동인증형");
        progressPeriod.setVisibility(View.VISIBLE); progressTime.setVisibility(View.VISIBLE); progressActivity.setVisibility(View.VISIBLE);
        progressBar.setVisibility(View.VISIBLE);
        progressBar.setProgress(5);
        progressButtons.setVisibility(View.GONE);
        progressCard.setVisibility(View.VISIBLE);
        timer.postDelayed(harvestTick, 600);
    }

    private void harvestFinish() {
        harvesting = false;
        timer.removeCallbacks(harvestTick);
        progressBar.setProgress(100);
        progressTitle.setText(harvestRows > 0 ? "✓ " + harvestRows + "건을 다 읽었어요" : "✓ 다 읽었어요");
        progressNote.setText("Volink로 돌아가요…");
        pages.clear();
        pages.addAll(carried);
        pages.addAll(harvestTexts.values());
        Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
        host = page.getHost() == null ? "" : page.getHost();
        // A안 (2026-11-08): while still logged in, offer the other page (신청 현황) in this same window.
        if (!otherAsked && !otherUrl.isEmpty() && carried.isEmpty()) {
            askOther("신청 현황도 가져올까요?", "신청 현황도 가져오기", () -> readOther());
            return;
        }
        timer.postDelayed(this::done, 1000);
    }

    // ---- 이어서 가져오기 (A안, 2026-11-08): 실적 → 신청 현황, or 신청 현황 → 실적, in one visit (one login) ----
    private String otherUrl = "";
    private boolean otherAsked = false, otherRead = false;
    /** Pages already taken before the 실적 reading started (신청 현황 first): kept when the reading finishes. */
    private final ArrayList<String> carried = new ArrayList<>();
    private int otherTicks = 0;

    /** The card asks for the other page: [그것도 가져오기] / [Volink로 돌아가기]. */
    private void askOther(String question, String yes, Runnable go) {
        progressNote.setText(question);
        progressNote.setVisibility(View.VISIBLE);
        progressMain.setText(yes);
        progressMain.setOnClickListener(v -> { otherAsked = true; go.run(); });
        progressAgain.setText("Volink로 돌아가기");
        progressAgain.setOnClickListener(v -> { otherAsked = true; done(); });
        progressButtons.setVisibility(View.VISIBLE);
        progressCard.setVisibility(View.VISIBLE);
    }

    /** 실적 done → the 신청 현황 page in the same window, read once its list is there (20 s at most). */
    private void readOther() {
        progressButtons.setVisibility(View.GONE);
        progressTitle.setText("신청 현황을 읽고 있어요");
        progressPeriod.setText("✓ 실적 " + harvestRows + "건");
        progressTime.setText("● 신청 현황 읽는 중…");
        progressActivity.setVisibility(View.GONE);
        progressBar.setVisibility(View.VISIBLE);
        progressBar.setProgress(85);
        progressNote.setText("화면을 닫지 말고 잠깐만 기다려 주세요");
        otherTicks = 0;
        web.loadUrl(otherUrl);
        timer.postDelayed(otherTick, 1500);
    }

    private final Runnable otherTick = new Runnable() {
        @Override public void run() {
            if (web == null || otherRead) return;
            if (++otherTicks > 14) { otherRead = true; Toast.makeText(LabActivity.this, "신청 현황은 읽지 못했어요", Toast.LENGTH_SHORT).show(); done(); return; }
            if (!onApplicationsPage()) { timer.postDelayed(this, 1500); return; }
            web.evaluateJavascript("(function(){return document.body?document.body.innerText:'';})()", value -> {
                String text = "";
                try { Object parsed = new JSONTokener(value).nextValue(); text = parsed == null ? "" : parsed.toString(); } catch (Exception ignored) { }
                if (text.trim().length() < 100) { timer.postDelayed(otherTick, 1500); return; }
                otherRead = true;
                if (text.length() > MAX) text = text.substring(0, MAX);
                pages.add(text);
                progressTime.setText("✓ 신청 현황을 읽었어요");
                progressBar.setProgress(100);
                progressTitle.setText("✓ 다 읽었어요");
                progressNote.setText("Volink로 돌아가요…");
                timer.postDelayed(LabActivity.this::done, 1000);
            });
        }
    };

    private void harvestStuck() {
        harvesting = false;
        timer.removeCallbacks(harvestTick);
        progressTitle.setText("끝까지 읽지 못했어요");
        progressNote.setText(harvestRows > 0 ? "지금까지 읽은 " + harvestRows + "건만 가져갈 수 있어요" : "1365 화면이 달라졌을 수 있어요. 다시 읽거나 닫아 주세요");
        progressPeriod.setVisibility(View.GONE); progressTime.setVisibility(View.GONE); progressActivity.setVisibility(View.GONE);
        progressBar.setVisibility(View.GONE);
        progressMain.setText(harvestRows > 0 ? harvestRows + "건만 가져가기" : "닫기");
        progressButtons.setVisibility(View.VISIBLE);
    }

    private TextView progressLine() {
        TextView view = text("", 13.5f, INK, false);
        view.setPadding(0, dp(4), 0, 0);
        return view;
    }

    /** The progress card at the bottom (instead of a button) while the 실적 list is read. */
    private LinearLayout buildProgressCard() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable bg = round(Color.WHITE, 18);
        bg.setStroke(dp(1), Color.parseColor("#E1E6E2"));
        box.setBackground(bg);
        progressTitle = text("", 15.5f, INK, true);
        progressPeriod = progressLine(); progressTime = progressLine(); progressActivity = progressLine();
        progressBar = new android.widget.ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgressTintList(android.content.res.ColorStateList.valueOf(GREEN));
        progressNote = text("", 12.5f, Color.parseColor("#7A867F"), false);
        progressNote.setPadding(0, dp(6), 0, 0);
        progressButtons = new LinearLayout(this);
        progressButtons.setOrientation(LinearLayout.VERTICAL);
        progressButtons.setPadding(0, dp(10), 0, 0);
        progressMain = new Button(this);
        progressMain.setAllCaps(false);
        progressMain.setTextColor(Color.WHITE);
        progressMain.setBackground(round(GREEN, 12));
        progressMain.setOnClickListener(v -> {
            if (harvestTexts.isEmpty()) { done(); return; }
            pages.clear();
            pages.addAll(harvestTexts.values());
            done();
        });
        progressAgain = new Button(this);
        progressAgain.setAllCaps(false);
        progressAgain.setText("다시 읽기");
        progressAgain.setTextColor(INK);
        GradientDrawable line = round(Color.WHITE, 12);
        line.setStroke(dp(1), Color.parseColor("#CFD8D2"));
        progressAgain.setBackground(line);
        progressAgain.setOnClickListener(v -> startHarvest());
        LinearLayout.LayoutParams tall = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
        LinearLayout.LayoutParams tall2 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
        tall2.topMargin = dp(8);
        progressButtons.addView(progressMain, tall);
        progressButtons.addView(progressAgain, tall2);
        box.addView(progressTitle);
        box.addView(progressPeriod); box.addView(progressTime); box.addView(progressActivity);
        progressExtra = progressLine();
        progressExtra.setVisibility(View.GONE);
        box.addView(progressExtra);
        LinearLayout.LayoutParams barAt = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8));
        barAt.topMargin = dp(10);
        box.addView(progressBar, barAt);
        box.addView(progressNote);
        box.addView(progressButtons);
        box.setVisibility(View.GONE);
        return box;
    }

    /** On the 실적 page with its list (현재페이지 shown): start reading by itself, once per visit. */
    private void maybeStartHarvest() {
        if (!"S".equals(target) || harvestStarted || harvesting || web == null || !onAllowedPage()) return;
        web.evaluateJavascript("(function(){return document.body&&document.body.innerText.replace(/\\s+/g,'').indexOf('현재페이지')>=0;})()", value -> {
            if ("true".equals(value) && !harvestStarted && onAllowedPage()) startHarvest();
        });
    }
    /** The two 1365 pages that may be taken (2026-11-06: never a login page, whose text could hold account details). */
    private static final String SUMMARY_PAGE = "/mypage/partcptnAcmslt.do", APPLICATIONS_PAGE = "/mypage/reqstDtls.do";

    /** True only on the page asked for (or either of the two when none was asked). */
    private boolean onAllowedPage() {
        String url = web == null ? null : web.getUrl();
        if (url == null || !url.startsWith(LabPlugin.HOME + "/")) return false;
        String path = Uri.parse(url).getPath();
        if (path == null) return false;
        if ("S".equals(target)) return path.endsWith(SUMMARY_PAGE);
        if ("A".equals(target) || "P".equals(target)) return path.endsWith(APPLICATIONS_PAGE);
        return path.endsWith(SUMMARY_PAGE) || path.endsWith(APPLICATIONS_PAGE);
    }

    private void updateTake() {
        if (bottom == null) return;
        // 실적 (S): no button — the list is read by itself (maybeStartHarvest).
        // 신청 반자동 before the program page: a button that goes there (if the login was not noticed by itself).
        boolean toProgram = false; // 2026-11-08: no button while logging in (it got in the way); the login is noticed by itself
        boolean show = toProgram || (onAllowedPage() && !"S".equals(target) && !applied && (!"P".equals(target) || jumped));
        if (take != null && take.isEnabled()) take.setText(toProgram ? "로그인했어요 · 이 봉사로 가기" : takeLabel());
        if (show && bottom.getVisibility() != View.VISIBLE)
            take.animate().scaleX(1.04f).scaleY(1.04f).setDuration(160).withEndAction(() -> take.animate().scaleX(1f).scaleY(1f).setDuration(160).start()).start();
        bottom.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private String takeLabel() {
        return "S".equals(target) ? "실적 가져오기" : "A".equals(target) || "P".equals(target) ? "신청 현황 가져오기" : "이 화면 가져오기";
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
            // A안 (2026-11-08): 신청 현황 taken → offer 실적 in the same window (the reading starts by itself there).
            if ("A".equals(target) && !otherAsked && !otherUrl.isEmpty()) {
                bottom.setVisibility(View.GONE);
                progressTitle.setText("✓ 신청 현황을 가져왔어요");
                progressPeriod.setVisibility(View.GONE); progressTime.setVisibility(View.GONE); progressActivity.setVisibility(View.GONE);
                progressBar.setVisibility(View.GONE);
                askOther("봉사참여 실적도 가져올까요?", "실적도 가져오기", () -> {
                    carried.clear();
                    carried.addAll(pages);
                    target = "S";
                    progressButtons.setVisibility(View.GONE);
                    progressTitle.setText("봉사참여 실적으로 이동하고 있어요");
                    progressNote.setText("화면을 닫지 말고 잠깐만 기다려 주세요");
                    web.loadUrl(otherUrl);
                });
                return;
            }
            // One page per visit: back to the app (its result screen) right after "가져오는 중…" has been seen.
            timer.postDelayed(this::done, 400);
        });
    }

    /** 닫기 / 완료: the pages taken so far go back to the app; none taken = cancelled. */
    private void done() {
        if (pages.isEmpty() && !applied) { setResult(RESULT_CANCELED); finish(); return; }
        int total = 0;
        ArrayList<String> out = new ArrayList<>();
        for (String text : pages) { if (total + text.length() > MAX) break; out.add(text); total += text.length(); }
        Intent data = new Intent();
        data.putExtra("text", String.join("\n\n", out));
        data.putStringArrayListExtra("texts", out);
        data.putExtra("host", host);
        data.putExtra("applied", applied);
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
        // 신청 반자동: 1365's "신청이 완료되었습니다" (or "이미 신청한 …") is confirmed for the person and shown as a short note.
        if ("P".equals(target) && jumped && appliedText(message)) {
            result.confirm();
            Toast.makeText(this, message.trim(), Toast.LENGTH_SHORT).show();
            applyDetected();
            return true;
        }
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
            maybeStartHarvest();
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
        timer.removeCallbacks(harvestTick);
        timer.removeCallbacks(applyTick);
        timer.removeCallbacks(otherTick);
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
