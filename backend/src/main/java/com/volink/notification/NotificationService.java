package com.volink.notification;

import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * In-app notifications (the list on the screen; phone push is not connected yet). Each one has a type, a category for
 * the filter chips (V16), the activity it is about, and an optional key so the same event is stored only once.
 */
@Service
public class NotificationService {
    /** Filter chips: 신청·참여 / 활동 / 공지·소통 (others, e.g. organization review, only under 전체). */
    public static final Map<String, String> CATEGORY = Map.ofEntries(
            Map.entry("APPLIED", "APPLY"), Map.entry("APPROVED", "APPLY"), Map.entry("REJECTED", "APPLY"), Map.entry("CANCELLED", "APPLY"),
            Map.entry("WAITLISTED", "APPLY"), Map.entry("OFFERED", "APPLY"), Map.entry("OFFER_EXPIRED", "APPLY"), Map.entry("WAITLIST_CLOSED", "APPLY"),
            Map.entry("OFFER_ACCEPTED", "APPLY"), Map.entry("START_EXPIRED", "APPLY"), Map.entry("PENDING_REMINDER", "APPLY"),
            Map.entry("APPLICATION_RESULT", "APPLY"), Map.entry("WAITLIST_OFFER", "APPLY"),
            Map.entry("RESCHEDULED", "ACTIVITY"), Map.entry("ACTIVITY_CANCELLED", "ACTIVITY"), Map.entry("DAY_BEFORE", "ACTIVITY"), Map.entry("DAY_OF", "ACTIVITY"),
            Map.entry("CHECKIN_OPEN", "ACTIVITY"), Map.entry("QR_TIME", "ACTIVITY"), Map.entry("FINISHED", "ACTIVITY"), Map.entry("CHECKED_IN", "ACTIVITY"),
            Map.entry("RECORD_CONFIRMED", "ACTIVITY"), Map.entry("REVIEW_INVITE", "ACTIVITY"), Map.entry("LATE", "ACTIVITY"), Map.entry("ACTIVITY_REMINDER", "ACTIVITY"),
            Map.entry("ACTIVITY_CHANGED", "ACTIVITY"),
            Map.entry("NOTICE", "TALK"), Map.entry("QUESTION", "TALK"), Map.entry("ANSWER", "TALK"), Map.entry("COMMUNITY_COMMENT", "TALK"));
    static final Set<String> CATEGORIES = Set.of("APPLY", "ACTIVITY", "TALK", "OTHER");
    /** Repeated new applications for one activity within this time show as one row ("새 참가 신청 3건"). */
    static final Duration GROUP_WINDOW = Duration.ofMinutes(30);
    private static final Set<String> GROUPED = Set.of("APPLIED");
    private static final Pattern ACTIVITY_LINK = Pattern.compile("^#/(?:activity|manage|news|checkin)/(\\d+)");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final JdbcTemplate jdbc;
    private final Clock clock;

