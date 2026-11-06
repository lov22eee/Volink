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
        intent.putExtra("url", HOME);
        // Plan 1 (2026-11-06): one line above the 1365 page saying where to go after logging in.
        intent.putExtra("guide", call.getString("guide", ""));
        startActivityForResult(call, intent, "labResult");
    }

    @ActivityCallback
    private void labResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            JSObject out = new JSObject();
            out.put("text", data.getStringExtra("text"));
            out.put("host", data.getStringExtra("host"));
            call.resolve(out);
        } else {
            call.reject("closed", "CANCELLED");
        }
    }
}
