package com.volink.notification;

import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** In-app notifications only (no SMS, e-mail or push). The screen polls the unread count. */
@Service
public class NotificationService {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public NotificationService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public void send(long userId, String type, String title, String body, String link) {
        jdbc.update("INSERT INTO notifications(user_id, type, title, body, link_path) VALUES (?, ?, ?, ?, ?)",
                userId, type, cut(title, 100), cut(body, 500), link);
    }

    public List<Map<String, Object>> mine(long userId, boolean unreadOnly) {
        return jdbc.queryForList(Sql.kst("""
                SELECT id, type, title, body, link_path AS link, read_at IS NOT NULL AS `read`,
                       DATE_FORMAT(KST(created_at), '%Y-%m-%d %H:%i') AS createdAt
                FROM notifications WHERE user_id = ?""") + (unreadOnly ? " AND read_at IS NULL" : "") + " ORDER BY id DESC LIMIT 50", userId);
    }

    public int unread(long userId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL", Integer.class, userId);
    }

    /** Someone else's notification is reported as missing (404), never as forbidden. */
    public void read(long userId, long id) {
        if (jdbc.update("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", LocalDateTime.now(clock), id, userId) == 0)
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "알림을 찾을 수 없습니다.");
    }

    public void readAll(long userId) {
        jdbc.update("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", LocalDateTime.now(clock), userId);
    }

    private static String cut(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
