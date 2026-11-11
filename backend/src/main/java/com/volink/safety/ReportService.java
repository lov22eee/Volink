package com.volink.safety;

import com.volink.auth.AuthService;
import com.volink.common.ApiException;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 신고 (week 7, 2026-11-09): an activity, a community post or comment, a photo or a person; a reason, an optional note and
 * up to 3 photos; one report per person and target. An admin decides (인정 / 문제 없음) with a reason that is required; an
 * accepted report hides the post, comment or photo, moves its writer one step on the ladder (PenaltyService), and both
 * the reporter and the writer are told why. Every decision is kept in admin_actions.
 */
@Service
public class ReportService {
    static final Map<String, String> REASONS = Map.of("CONTACT", "연락처·외부 유도", "DANGER", "위험한 활동", "ABUSE", "욕설·혐오", "SPAM", "광고·도배",
            "FALSE_RECORD", "노쇼·허위 기록", "PRIVACY", "개인정보가 보여요", "OTHER", "기타");
    static final List<String> TARGETS = List.of("ACTIVITY", "POST", "COMMENT", "USER", "PHOTO");
    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final PhotoService photos;
    private final PenaltyService penalties;
    private final NotificationService notifications;
    private final Clock clock;

    public ReportService(JdbcTemplate jdbc, AuthService auth, PhotoService photos, PenaltyService penalties, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.photos = photos;
        this.penalties = penalties;
        this.notifications = notifications;
        this.clock = clock;
    }

    public record ReportRequest(String targetType, Long targetId, String reason, String description, List<Long> photoIds) {}

    @Transactional
    public Map<String, Object> create(long userId, ReportRequest request) {
        if (auth.findById(userId).admin()) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 계정은 신고하지 않아요.");
        Map<String, String> errors = new LinkedHashMap<>();
        String type = request == null || request.targetType() == null ? "" : request.targetType().trim();
        if (!TARGETS.contains(type) || request.targetId() == null) errors.put("target", "무엇을 신고할지 확인해 주세요.");
        String reason = request == null || request.reason() == null ? "" : request.reason().trim();
        if (!REASONS.containsKey(reason)) errors.put("reason", "어떤 문제인지 골라 주세요.");
        String text = request == null || request.description() == null ? "" : request.description().trim();
        if (text.length() > 1000) errors.put("description", "1000자 이내로 적어 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        Target target = target(type, request.targetId());
        if (target.owner() != null && target.owner() == userId) throw new ApiException(HttpStatus.CONFLICT, "OWN_TARGET", "내 글이나 활동은 신고할 수 없어요.");
        if (jdbc.queryForObject("SELECT COUNT(*) FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ?", Integer.class, userId, type, request.targetId()) > 0)
            throw new ApiException(HttpStatus.CONFLICT, "REPORT_EXISTS", "이미 신고했어요. 결과를 알림으로 알려 드릴게요.");
        int today = jdbc.queryForObject("SELECT COUNT(*) FROM reports WHERE reporter_id = ? AND created_at > NOW() - INTERVAL 1 DAY", Integer.class, userId);
        if (today >= 10) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REPORTS", "신고는 하루에 10번까지 할 수 있어요.");
        jdbc.update("INSERT INTO reports(reporter_id, target_type, target_id, activity_id, target_user_id, reason_type, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
                userId, type, request.targetId(), target.activityId(), target.owner(), reason, text);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        photos.toEvidence(userId, id, request.photoIds());
        return Map.of("id", id, "status", "RECEIVED");
    }

    record Target(Long owner, Long activityId, String summary) {}

    /** Who wrote / runs the target, its activity and a short line for the admin (never the reporter's name to the writer). */
    Target target(String type, long id) {
        Map<String, Object> row = switch (type) {
            case "ACTIVITY" -> one("SELECT organizer_id AS owner, id AS activity, title AS text FROM activities WHERE id = ? AND status <> 'DELETED'", id);
            case "POST" -> one("SELECT author_id AS owner, activity_id AS activity, CONCAT(title, ' · ', LEFT(body, 120)) AS text FROM community_posts WHERE id = ? AND deleted_at IS NULL", id);
            case "COMMENT" -> one("SELECT author_id AS owner, NULL AS activity, LEFT(body, 160) AS text FROM community_comments WHERE id = ? AND deleted_at IS NULL", id);
            case "PHOTO" -> one("SELECT p.owner_id AS owner, NULL AS activity, CONCAT('사진 · ', c.title) AS text FROM post_photos p LEFT JOIN community_posts c ON c.id = p.post_id WHERE p.id = ?", id);
            default -> one("SELECT id AS owner, NULL AS activity, COALESCE(community_nickname, '회원') AS text FROM users WHERE id = ? AND status <> 'WITHDRAWN'", id);
        };
        if (row == null) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "신고할 대상을 찾을 수 없어요.");
        return new Target(row.get("owner") == null ? null : ((Number) row.get("owner")).longValue(), row.get("activity") == null ? null : ((Number) row.get("activity")).longValue(), (String) row.get("text"));
    }

