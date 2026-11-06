package com.volink.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.CalendarContract;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens the phone calendar's own "new event" screen with the activity filled in (Galaxy: Samsung Calendar).
 * Nothing is written by the app: the person checks it and taps save, so no calendar permission is needed.
 */
@CapacitorPlugin(name = "VolinkCalendar")
public class CalendarPlugin extends Plugin {
    @PluginMethod
    public void add(PluginCall call) {
        Long begin = call.getLong("begin");
        Long end = call.getLong("end");
        if (begin == null || end == null) { call.reject("begin and end are required"); return; }
        Intent intent = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin.longValue())
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end.longValue())
                .putExtra(CalendarContract.Events.TITLE, call.getString("title", "Volink 활동"))
                .putExtra(CalendarContract.Events.EVENT_LOCATION, call.getString("location", ""))
                .putExtra(CalendarContract.Events.DESCRIPTION, call.getString("description", ""))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("no calendar app", "NO_CALENDAR");
        }
    }
}
