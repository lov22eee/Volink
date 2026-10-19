package com.volink.safety;

import com.volink.common.ApiException;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Appeals against a completion record within 7 days of the organizer's confirmation (plan 6.2 ④).
 * The record owner, the organizer or another participant who completed the same activity can appeal.
 * The record is held until an admin accepts (record and participation become INVALIDATED) or rejects (back to VALID).
 */
@Service
public class AppealService {
    public static final Duration PERIOD = Duration.ofDays(7);

    private final JdbcTemplate jdbc;
    private final NotificationService notifications;
    private final Clock clock;

    public AppealService(JdbcTemplate jdbc, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.clock = clock;
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> submit(long userId, long recordId, String rawReason) {
        Map<String, Object> record = jdbc.queryForList("""
                SELECT r.id, r.status, r.confirmed_at, p.id AS participation_id, p.user_id AS owner, a.id AS activity_id, a.organizer_id, a.title
                FROM activity_records r JOIN participations p ON p.id = r.participation_id JOIN activities a ON a.id = p.activity_id
                WHERE r.id = ? FOR UPDATE""", recordId).stream().findFirst().orElseThrow(AppealService::notFound);
        long owner = ((Number) record.get("owner")).longValue();
        long activityId = ((Number) record.get("activity_id")).longValue();
        boolean allowed = owner == userId || ((Number) record.get("organizer_id")).longValue() == userId
                || jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND user_id = ? AND status IN ('COMPLETED', 'HELD')", Integer.class, activityId, userId) > 0;
        if (!allowed) throw notFound();
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDateTime deadline = ((LocalDateTime) record.get("confirmed_at")).plus(PERIOD);
        if (now.isAfter(deadline)) throw new ApiException(HttpStatus.GONE, "APPEAL_PERIOD_OVER", "이의 신청은 완료 확인 후 7일 안에만 할 수 있습니다.");
        String reason = rawReason == null ? "" : rawReason.trim();
        if (reason.length() < 10 || reason.length() > 1000) throw ApiException.validation(Map.of("reason", "이의 내용은 10~1000자로 적어 주세요."));
        if (jdbc.queryForObject("SELECT COUNT(*) FROM appeals WHERE record_id = ? AND user_id = ?", Integer.class, recordId, userId) > 0)
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_APPEAL", "이미 이의를 신청한 기록입니다.");
        jdbc.update("INSERT INTO appeals(record_id, user_id, reason, submitted_at, deadline_at) VALUES (?, ?, ?, ?, ?)", recordId, userId, reason, now, deadline);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        long participation = ((Number) record.get("participation_id")).longValue();
        if ("VALID".equals(record.get("status"))) {
            jdbc.update("UPDATE activity_records SET status = 'HELD' WHERE id = ?", recordId);
            jdbc.update("UPDATE participations SET status = 'HELD', updated_at = ? WHERE id = ? AND status = 'COMPLETED'", now, participation);
            log(activityId, participation, userId, "COMPLETED", "HELD", "이의 신청 #" + id);
        }
        if (owner != userId) notifications.send(owner, "REPORT_RESULT", "활동 기록에 이의가 접수되었습니다",
                record.get("title") + " · 관리자가 확인할 때까지 기록이 보류됩니다.", "#/mine");
        return Map.of("id", id, "status", "SUBMITTED", "deadline", deadline.toString());
    }

    public List<Map<String, Object>> list() {
        return jdbc.queryForList("""
                SELECT ap.id, ap.record_id AS recordId, ap.reason, ap.status, DATE_FORMAT(ap.submitted_at, '%Y-%m-%d %H:%i') AS submittedAt,
                       u.display_name AS appellantName, o.display_name AS ownerName, a.id AS activityId, a.title
                FROM appeals ap JOIN users u ON u.id = ap.user_id JOIN activity_records r ON r.id = ap.record_id
                JOIN participations p ON p.id = r.participation_id JOIN users o ON o.id = p.user_id JOIN activities a ON a.id = p.activity_id
                WHERE ap.status = 'SUBMITTED' ORDER BY ap.id""");
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void decide(long adminId, long appealId, boolean accept, String rawReason) {
        String reason = rawReason == null ? "" : rawReason.trim();
        if (reason.isEmpty()) throw ApiException.validation(Map.of("reason", "처리 사유를 입력해 주세요."));
        if (reason.length() > 500) throw ApiException.validation(Map.of("reason", "사유는 500자 이내로 입력해 주세요."));
        Map<String, Object> appeal = jdbc.queryForList("""
                SELECT ap.status, ap.user_id, ap.record_id, p.id AS participation_id, p.user_id AS owner, p.activity_id
                FROM appeals ap JOIN activity_records r ON r.id = ap.record_id JOIN participations p ON p.id = r.participation_id
                WHERE ap.id = ? FOR UPDATE""", appealId).stream().findFirst().orElseThrow(AppealService::notFound);
        if (!"SUBMITTED".equals(appeal.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "이미 처리한 이의 신청입니다.");
        LocalDateTime now = LocalDateTime.now(clock);
        long recordId = ((Number) appeal.get("record_id")).longValue();
        long participation = ((Number) appeal.get("participation_id")).longValue();
        long activityId = ((Number) appeal.get("activity_id")).longValue();
        jdbc.update("UPDATE appeals SET status = ?, handled_by = ?, handled_at = ?, result_note = ? WHERE id = ?", accept ? "ACCEPTED" : "REJECTED", adminId, now, reason, appealId);
        if (accept) {
            jdbc.update("UPDATE activity_records SET status = 'INVALIDATED' WHERE id = ?", recordId);
            String from = jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, participation);
            jdbc.update("UPDATE participations SET status = 'INVALIDATED', updated_at = ? WHERE id = ?", now, participation);
            log(activityId, participation, adminId, from, "INVALIDATED", "이의 신청 #" + appealId + " 인정: " + reason);
        } else if (jdbc.queryForObject("SELECT COUNT(*) FROM appeals WHERE record_id = ? AND status = 'SUBMITTED'", Integer.class, recordId) == 0) {
            // No other open appeal on this record: it becomes valid again.
            jdbc.update("UPDATE activity_records SET status = 'VALID' WHERE id = ? AND status = 'HELD'", recordId);
            if (jdbc.update("UPDATE participations SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND status = 'HELD'", now, participation) > 0)
                log(activityId, participation, adminId, "HELD", "COMPLETED", "이의 신청 #" + appealId + " 기각: " + reason);
        }
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, 'APPEAL', ?, ?, 'SUBMITTED', ?, ?)",
                adminId, appealId, accept ? "ACCEPT" : "REJECT", accept ? "ACCEPTED" : "REJECTED", reason);
        String text = (accept ? "이의가 받아들여져 기록이 무효 처리되었습니다 · " : "이의가 받아들여지지 않았습니다 · ") + reason;
        notifications.send(((Number) appeal.get("user_id")).longValue(), "REPORT_RESULT", "이의 신청 결과", text, "#/mine");
        long owner = ((Number) appeal.get("owner")).longValue();
        if (owner != ((Number) appeal.get("user_id")).longValue()) notifications.send(owner, "REPORT_RESULT", "활동 기록 확인 결과", text, "#/mine");
    }

    private void log(long activityId, long participationId, long actorId, String from, String to, String reason) {
        jdbc.update("INSERT INTO activity_logs(activity_id, participation_id, actor_id, from_status, to_status, reason) VALUES (?, ?, ?, ?, ?, ?)",
                activityId, participationId, actorId, from, to, reason.length() > 500 ? reason.substring(0, 500) : reason);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "활동 기록을 찾을 수 없습니다.");
    }
}
