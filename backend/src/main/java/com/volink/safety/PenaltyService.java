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

    /** Throws 403 RESTRICTED while an APPLY (or ALL) limit runs; WRITE for 글·댓글; HOST (the WRITE limit) for opening a 모집글. */
    public void check(long userId, String what) {
        Map<String, Object> active = active(userId, what);
        if (active == null) return;
        LocalDateTime until = (LocalDateTime) active.get("ends_at");
        String verb = "APPLY".equals(what) ? "신청할" : "HOST".equals(what) ? "모집글을 만들" : "글을 쓸";
        throw new ApiException(HttpStatus.FORBIDDEN, "RESTRICTED", (until == null ? "지금은 " : when(until) + "까지 ") + verb + " 수 없어요. " + active.get("reason"));
    }

    /**
     * Which sanction scopes stop what (V39): APPLY ← APPLY·ALL; WRITE (글·댓글) ← WRITE·POST·ALL; HOST (모집글) ← POST·ALL.
     * Report limits are WRITE or POST only, so 봉사 신청·참여 stays open whatever the reports (2026-11-12, user decision).
     */
    private Map<String, Object> active(long userId, String what) {
        String scopes = "APPLY".equals(what) ? "'APPLY', 'ALL'" : "HOST".equals(what) ? "'POST', 'ALL'" : "'WRITE', 'POST', 'ALL'";
        return jdbc.queryForList("""
                SELECT id, type, scope, reason, starts_at, ends_at FROM sanctions
                WHERE user_id = ? AND revoked_at IS NULL AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?) AND scope IN (""" + scopes + """
                ) ORDER BY ends_at IS NULL DESC, ends_at DESC LIMIT 1""", userId, now(), now()).stream().findFirst().orElse(null);
    }

    /** "11월 19일" for a day-long limit, "11월 13일 15:20" when it ends within a day or two (the 24시간 step). */
    private String when(LocalDateTime until) {
        return until.isBefore(now().plusDays(2)) ? DAY.format(until) + " " + String.format("%02d:%02d", until.getHour(), until.getMinute()) : DAY.format(until);
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
        else if (n == 2) {
            Long participation = jdbc.queryForList("SELECT id FROM participations WHERE user_id = ? AND activity_id = ? ORDER BY id DESC LIMIT 1", Long.class, userId, activityId).stream().findFirst().orElse(null);
            notice(userId, "NOSHOW", 2, null, null, participation);
            notifications.send(userId, "SANCTION", "불참이 2번이에요", "최근 90일 불참 2번 · 한 번 더 불참하면 14일 동안 신청할 수 없어요",
                "#/my?view=status", activityId, "NOSHOW:" + activityId + ":" + userId);
        }
        else if (active(userId, "APPLY") == null) {
            LocalDateTime until = now().plusDays(NOSHOW_RESTRICT_DAYS);
            jdbc.update("INSERT INTO sanctions(user_id, type, scope, source, reason, starts_at, ends_at, created_by) VALUES (?, 'RESTRICTION', 'APPLY', 'NOSHOW', ?, ?, ?, ?)",
                    userId, "최근 90일 불참 " + n + "번", now(), until, userId);
            notice(userId, "NOSHOW", 3, lastSanction(userId, "NOSHOW"), null, null);
            notifications.send(userId, "SANCTION", DAY.format(until) + "까지 신청할 수 없어요", "최근 90일 불참 " + n + "번이에요 · 잘못된 기록은 이의 신청할 수 있어요",
                    "#/my?view=status", activityId, "NOSHOW:" + activityId + ":" + userId);
        }
    }

    /** Report steps counted over the last year (2026-11-12, user decision); a lifted one does not count. */
    static final int REPORT_DAYS = 365, REVIEW_FROM = 6;
    private static final int[] REPORT_HOURS = { 0, 0, 24, 7 * 24, 14 * 24, 30 * 24 };

    public int reportSteps(long userId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM sanctions WHERE user_id = ? AND source = 'REPORT' AND revoked_at IS NULL AND starts_at > ?",
                Integer.class, userId, now().minusDays(REPORT_DAYS));
    }

    /**
     * An admin accepted a report about this person: the next step (within a year). Reports limit the community only —
     * 1 경고 · 2 24시간 글·댓글 · 3 7일 · 4 14일 · 5 30일 글·댓글·모집글 · 6+ 30일 again and the admin's 할 일 gets
     * 커뮤니티 이용 정지 검토 (no automatic indefinite stop). 봉사 신청·참여 is never limited by reports.
     */
    public void afterReport(long userId, long reportId, long adminId, String why) {
        int n = reportSteps(userId) + 1;
        LocalDateTime now = now();
        String type = n == 1 ? "WARNING" : "RESTRICTION";
        String scope = n == 1 ? "NONE" : n == 2 ? "WRITE" : "POST";
        LocalDateTime until = n == 1 ? null : now.plusHours(REPORT_HOURS[Math.min(n, 5)]);
        jdbc.update("INSERT INTO sanctions(user_id, type, scope, source, reason, report_id, starts_at, ends_at, created_by) VALUES (?, ?, ?, 'REPORT', ?, ?, ?, ?, ?)",
                userId, type, scope, "신고 인정 " + n + "번 · " + why, reportId, now, until, adminId);
        notice(userId, "REPORT", Math.min(3, n), lastSanction(userId, "REPORT"), reportId, null);
        String title = n == 1 ? "신고가 인정돼 경고를 받았어요" : n == 2 ? when(until) + "까지 글을 쓸 수 없어요" : when(until) + "까지 글과 모집글을 쓸 수 없어요";
        String body = "사유: " + why + (n == 1 ? " · 한 번 더 인정되면 24시간 동안 글을 쓸 수 없어요" : " · 봉사 신청·참여는 그대로 할 수 있어요 · 잘못됐다면 7일 안에 이의 신청할 수 있어요");
        notifications.send(userId, "SANCTION", title, body, "#/my?view=status", null, "REPORT_SANCTION:" + reportId);
    }

    /**
     * 커뮤니티 이용 정지 검토 (admin 할 일): people with 6 or more report steps within a year whom no admin has decided on since
     * their last step, and who are not stopped already.
     */
    public List<Map<String, Object>> suspensionReviews() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT u.id AS userId, COALESCE(u.community_nickname, u.display_name) AS name, COUNT(*) AS steps, MAX(s.starts_at) AS lastStep
                FROM sanctions s JOIN users u ON u.id = s.user_id
                WHERE s.source = 'REPORT' AND s.revoked_at IS NULL AND s.starts_at > ?
                GROUP BY u.id, u.community_nickname, u.display_name
                HAVING COUNT(*) >= ? ORDER BY MAX(s.starts_at)""", now().minusDays(REPORT_DAYS), REVIEW_FROM);
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (Map<String, Object> row : rows) {
            long user = ((Number) row.get("userId")).longValue();
            LocalDateTime last = (LocalDateTime) row.get("lastStep");
            boolean stopped = jdbc.queryForObject("SELECT COUNT(*) FROM sanctions WHERE user_id = ? AND type = 'SUSPENSION' AND ends_at IS NULL AND revoked_at IS NULL", Integer.class, user) > 0;
            // admin_actions.created_at is a TIMESTAMP: compare in Korean time.
            boolean decided = jdbc.queryForObject("""
                    SELECT COUNT(*) FROM admin_actions WHERE target_type = 'USER' AND target_id = ? AND action IN ('COMMUNITY_STOP', 'COMMUNITY_KEEP')
                      AND CONVERT_TZ(created_at, @@session.time_zone, '+09:00') >= ?""", Integer.class, user, last) > 0;
            if (stopped || decided) continue;
            row.put("lastAt", last.toString().replace('T', ' ').substring(0, 16));
            row.remove("lastStep");
            out.add(row);
        }
        return out;
    }

    /** The admin's decision: STOP = 커뮤니티 이용 정지 (no end, appealable, an admin can lift it), KEEP = the 30-day limit only. */
    public Map<String, Object> decideSuspension(long adminId, long userId, String decision, String why) {
        String reason = why == null ? "" : why.trim();
        if (!List.of("STOP", "KEEP").contains(decision) || reason.isEmpty() || reason.length() > 500)
            throw ApiException.validation(Map.of(reason.isEmpty() || reason.length() > 500 ? "reason" : "decision", reason.isEmpty() || reason.length() > 500 ? "처리 사유를 적어 주세요 (500자 이내)." : "처리 방법을 골라 주세요."));
        if (suspensionReviews().stream().noneMatch(r -> ((Number) r.get("userId")).longValue() == userId))
            throw new ApiException(HttpStatus.CONFLICT, "ALREADY_HANDLED", "이미 처리했거나 검토할 대상이 아니에요.");
        if ("STOP".equals(decision)) {
            jdbc.update("INSERT INTO sanctions(user_id, type, scope, source, reason, starts_at, ends_at, created_by) VALUES (?, 'SUSPENSION', 'POST', 'ADMIN', ?, ?, NULL, ?)",
                    userId, "커뮤니티 이용 정지 · " + reason, now(), adminId);
            notice(userId, "REPORT", 3, lastSanction(userId, "ADMIN"), null, null);
            notifications.send(userId, "SANCTION", "커뮤니티 이용이 정지됐어요", "사유: " + reason + " · 봉사 신청·참여는 그대로 할 수 있어요 · 잘못됐다면 7일 안에 이의 신청할 수 있어요",
                    "#/my?view=status", null, "COMMUNITY_STOP:" + userId + ":" + now());
        }
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, reason) VALUES (?, 'USER', ?, ?, ?)",
                adminId, userId, "STOP".equals(decision) ? "COMMUNITY_STOP" : "COMMUNITY_KEEP", reason);
        return Map.of("status", decision);
    }

    /** 마이 › 내 이용 상태: running limits, 90-day no-shows, warnings, and sanctions that can still be appealed. */
    public Map<String, Object> status(long userId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("noShows", noShows(userId));
        out.put("apply", limit(active(userId, "APPLY")));
        out.put("write", limit(active(userId, "WRITE")));
        out.put("host", limit(active(userId, "HOST")));
        out.put("warnings", reportSteps(userId));
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

    // ---- 경고 시트 (2026-11-12, V38): one sheet the next time the app opens, until the person ticks 확인했어요. ----

    private void notice(long userId, String kind, int step, Long sanctionId, Long reportId, Long participationId) {
        jdbc.update("INSERT INTO safety_notices(user_id, kind, step, sanction_id, report_id, participation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                userId, kind, step, sanctionId, reportId, participationId, now());
    }

    private Long lastSanction(long userId, String source) {
        return jdbc.queryForList("SELECT id FROM sanctions WHERE user_id = ? AND source = ? ORDER BY id DESC LIMIT 1", Long.class, userId, source).stream().findFirst().orElse(null);
    }

    /**
     * The newest warning not yet confirmed, with what the sheet shows: for a report the hidden post/comment and the reason,
     * for no-shows the activity and the dates. A warning whose sanction was lifted or whose no-show was cleared (이의 인정) is skipped.
     * Null when there is nothing to show.
     */
    public Map<String, Object> pendingNotice(long userId) {
        Map<String, Object> row = jdbc.queryForList("""
                SELECT n.id, n.kind, n.step, n.report_id, n.participation_id, s.ends_at, s.reason
                FROM safety_notices n
                LEFT JOIN sanctions s ON s.id = n.sanction_id
                LEFT JOIN participations p ON p.id = n.participation_id
                WHERE n.user_id = ? AND n.acked_at IS NULL AND (s.id IS NULL OR s.revoked_at IS NULL) AND (p.id IS NULL OR p.noshow_cleared = FALSE)
                ORDER BY n.id DESC LIMIT 1""", userId).stream().findFirst().orElse(null);
        if (row == null) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", row.get("id"));
        out.put("kind", row.get("kind"));
        out.put("step", row.get("step"));
        out.put("until", row.get("ends_at") == null ? null : row.get("ends_at").toString().replace(' ', 'T').substring(0, 16));
        if ("REPORT".equals(row.get("kind")) && row.get("report_id") != null) {
            Map<String, Object> report = jdbc.queryForList("SELECT target_type, target_id, reason_type, result_note FROM reports WHERE id = ?", row.get("report_id")).stream().findFirst().orElse(null);
            if (report != null) {
                String type = (String) report.get("target_type");
                long target = ((Number) report.get("target_id")).longValue();
                Map<String, Object> text = switch (type) {
                    case "POST" -> one("SELECT title, LEFT(body, 120) AS body FROM community_posts WHERE id = ?", target);
                    case "COMMENT" -> one("SELECT NULL AS title, LEFT(body, 120) AS body FROM community_comments WHERE id = ?", target);
                    case "PHOTO" -> one("SELECT c.title, NULL AS body FROM post_photos p LEFT JOIN community_posts c ON c.id = p.post_id WHERE p.id = ?", target);
                    case "ACTIVITY" -> one("SELECT title, NULL AS body FROM activities WHERE id = ?", target);
                    default -> null;
                };
                out.put("targetType", type);
                out.put("targetTitle", text == null ? null : text.get("title"));
                out.put("targetBody", text == null ? null : text.get("body"));
                out.put("reason", ReportService.REASONS.getOrDefault((String) report.get("reason_type"), "기타"));
                out.put("note", report.get("result_note"));
            }
        }
        if ("NOSHOW".equals(row.get("kind"))) {
            List<Map<String, Object>> list = jdbc.queryForList("""
                    SELECT a.title, DATE_FORMAT(a.starts_at, '%Y-%m-%dT%H:%i') AS startsAt
                    FROM participations p JOIN activities a ON a.id = p.activity_id
                    WHERE p.user_id = ? AND p.status = 'NO_SHOW' AND p.noshow_cleared = FALSE AND a.starts_at > ? ORDER BY a.starts_at DESC""",
                    userId, now().minusDays(NOSHOW_DAYS));
            out.put("noShows", list);
        }
        return out;
    }

    /** 확인했어요: this warning and any older one still open. */
    public void ackNotice(long userId, long id) {
        // The newest step of one kind stands for the older steps of the same kind (불참 2회 → 3회); a warning of the other kind
        // (신고 vs 불참) still shows next (2026-11-14: one 확인 used to clear both).
        jdbc.update("""
                UPDATE safety_notices SET acked_at = ? WHERE user_id = ? AND id <= ? AND acked_at IS NULL
                  AND kind = (SELECT k FROM (SELECT kind AS k FROM safety_notices WHERE id = ? AND user_id = ?) x)""", now(), userId, id, id, userId);
    }

    private Map<String, Object> one(String sql, long id) {
        return jdbc.queryForList(sql, id).stream().findFirst().orElse(null);
    }

    /** Whole seconds: DATETIME rounds fractions, and a limit starting a second "later" would not apply at once. */
    private LocalDateTime now() { return LocalDateTime.now(clock).truncatedTo(java.time.temporal.ChronoUnit.SECONDS); }
}
