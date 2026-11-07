package com.volink.app;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Camera permission for the attendance QR (2026-11-07): [QR 찍고 체크인] asks Android itself first, so the system
 * "카메라를 허용할까요?" dialog appears on that tap. checkPermissions / requestPermissions come from Plugin (alias
 * "camera"); openSettings opens this app's page in Android settings when the person said no for good.
 */
@CapacitorPlugin(name = "VolinkCamera", permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) })
public class CameraPlugin extends Plugin {
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("no settings screen", "NO_SETTINGS");
        }
    }
}