    private Map<String, Object> one(String sql, long id) {
        return jdbc.queryForList(sql, id).stream().findFirst().orElse(null);
    }

    public List<Map<String, Object>> mine(long userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, target_type AS targetType, target_id AS targetId, reason_type AS reason, status, result_note AS resultNote,
                       DATE_FORMAT(KST(created_at), '%Y-%m-%dT%H:%i') AS createdAt FROM reports WHERE reporter_id = ? ORDER BY id DESC LIMIT 30""".replace("KST(created_at)", "CONVERT_TZ(created_at, @@session.time_zone, '+09:00')"), userId);
        rows.forEach(row -> row.put("reasonLabel", REASONS.getOrDefault((String) row.get("reason"), "기타")));
        return rows;
    }

    // ---- admin ----

    public List<Map<String, Object>> queue(String status) {
        String filter = "DONE".equals(status) ? "r.status IN ('ACTION_TAKEN', 'DISMISSED')" : "r.status IN ('RECEIVED', 'REVIEWING')";
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT r.id, r.target_type AS targetType, r.target_id AS targetId, r.reason_type AS reason, r.description, r.status, r.result_note AS resultNote,
                       DATE_FORMAT(CONVERT_TZ(r.created_at, @@session.time_zone, '+09:00'), '%Y-%m-%d %H:%i') AS createdAt, r.target_user_id AS targetUserId,
                       (SELECT COUNT(*) FROM reports s WHERE s.target_type = r.target_type AND s.target_id = r.target_id) AS sameTarget,
                       (SELECT COUNT(*) FROM sanctions x WHERE x.user_id = r.target_user_id AND x.source = 'REPORT' AND x.revoked_at IS NULL) AS warnings
                FROM reports r WHERE\s""" + filter + " ORDER BY r.id DESC LIMIT 100");
        for (Map<String, Object> row : rows) {
            row.put("reasonLabel", REASONS.getOrDefault((String) row.get("reason"), "기타"));
            try { row.put("summary", target((String) row.get("targetType"), ((Number) row.get("targetId")).longValue()).summary()); }
            catch (ApiException gone) { row.put("summary", "(지워진 대상)"); }
            row.put("evidence", jdbc.queryForList("SELECT id FROM report_evidences WHERE report_id = ? ORDER BY id", Long.class, row.get("id")));
        }
        return rows;
    }

    public record Decision(String decision, Boolean hide, String reason) {}

    /** 인정 (ACCEPT): hide it (optional), one step on the writer's ladder; 문제 없음 (DISMISS). Reason required either way. */
    @Transactional
    public Map<String, Object> decide(long adminId, long reportId, Decision request) {
        String decision = request == null || request.decision() == null ? "" : request.decision().trim();
        String why = request == null || request.reason() == null ? "" : request.reason().trim();
        Map<String, String> errors = new LinkedHashMap<>();
        if (!List.of("ACCEPT", "DISMISS").contains(decision)) errors.put("decision", "처리 방법을 골라 주세요.");
        if (why.isEmpty() || why.length() > 500) errors.put("reason", "처리 사유를 적어 주세요 (500자 이내).");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        Map<String, Object> report = jdbc.queryForList("SELECT * FROM reports WHERE id = ? FOR UPDATE", reportId).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "신고를 찾을 수 없어요."));
        if (!List.of("RECEIVED", "REVIEWING").contains(report.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_HANDLED", "이미 처리한 신고예요.");
        String type = (String) report.get("target_type");
        long targetId = ((Number) report.get("target_id")).longValue();
        LocalDateTime now = LocalDateTime.now(clock);
        String to = "ACCEPT".equals(decision) ? "ACTION_TAKEN" : "DISMISSED";
        boolean hide = "ACCEPT".equals(decision) && Boolean.TRUE.equals(request.hide());
        // Every open report on the same target is closed with the same decision (one decision, one ladder step).
        List<Map<String, Object>> same = jdbc.queryForList("SELECT id, reporter_id FROM reports WHERE target_type = ? AND target_id = ? AND status IN ('RECEIVED', 'REVIEWING') FOR UPDATE", type, targetId);
        for (Map<String, Object> r : same) {
            jdbc.update("UPDATE reports SET status = ?, handled_by = ?, handled_at = ?, result_note = ?, hidden = ? WHERE id = ?", to, adminId, now, why, hide, r.get("id"));
            jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, 'REPORT', ?, ?, 'RECEIVED', ?, ?)",
                    adminId, r.get("id"), "ACCEPT".equals(decision) ? (hide ? "REPORT_HIDE" : "REPORT_ACCEPT") : "REPORT_DISMISS", to, why);
            notifications.send(((Number) r.get("reporter_id")).longValue(), "REPORT_RESULT", "ACCEPT".equals(decision) ? (hide ? "신고한 내용이 숨김 처리됐어요" : "신고가 받아들여졌어요") : "신고를 확인했어요",
                    "ACCEPT".equals(decision) ? "사유: " + why + " · 알려 주셔서 고마워요" : "문제가 없다고 판단했어요 · " + why, "#/my?view=status", null, "REPORT_RESULT:" + r.get("id"));
        }
        if (hide) {
            switch (type) {
                case "POST" -> { jdbc.update("UPDATE community_posts SET hidden_at = ? WHERE id = ?", now, targetId); jdbc.update("UPDATE post_photos SET hidden = TRUE WHERE post_id = ?", targetId); }
                case "COMMENT" -> jdbc.update("UPDATE community_comments SET hidden_at = ? WHERE id = ?", now, targetId);
                case "PHOTO" -> jdbc.update("UPDATE post_photos SET hidden = TRUE WHERE id = ?", targetId);
                default -> { /* an activity or a person is not hidden here; the ladder limits the person */ }
            }
        }
        Object owner = report.get("target_user_id");
        if ("ACCEPT".equals(decision) && owner != null) {
            if (hide && !"USER".equals(type) && !"ACTIVITY".equals(type))
                notifications.send(((Number) owner).longValue(), "SANCTION", "내 " + ("COMMENT".equals(type) ? "댓글" : "PHOTO".equals(type) ? "사진" : "글") + "이 숨김 처리됐어요",
                        "사유: " + why + " · 7일 안에 이의 신청할 수 있어요", "#/my?view=status", null, "REPORT_HIDE:" + reportId);
            penalties.afterReport(((Number) owner).longValue(), reportId, adminId, REASONS.getOrDefault((String) report.get("reason_type"), "신고") + " · " + why);
        }
        return Map.of("status", to, "closed", same.size());
    }
}
