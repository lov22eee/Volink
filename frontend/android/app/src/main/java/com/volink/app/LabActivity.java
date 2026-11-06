package com.volink.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
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
    private final Handler timer = new Handler(Looper.getMainLooper());
    /** Every 1.5s: run the app's step script on the page and show its line (① 로그인 … ④ 이 화면 가져오기). */
    private final Runnable checkStep = new Runnable() {
        @Override public void run() {
            if (web != null && stepScript != null && !stepScript.isEmpty()) {
                String js = "(function(){try{var t=document.body?document.body.innerText.slice(0,20000):'';"
                        + "var pw=!!document.querySelector('input[type=password]');return (function(t,pw){" + stepScript + "})(t,pw);}catch(e){return '';}})()";
                web.evaluateJavascript(js, value -> {
                    String out;
                    try { Object parsed = new JSONTokener(value).nextValue(); out = parsed == null ? "" : parsed.toString(); } catch (Exception e) { out = ""; }
                    if (out.length() > 2 && out.charAt(1) == '|') showStep(out.charAt(0) - '0', out.substring(2));
                });
            }
            timer.postDelayed(this, 1500);
        }
    };

    private void showStep(int step, String line) {
        guide.setText(line);
        if (step == lastStep) return;
        lastStep = step;
        boolean ready = step == 4;
        guide.setBackgroundColor(Color.parseColor(ready ? "#2E7D5B" : "#2B5AA8"));
        take.setBackgroundColor(Color.parseColor(ready ? "#2E7D5B" : "#E4E8E5"));
        take.setTextColor(ready ? Color.WHITE : Color.parseColor("#2A332E"));
        if (ready) take.animate().scaleX(1.08f).scaleY(1.08f).setDuration(180).withEndAction(() -> take.animate().scaleX(1f).scaleY(1f).setDuration(180).start()).start();
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(8), dp(12), dp(8));
        bar.setBackgroundColor(Color.parseColor("#F3F5F2"));
        Button close = new Button(this);
        close.setText("닫기");
        close.setOnClickListener(v -> { setResult(RESULT_CANCELED); finish(); });
        where = new TextView(this);
        where.setTextSize(12);
        where.setTextColor(Color.parseColor("#5D6B63"));
        where.setPadding(dp(8), 0, dp(8), 0);
        LinearLayout.LayoutParams grow = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        take = new Button(this);
        take.setText("이 화면 가져오기");
        take.setOnClickListener(v -> web.evaluateJavascript("(function(){return document.body ? document.body.innerText : ''})()", value -> {
            String text;
            try { Object parsed = new JSONTokener(value).nextValue(); text = parsed == null ? "" : parsed.toString(); } catch (Exception e) { text = ""; }
            if (text.length() > MAX) text = text.substring(0, MAX);
            Intent data = new Intent();
            data.putExtra("text", text);
            Uri page = Uri.parse(web.getUrl() == null ? "" : web.getUrl());
            data.putExtra("host", page.getHost());
            setResult(RESULT_OK, data);
            finish();
        }));
        bar.addView(close);
        bar.addView(where, grow);
        bar.addView(take);

        guide = new TextView(this);
        String guideText = getIntent().getStringExtra("guide");
        stepScript = getIntent().getStringExtra("step");
        guide.setText(guideText == null ? "" : guideText);
        guide.setTextSize(13);
        guide.setTextColor(Color.WHITE);
        guide.setBackgroundColor(Color.parseColor("#2B5AA8"));
        guide.setPadding(dp(14), dp(10), dp(14), dp(10));

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
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if ((guideText != null && !guideText.isEmpty()) || (stepScript != null && !stepScript.isEmpty()))
            root.addView(guide, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
        String start = getIntent().getStringExtra("url");
        web.loadUrl(start == null ? LabPlugin.HOME : start);
        timer.postDelayed(checkStep, 1200);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
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
