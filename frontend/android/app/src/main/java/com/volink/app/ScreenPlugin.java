package com.volink.app;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 출석 QR (2026-11-08): keeps the screen on while the organizer shows the QR, so it does not go dark on site. */
@CapacitorPlugin(name = "VolinkScreen")
public class ScreenPlugin extends Plugin {
    @PluginMethod
    public void keepOn(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /**
     * 사진 크게 보기 (week 7): no screenshots, screen recording or mirroring of this screen while a community photo is
     * open. The 녹화용 APK (ALLOW_CAPTURE) leaves it off for the demo video.
     */
    @PluginMethod
    public void secure(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false)) && !BuildConfig.ALLOW_CAPTURE;
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }
}
