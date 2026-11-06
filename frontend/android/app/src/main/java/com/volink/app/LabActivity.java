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
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
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

    private String stepCall(String text) {
        return "(function(t,pw,ds,da){" + stepScript + "})(" + text + ",!!document.querySelector('input[type=password]')," + (summaryAt >= 0) + "," + (applicationsAt >= 0) + ")";
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
                    if (out.length() > 3 && out.charAt(2) == '|') showStep(out.charAt(0) - '0', out.substring(3));
                });
            }
            timer.postDelayed(this, 1500);
        }
    };

    private static final int BLUE = Color.parseColor("#2B5AA8"), GREEN = Color.parseColor("#2E7D5B"), INK = Color.parseColor("#1F2A24");
    private TextView badge, stepLabel, doneButton;
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
        take.setBackground(round(ready ? GREEN : Color.parseColor("#EEF1EE"), 14));
        take.setTextColor(ready ? Color.WHITE : Color.parseColor("#2A332E"));
        if (ready) take.animate().scaleX(1.04f).scaleY(1.04f).setDuration(160).withEndAction(() -> take.animate().scaleX(1f).scaleY(1f).setDuration(160).start()).start();
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

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
        doneButton = text("완료", 13.5f, Color.WHITE, true);
        doneButton.setBackground(round(GREEN, 18));
        doneButton.setPadding(dp(16), dp(8), dp(16), dp(8));
        doneButton.setVisibility(View.GONE);
        doneButton.setOnClickListener(v -> done());
        header.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));
        header.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        header.addView(doneButton);

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
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSaveFormData(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, url)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Uri page = Uri.parse(url);
                where.setText(page.getHost() == null ? "" : page.getHost());
            }
        });

        // Bottom: one wide button, green and pulsing once the page is the one to take.
        LinearLayout bottom = new LinearLayout(this);
        bottom.setPadding(dp(14), dp(10), dp(14), dp(12));
        take = new Button(this);
        take.setText("이 화면 가져오기");
        take.setTextSize(16);
        take.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        take.setAllCaps(false);
        take.setStateListAnimator(null);
        take.setBackground(round(Color.parseColor("#EEF1EE"), 14));
        take.setTextColor(Color.parseColor("#2A332E"));
        take.setOnClickListener(v -> takePage());
        bottom.addView(take, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));

        root.addView(header, wide);
        if ((guideText != null && !guideText.isEmpty()) || (stepScript != null && !stepScript.isEmpty())) root.addView(card, cardAt);
        root.addView(line(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(line(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        root.addView(bottom, wide);
        setContentView(root);
        String start = getIntent().getStringExtra("url");
        web.loadUrl(start == null ? LabPlugin.HOME : start);
        timer.postDelayed(checkStep, 1200);
    }

    /** "이 화면 가져오기": keeps this page's text (and which page it is) and stays on 1365 for the next one. */
    private void takePage() {
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
            if (text.trim().isEmpty()) { Toast.makeText(this, "읽을 글자가 없어요", Toast.LENGTH_SHORT).show(); return; }
            int at = "S".equals(kind) ? summaryAt : "A".equals(kind) ? applicationsAt : -1;
            if (at >= 0) pages.set(at, text); else { pages.add(text); at = pages.size() - 1; }
            if ("S".equals(kind)) summaryAt = at;
            if ("A".equals(kind)) applicationsAt = at;
            Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
            host = page.getHost() == null ? "" : page.getHost();
            doneButton.setText("완료 (" + pages.size() + ")");
            doneButton.setVisibility(View.VISIBLE);
            Toast.makeText(this, "S".equals(kind) ? "실적을 가져왔어요" : "A".equals(kind) ? "신청 현황을 가져왔어요" : "이 화면을 가져왔어요", Toast.LENGTH_SHORT).show();
            lastStep = 0;
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
        if (web != null && web.canGoBack()) web.goBack();
        else done();
    }

    @Override
    protected void onDestroy() {
        // Log out of 1365 in the app: its cookies go with this screen.
        CookieManager cookies = CookieManager.getInstance();
        String cookie = cookies.getCookie(LabPlugin.HOME);
        if (cookie != null) for (String part : cookie.split(";")) {
            String name = part.split("=", 2)[0].trim();
            if (!name.isEmpty()) cookies.setCookie(LabPlugin.HOME, name + "=; Max-Age=0; Path=/");
        }
        cookies.flush();
        timer.removeCallbacks(checkStep);
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
}
