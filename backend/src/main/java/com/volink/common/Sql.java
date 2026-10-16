package com.volink.common;

import java.util.regex.Pattern;

/** SQL helpers shared by services. */
public final class Sql {
    private static final Pattern KST = Pattern.compile("KST\\(([^()]+)\\)");

    private Sql() {}

    /**
     * Replaces KST(column) with a conversion to Korean time. TIMESTAMP columns (created_at defaults) are shown in the
     * DB session time zone, which is UTC on our servers, so "10:39" would appear as "01:39". DATETIME columns are
     * already Korean local time and must NOT be wrapped.
     */
    public static String kst(String sql) {
        return KST.matcher(sql).replaceAll("CONVERT_TZ($1, @@session.time_zone, '+09:00')");
    }
}