    public NotificationService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** The activity is read from the link (#/activity/12 …); links that name no activity store none. */
    public void send(long userId, String type, String title, String body, String link) {
        send(userId, type, title, body, link, activityOf(link), null);
    }

    /**
     * {@code dedupeKey}: the same key for the same person is stored once (a retried job or a double click cannot
     * repeat it). {@code activityId}: for links that do not name the activity (the records page, the search page).
     */
    public void send(long userId, String type, String title, String body, String link, Long activityId, String dedupeKey) {
        jdbc.update("""
                INSERT INTO notifications(user_id, type, category, title, body, link_path, activity_id, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE id = id""",
                userId, type, CATEGORY.getOrDefault(type, "OTHER"), cut(title, 100), cut(body, 500), link, activityId, dedupeKey);
    }

    static Long activityOf(String link) {
        if (link == null) return null;
        Matcher m = ACTIVITY_LINK.matcher(link);
        return m.find() ? Long.valueOf(m.group(1)) : null;
    }

    /** The web list (latest 50, as before). */
    public List<Map<String, Object>> mine(long userId, boolean unreadOnly) {
        return jdbc.queryForList(Sql.kst("""
                SELECT id, type, title, body, link_path AS link, read_at IS NOT NULL AS `read`,
                       DATE_FORMAT(KST(created_at), '%Y-%m-%d %H:%i') AS createdAt
                FROM notifications WHERE user_id = ?""") + (unreadOnly ? " AND read_at IS NULL" : "") + " ORDER BY id DESC LIMIT 50", userId);
    }

    public record Page(List<Map<String, Object>> items, Long next) {}

    /**
     * The notification center: newest first, {@code size} rows older than {@code before} (an id), optionally one
     * category. New applications for the same activity within 30 minutes become one row with every id in it, so
     * reading the row reads them all; the stored notifications are never merged or deleted.
     */
    public Page page(long userId, String category, Long before, int size) {
        if (category != null && !CATEGORIES.contains(category)) throw ApiException.validation(Map.of("category", "알 수 없는 알림 종류입니다."));
        if (size < 1 || size > 50) throw ApiException.validation(Map.of("size", "한 번에 1~50개까지 볼 수 있습니다."));
        List<Object> args = new ArrayList<>(List.of(userId));
        String where = " WHERE n.user_id = ?";
        if (category != null) { where += " AND n.category = ?"; args.add(category); }
        if (before != null) { where += " AND n.id < ?"; args.add(before); }
        args.add(size + 1);
        List<Map<String, Object>> rows = jdbc.queryForList(Sql.kst("""
                SELECT n.id, n.type, n.category, n.title, n.body, n.link_path AS link, n.read_at IS NOT NULL AS `read`, n.activity_id AS activityId,
                       a.title AS activityTitle, (n.activity_id IS NOT NULL AND (a.id IS NULL OR a.status = 'DELETED')) AS activityGone,
                       DATE_FORMAT(KST(n.created_at), '%Y-%m-%d %H:%i:%s') AS at
                FROM notifications n LEFT JOIN activities a ON a.id = n.activity_id""") + where + " ORDER BY n.id DESC LIMIT ?", args.toArray());
        Long next = null;
        if (rows.size() > size) { rows = rows.subList(0, size); next = ((Number) rows.get(size - 1).get("id")).longValue(); }
        List<Map<String, Object>> items = new ArrayList<>();
        Map<String, Object> group = null;
        for (Map<String, Object> row : rows) {
            LocalDateTime at = toLocal(row.remove("at"));
            if (group != null && GROUPED.contains(row.get("type")) && row.get("type").equals(group.get("type"))
                    && row.get("activityId") != null && row.get("activityId").equals(group.get("activityId"))
                    && Duration.between(at, (LocalDateTime) group.get("_newest")).compareTo(GROUP_WINDOW) <= 0) {
                @SuppressWarnings("unchecked") List<Long> ids = (List<Long>) group.get("ids");
                ids.add(((Number) row.get("id")).longValue());
                group.put("count", ids.size());
                group.put("read", truthy(group.get("read")) && truthy(row.get("read")));
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>(row);
            item.put("read", truthy(row.get("read")));
            item.put("activityGone", truthy(row.get("activityGone")));
            item.put("ids", new ArrayList<>(List.of(((Number) row.get("id")).longValue())));
            item.put("count", 1);
            item.put("createdAt", at.format(TIME));
            item.put("_newest", at);
            items.add(item);
            group = item;
        }
        for (Map<String, Object> item : items) {
            item.remove("_newest");
            if (((Integer) item.get("count")) > 1) item.put("title", item.get("title") + " " + item.get("count") + "건");
        }
        return new Page(items, next);
    }

    /** Unread counts for the chips: total and per category. */
    public Map<String, Object> unreadCounts(long userId) {
        Map<String, Object> counts = new LinkedHashMap<>(Map.of("ALL", 0, "APPLY", 0, "ACTIVITY", 0, "TALK", 0, "OTHER", 0));
        int total = 0;
        for (Map<String, Object> row : jdbc.queryForList("SELECT category, COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL GROUP BY category", userId)) {
            int n = ((Number) row.get("n")).intValue();
            counts.put((String) row.get("category"), n);
            total += n;
        }
        counts.put("ALL", total);
        return counts;
    }

    public int unread(long userId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL", Integer.class, userId);
    }

    /** Someone else's notification is reported as missing (404), never as forbidden. Reading twice changes nothing. */
    public void read(long userId, long id) {
        if (jdbc.update("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", LocalDateTime.now(clock), id, userId) == 0)
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "알림을 찾을 수 없습니다.");
    }

    /** A grouped row: only this person's ids are touched; others' ids are silently skipped. */
    public int readMany(long userId, List<Long> ids) {
        if (ids == null || ids.isEmpty() || ids.size() > 200) throw ApiException.validation(Map.of("ids", "읽을 알림을 1~200개 골라 주세요."));
        String marks = String.join(",", ids.stream().map(id -> "?").toList());
        List<Object> args = new ArrayList<>();
        args.add(LocalDateTime.now(clock));
        args.add(userId);
        args.addAll(ids);
        return jdbc.update("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE user_id = ? AND id IN (" + marks + ")", args.toArray());
    }

    public void readAll(long userId) {
        jdbc.update("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", LocalDateTime.now(clock), userId);
    }

    /** Push preferences (V16). Nobody has a row until they change something: everything on, quiet hours on. */
    public Map<String, Object> settings(long userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT apply_on, activity_on, talk_on, quiet_on FROM notification_settings WHERE user_id = ?", userId);
        Map<String, Object> row = rows.isEmpty() ? Map.of() : rows.get(0);
        Map<String, Object> out = new LinkedHashMap<>();
        for (String key : List.of("apply", "activity", "talk", "quiet")) out.put(key, rows.isEmpty() || truthy(row.get(key + "_on")));
        return out;
    }

    public Map<String, Object> saveSettings(long userId, Map<String, Object> request) {
        Map<String, Object> current = settings(userId);
        for (String key : current.keySet()) if (request != null && request.get(key) instanceof Boolean on) current.put(key, on);
        jdbc.update("""
                INSERT INTO notification_settings(user_id, apply_on, activity_on, talk_on, quiet_on) VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE apply_on = VALUES(apply_on), activity_on = VALUES(activity_on), talk_on = VALUES(talk_on), quiet_on = VALUES(quiet_on)""",
                userId, current.get("apply"), current.get("activity"), current.get("talk"), current.get("quiet"));
        return current;
    }

    /** Korean time as text from SQL (never a Timestamp, which would move with the server's time zone). */
    private static LocalDateTime toLocal(Object value) {
        return LocalDateTime.parse(String.valueOf(value).replace(' ', 'T'));
    }

    private static boolean truthy(Object value) {
        return value instanceof Boolean b ? b : value instanceof Number n && n.intValue() != 0;
    }

    private static String cut(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
