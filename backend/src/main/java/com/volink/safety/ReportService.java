package com.volink.safety;

import com.volink.auth.AuthService;
import com.volink.auth.AuthUser;
import com.volink.common.ApiException;
import com.volink.common.Sql;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reports (plan 6.2 ⑤). People who took part in an activity (organizer or a confirmed/attended participant) can report it
 * or a person in it. An admin can HOLD (participation/record or the activity is put on hold), then DISMISS or ACTION
 * (held things go back to their previous state) or INVALIDATE the reported person's participation and record.
 * Every decision needs a reason and is written to admin_actions; holds and restores are written to activity_logs.
 */
@Service
public class ReportService {
    static final List<String> REASONS = List.of("SAFETY", "FALSE_RECORD", "HARASSMENT", "INAPPROPRIATE", "OTHER");
    static final List<String> TOOK_PART = List.of("CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "HELD", "INVALIDATED");
    static final int PER_HOUR = 10;

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final NotificationService notifications;
    private final Clock clock;

    public ReportService(JdbcTemplate jdbc, AuthService auth, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.notifications = notifications;
        this.clock = clock;
    }

    public record ReportRequest(Long activityId, Long targetUserId, String reasonType, String description) {}

    @Transactional
    public Map<String, Object> create(long userId, ReportRequest request) {
        AuthUser user = auth.findById(userId);
        if ("SUSPENDED".equals(user.status())) throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_RESTRICTED", "정지된 계정은 신고할 수 없습니다.");
        Map<String, String> errors = new LinkedHashMap<>();
        if (request.reasonType() == null || !REASONS.contains(request.reasonType())) errors.put("reasonType", "신고 사유를 골라 주세요.");
        String description = request.description() == null ? "" : request.description().trim();
        if (description.length() < 10 || description.length() > 1000) errors.put("description", "신고 내용은 10~1000자로 적어 주세요.");
        if (request.activityId() == null) errors.put("activityId", "활동을 골라 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        long activityId = request.activityId();
        if (!tookPart(activityId, userId)) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "참여했거나 개설한 활동만 신고할 수 있습니다.");
        Long target = request.targetUserId();
        if (target != null && (target == userId || !tookPart(activityId, target)))
            throw ApiException.validation(Map.of("targetUserId", "이 활동에 참여한 다른 사람만 신고 대상으로 고를 수 있습니다."));
        if (jdbc.queryForObject("SELECT COUNT(*) FROM reports WHERE reporter_id = ? AND created_at >= NOW() - INTERVAL 1 HOUR", Integer.class, userId) >= PER_HOUR)
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS", "신고는 1시간에 " + PER_HOUR + "건까지 할 수 있습니다. 잠시 후 다시 시도해 주세요.");
        jdbc.update("INSERT INTO reports(reporter_id, activity_id, target_user_id, reason_type, description) VALUES (?, ?, ?, ?, ?)",
                userId, activityId, target, request.reasonType(), description);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return detail(id);
    }

    public List<Map<String, Object>> mine(long userId) {
        return jdbc.queryForList(Sql.kst("""
                SELECT r.id, r.activity_id AS activityId, a.title, r.reason_type AS reasonType, r.status, r.result_note AS resultNote,
                       DATE_FORMAT(KST(r.created_at), '%Y-%m-%d %H:%i') AS createdAt
                FROM reports r JOIN activities a ON a.id = r.activity_id WHERE r.reporter_id = ? ORDER BY r.id DESC
                """), userId);
    }

    public List<Map<String, Object>> list(String status) {
        boolean open = status == null || status.isBlank() || "OPEN".equals(status);
        List<Map<String, Object>> rows = jdbc.queryForList(Sql.kst("""
                SELECT r.id, r.activity_id AS activityId, a.title, a.status AS activityStatus, r.reason_type AS reasonType, r.description,
                       r.status, r.result_note AS resultNote, rep.display_name AS reporterName, r.target_user_id AS targetUserId,
                       t.display_name AS targetName, t.email AS targetEmail, DATE_FORMAT(KST(r.created_at), '%Y-%m-%d %H:%i') AS createdAt
                FROM reports r JOIN activities a ON a.id = r.activity_id JOIN users rep ON rep.id = r.reporter_id
                LEFT JOIN users t ON t.id = r.target_user_id
                WHERE""" + (open ? " r.status IN ('RECEIVED', 'REVIEWING')" : " r.status = ?") + " ORDER BY r.id"), open ? new Object[0] : new Object[]{status});
        rows.forEach(row -> row.put("evidences", jdbc.queryForList("SELECT id, content_type AS contentType, size_bytes AS sizeBytes FROM report_evidences WHERE report_id = ? ORDER BY id",
                ((Number) row.get("id")).longValue())));
        return rows;
    }

    public Map<String, Object> detail(long id) {
        return jdbc.queryForList("SELECT id, activity_id AS activityId, target_user_id AS targetUserId, reason_type AS reasonType, status FROM reports WHERE id = ?", id)
                .stream().findFirst().orElseThrow(ReportService::notFound);
    }

    /** HOLD / DISMISS / ACTION / INVALIDATE with a required reason. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void resolve(long adminId, long reportId, String action, String rawReason) {
        String reason = rawReason == null ? "" : rawReason.trim();
        if (reason.isEmpty()) throw ApiException.validation(Map.of("reason", "처리 사유를 입력해 주세요."));
        if (reason.length() > 500) throw ApiException.validation(Map.of("reason", "사유는 500자 이내로 입력해 주세요."));
        Map<String, Object> report = jdbc.queryForList("SELECT reporter_id, activity_id, target_user_id, status FROM reports WHERE id = ? FOR UPDATE", reportId)
                .stream().findFirst().orElseThrow(ReportService::notFound);
        String from = (String) report.get("status");
        if (!List.of("RECEIVED", "REVIEWING").contains(from)) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "이미 처리가 끝난 신고입니다.");
        long activityId = ((Number) report.get("activity_id")).longValue();
        Long target = report.get("target_user_id") == null ? null : ((Number) report.get("target_user_id")).longValue();
        LocalDateTime now = LocalDateTime.now(clock);
        String marker = "신고 #" + reportId;
        String to;
        switch (action == null ? "" : action) {
            case "HOLD" -> {
                if (target != null) holdParticipation(activityId, target, adminId, marker + " 보류: " + reason);
                else holdActivity(activityId, adminId, marker + " 보류: " + reason);
                jdbc.update("UPDATE reports SET status = 'REVIEWING' WHERE id = ?", reportId);
                to = "REVIEWING";
            }
            case "DISMISS", "ACTION" -> {
                restore(activityId, adminId, marker, reason);
                to = "DISMISS".equals(action) ? "DISMISSED" : "ACTION_TAKEN";
                close(reportId, to, adminId, now, reason);
            }
            case "INVALIDATE" -> {
                if (target == null) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "대상자가 있는 신고만 기록을 무효로 할 수 있습니다.");
                Map<String, Object> participation = jdbc.queryForList("SELECT id, status FROM participations WHERE activity_id = ? AND user_id = ? FOR UPDATE", activityId, target)
                        .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "대상자의 참가 기록이 없습니다."));
                long pid = ((Number) participation.get("id")).longValue();
                jdbc.update("UPDATE participations SET status = 'INVALIDATED', updated_at = ? WHERE id = ?", now, pid);
                jdbc.update("UPDATE activity_records SET status = 'INVALIDATED' WHERE participation_id = ?", pid);
                log(activityId, pid, adminId, (String) participation.get("status"), "INVALIDATED", marker + " 무효: " + reason);
                restore(activityId, adminId, marker, reason);
                notifications.send(target, "REPORT_RESULT", "참가 기록이 무효 처리되었습니다", "신고 검토 결과 · " + reason, "#/mine");
                to = "ACTION_TAKEN";
                close(reportId, to, adminId, now, reason);
            }
            default -> throw ApiException.validation(Map.of("action", "처리 방법을 골라 주세요."));
        }
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, 'REPORT', ?, ?, ?, ?, ?)",
                adminId, reportId, action, from, to, reason);
        if (!"REVIEWING".equals(to))
            notifications.send(((Number) report.get("reporter_id")).longValue(), "REPORT_RESULT", "신고 처리 결과를 알려 드립니다",
                    ("DISMISSED".equals(to) ? "조치 없이 종료되었습니다 · " : "조치가 이루어졌습니다 · ") + reason, "#/mine");
    }

    // ---- internals ----

    private boolean tookPart(long activityId, long userId) {
        Long organizer = jdbc.queryForList("SELECT organizer_id FROM activities WHERE id = ?", Long.class, activityId).stream().findFirst().orElseThrow(ReportService::notFound);
        if (organizer == userId) return true;
        return jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND user_id = ? AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'HELD', 'INVALIDATED')",
                Integer.class, activityId, userId) > 0;
    }

    private void holdParticipation(long activityId, long userId, long adminId, String reason) {
        Map<String, Object> row = jdbc.queryForList("SELECT id, status FROM participations WHERE activity_id = ? AND user_id = ? FOR UPDATE", activityId, userId).stream().findFirst().orElse(null);
        if (row == null || !List.of("CHECKED_IN", "COMPLETED").contains(row.get("status"))) {
            holdActivity(activityId, adminId, reason);
            return;
        }
        long pid = ((Number) row.get("id")).longValue();
        jdbc.update("UPDATE participations SET status = 'HELD', updated_at = ? WHERE id = ?", LocalDateTime.now(clock), pid);
        jdbc.update("UPDATE activity_records SET status = 'HELD' WHERE participation_id = ? AND status = 'VALID'", pid);
        log(activityId, pid, adminId, (String) row.get("status"), "HELD", reason);
    }

    private void holdActivity(long activityId, long adminId, String reason) {
        String status = jdbc.queryForObject("SELECT status FROM activities WHERE id = ? FOR UPDATE", String.class, activityId);
        if (!List.of("RECRUITING", "IN_PROGRESS", "FINISHED").contains(status)) return;
        jdbc.update("UPDATE activities SET status = 'HELD' WHERE id = ?", activityId);
        log(activityId, null, adminId, status, "HELD", reason);
    }

    /** Puts back everything this report held (the state before the hold is read from activity_logs). */
    private void restore(long activityId, long adminId, String marker, String reason) {
        for (Map<String, Object> held : jdbc.queryForList("SELECT participation_id, from_status FROM activity_logs WHERE activity_id = ? AND to_status = 'HELD' AND reason LIKE ? ORDER BY id",
                activityId, marker + " 보류%")) {
            String previous = (String) held.get("from_status");
            if (held.get("participation_id") == null) {
                if (jdbc.update("UPDATE activities SET status = ? WHERE id = ? AND status = 'HELD'", previous, activityId) > 0)
                    log(activityId, null, adminId, "HELD", previous, marker + " 재개: " + reason);
            } else {
                long pid = ((Number) held.get("participation_id")).longValue();
                if (jdbc.update("UPDATE participations SET status = ?, updated_at = ? WHERE id = ? AND status = 'HELD'", previous, LocalDateTime.now(clock), pid) > 0) {
                    jdbc.update("UPDATE activity_records SET status = 'VALID' WHERE participation_id = ? AND status = 'HELD'", pid);
                    log(activityId, pid, adminId, "HELD", previous, marker + " 재개: " + reason);
                }
            }
        }
    }

    private void close(long reportId, String status, long adminId, LocalDateTime now, String reason) {
        jdbc.update("UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, result_note = ? WHERE id = ?", status, adminId, now, reason, reportId);
    }

    private void log(long activityId, Long participationId, long actorId, String from, String to, String reason) {
        jdbc.update("INSERT INTO activity_logs(activity_id, participation_id, actor_id, from_status, to_status, reason) VALUES (?, ?, ?, ?, ?, ?)",
                activityId, participationId, actorId, from, to, reason.length() > 500 ? reason.substring(0, 500) : reason);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "신고를 찾을 수 없습니다.");
    }
}
