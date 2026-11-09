package com.volink.safety;

import com.volink.common.ApiException;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 불참 · 신고 누적 패널티 (week 7, 2026-11-09).
 * 불참 (90일): 1회 안내 → 2회 경고 → 3회 14일 신청 제한. 이의가 받아들여진 불참은 세지 않아요.
 * 신고 (관리자가 인정한 것만): 1회 경고 → 2회 7일 글쓰기 제한 → 3회 30일 신청·글쓰기 제한.
 * The server checks these on every 신청 and 글·댓글 — the screen only says why.
 */
@Service
public class PenaltyService {
    static final int NOSHOW_DAYS = 90, NOSHOW_LIMIT = 3, NOSHOW_RESTRICT_DAYS = 14;
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("M월 d일");
    private final JdbcTemplate jdbc;
    private final NotificationService notifications;
    private final Clock clock;

    public PenaltyService(JdbcTemplate jdbc, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.clock = clock;
    }

    /** Throws 403 RESTRICTED while an APPLY (or ALL) limit runs; WRITE for 글·댓글. */
    public void check(long userId, String what) {
        Map<String, Object> active = active(userId, what);
        if (active == null) return;
        LocalDateTime until = (LocalDateTime) active.get("ends_at");
        String verb = "APPLY".equals(what) ? "신청할" : "글을 쓸";
        throw new ApiException(HttpStatus.FORBIDDEN, "RESTRICTED", (until == null ? "지금은 " : DAY.format(until) + "까지 ") + verb + " 수 없어요. " + active.get("reason"));
    }

    private Map<String, Object> active(long userId, String what) {
        return jdbc.queryForList("""
                SELECT id, type, scope, reason, starts_at, ends_at FROM sanctions
                WHERE user_id = ? AND revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) AND (scope = 'ALL' OR scope = ?)
                ORDER BY ends_at DESC LIMIT 1""", userId, now(), now(), what).stream().findFirst().orElse(null);
    }

    public int noShows(long userId) {
        return jdbc.queryForObject("""
                SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id
                WHERE p.user_id = ? AND p.status = 'NO_SHOW' AND p.noshow_cleared = FALSE AND a.starts_at > ?""", Integer.class, userId, now().minusDays(NOSHOW_DAYS));
    }

    /** Called when a confirmed person is marked 불참 (no check-in by the end). */
    public void afterNoShow(long userId, long activityId, String title) {
        int n = noShows(userId);
        if (n <= 1) notifications.send(userId, "SANCTION", title + "에 불참으로 기록됐어요", "90일 안에 3번이면 14일 동안 신청할 수 없어요 · 잘못됐다면 7일 안에 이의 신청해 주세요",
                "#/my?view=status", activityId, "NOSHOW:" + activityId + ":" + userId);
        else if (n == 2) notifications.send(userId, "SANCTION", "불참이 2번이에요", "최근 90일 불참 2번 · 한 번 더 불참하면 14일 동안 신청할 수 없어요",
                "#/my?view=status", activityId, "NOSHOW:" + activityId + ":" + userId);
        else if (active(userId, "APPLY") == null) {
            LocalDateTime until = now().plusDays(NOSHOW_RESTRICT_DAYS);
            jdbc.update("INSERT INTO sanctions(user_id, type, scope, source, reason, starts_at, ends_at, created_by) VALUES (?, 'RESTRICTION', 'APPLY', 'NOSHOW', ?, ?, ?, ?)",
                    userId, "최근 90일 불참 " + n + "번", now(), until, userId);
            notifications.send(userId, "SANCTION", DAY.format(until) + "까지 신청할 수 없어요", "최근 90일 불참 " + n + "번이에요 · 잘못된 기록은 이의 신청할 수 있어요",
                    "#/my?view=status", activityId, "NOSHOW:" + activityId + ":" + userId);
        }
    }

