package com.volink.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins are registered before the bridge starts.
        registerPlugin(CalendarPlugin.class);
        registerPlugin(LabPlugin.class);
        registerPlugin(CameraPlugin.class);
        registerPlugin(ScreenPlugin.class);
        registerPlugin(ScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
