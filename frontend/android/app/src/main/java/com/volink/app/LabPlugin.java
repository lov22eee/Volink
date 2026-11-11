package com.volink.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 실험실 (lab, 2026-11-06): opens the 1365 site in an in-app browser. The person logs in there themselves (Volink never sees
 * the password), goes to their own application list and taps "이 화면 가져오기": only the visible text of that page comes back
 * to the app, which reads the rows on the phone and lets the person pick what to keep.
 */
@CapacitorPlugin(name = "VolinkLab")
public class LabPlugin extends Plugin {
    static final String HOME = "https://www.1365.go.kr";

    @PluginMethod
    public void open(PluginCall call) {
        Intent intent = new Intent(getContext(), LabActivity.class);
        // 2026-11-06: the app passes the 1365 page to open (실적 or 신청 현황); only 1365 addresses are accepted.
        String url = call.getString("url", HOME);
        intent.putExtra("url", url != null && url.startsWith(HOME + "/") ? url : HOME);
        // Plan 1 (2026-11-06): one line above the 1365 page saying where to go after logging in.
        intent.putExtra("guide", call.getString("guide", ""));
        // Step guide (2026-11-06): a small script from the app that guesses the step from the page's words.
        intent.putExtra("step", call.getString("step", ""));
        intent.putExtra("target", call.getString("target", ""));
        // 신청 반자동 (target P): the 신청 현황 page to read after 1365 says the application went through.
        intent.putExtra("next", call.getString("next", ""));
        intent.putExtra("program", call.getString("program", ""));
        // 이어서 가져오기 (A안): the other page (실적 ↔ 신청 현황), offered in the same window after the first one.
        intent.putExtra("other", call.getString("other", ""));
        // 1365 로그인 유지 (2026-11-09, week 7): keep this phone's 1365 login cookies when the window closes.
        intent.putExtra("keep", Boolean.TRUE.equals(call.getBoolean("keep", false)));
        startActivityForResult(call, intent, "labResult");
    }

    /** 1365 로그아웃 (설정, Volink 로그아웃·탈퇴): every cookie and the 1365 sites' web storage on this phone. */
    @PluginMethod
    public void logout(PluginCall call) {
        LabActivity.forget1365();
        call.resolve();
    }

    @ActivityCallback
    private void labResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            JSObject out = new JSObject();
            out.put("text", data.getStringExtra("text"));
            out.put("host", data.getStringExtra("host"));
            out.put("applied", data.getBooleanExtra("applied", false));
            // Only 실적 came back (신청 현황 could not be read) → the app offers 신청 현황만 다시.
            out.put("partial", data.getBooleanExtra("partial", false));
            java.util.ArrayList<String> texts = data.getStringArrayListExtra("texts");
            if (texts != null) {
                com.getcapacitor.JSArray list = new com.getcapacitor.JSArray();
                for (String text : texts) list.put(text);
                out.put("texts", list);
            }
            call.resolve(out);
        } else {
            call.reject("closed", "CANCELLED");
        }
    }
}