    /** An admin accepted a report about this person: the next step of the ladder. */
    public void afterReport(long userId, long reportId, long adminId, String why) {
        int n = jdbc.queryForObject("SELECT COUNT(*) FROM sanctions WHERE user_id = ? AND source = 'REPORT' AND revoked_at IS NULL", Integer.class, userId) + 1;
        LocalDateTime now = now();
        String type = n == 1 ? "WARNING" : n == 2 ? "RESTRICTION" : "SUSPENSION";
        String scope = n == 1 ? "NONE" : n == 2 ? "WRITE" : "ALL";
        LocalDateTime until = n == 1 ? null : now.plusDays(n == 2 ? 7 : 30);
        jdbc.update("INSERT INTO sanctions(user_id, type, scope, source, reason, report_id, starts_at, ends_at, created_by) VALUES (?, ?, ?, 'REPORT', ?, ?, ?, ?, ?)",
                userId, type, scope, "신고 인정 " + n + "번 · " + why, reportId, now, until, adminId);
        String title = n == 1 ? "신고가 인정돼 경고를 받았어요" : n == 2 ? DAY.format(until) + "까지 글을 쓸 수 없어요" : DAY.format(until) + "까지 신청·글쓰기가 제한돼요";
        String body = "사유: " + why + (n == 1 ? " · 한 번 더 인정되면 7일 동안 글을 쓸 수 없어요" : " · 잘못됐다면 7일 안에 이의 신청할 수 있어요");
        notifications.send(userId, "SANCTION", title, body, "#/my?view=status", null, "REPORT_SANCTION:" + reportId);
    }

    /** 마이 › 내 이용 상태: running limits, 90-day no-shows, warnings, and sanctions that can still be appealed. */
    public Map<String, Object> status(long userId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("noShows", noShows(userId));
        out.put("apply", limit(active(userId, "APPLY")));
        out.put("write", limit(active(userId, "WRITE")));
        out.put("warnings", jdbc.queryForObject("SELECT COUNT(*) FROM sanctions WHERE user_id = ? AND source = 'REPORT' AND revoked_at IS NULL", Integer.class, userId));
        List<Map<String, Object>> list = jdbc.queryForList("""
                SELECT s.id, s.type, s.scope, s.source, s.reason, DATE_FORMAT(s.starts_at, '%Y-%m-%dT%H:%i') AS startsAt, DATE_FORMAT(s.ends_at, '%Y-%m-%dT%H:%i') AS endsAt,
                       s.revoked_at IS NOT NULL AS revoked, s.starts_at > ? AS appealable,
                       (SELECT ap.status FROM appeals ap WHERE ap.sanction_id = s.id) AS appeal
                FROM sanctions s WHERE s.user_id = ? ORDER BY s.starts_at DESC LIMIT 20""", now().minusDays(7), userId);
        list.forEach(row -> { row.put("revoked", ((Number) row.get("revoked")).intValue() == 1); row.put("appealable", ((Number) row.get("appealable")).intValue() == 1); });
        out.put("sanctions", list);
        out.put("noShowList", jdbc.queryForList("""
                SELECT p.id AS participationId, a.id AS activityId, a.title, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date,
                       a.ends_at > ? AS appealable, (SELECT ap.status FROM appeals ap WHERE ap.participation_id = p.id) AS appeal
                FROM participations p JOIN activities a ON a.id = p.activity_id
                WHERE p.user_id = ? AND p.status = 'NO_SHOW' AND p.noshow_cleared = FALSE AND a.starts_at > ? ORDER BY a.starts_at DESC""",
                now().minusDays(7), userId, now().minusDays(NOSHOW_DAYS)).stream().peek(row -> row.put("appealable", ((Number) row.get("appealable")).intValue() == 1)).toList());
        return out;
    }

    private static Map<String, Object> limit(Map<String, Object> row) {
        if (row == null) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("until", row.get("ends_at") == null ? null : row.get("ends_at").toString().replace(' ', 'T').substring(0, 16));
        out.put("reason", row.get("reason"));
        return out;
    }

    private LocalDateTime now() { return LocalDateTime.now(clock); }
}
