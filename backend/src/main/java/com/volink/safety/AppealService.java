package com.volink.safety;

import com.volink.common.ApiException;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.Duration;
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
 * 이의신청 (week 7, 2026-11-09): within 7 days, about a 불참 (no-show), an activity record or a sanction. A no-show or record
 * goes to the organizer first (3 days to answer: 출석으로 바꾸기 / 그대로 두기 with a reason); kept or unanswered → an admin
 * decides with a reason. A record under appeal is HELD (보류). Accepted: the no-show becomes attended (a manual check-in and
 * a record) and stops counting, a record goes back to VALID, a sanction is lifted.
 */
@Service
public class AppealService {
    public static final Duration WINDOW = Duration.ofDays(7), HOST_TIME = Duration.ofDays(3);
    static final Map<String, String> REASONS = Map.of("ATTENDED", "실제로 참여했어요", "TIME", "시간이 달라요", "TOO_MUCH", "조치가 지나쳐요", "OTHER", "기타");
    private final JdbcTemplate jdbc;
    private final PhotoService photos;
    private final NotificationService notifications;
    private final Clock clock;

    public AppealService(JdbcTemplate jdbc, PhotoService photos, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.photos = photos;
        this.notifications = notifications;
        this.clock = clock;
    }

    public record AppealRequest(String kind, Long participationId, Long recordId, Long sanctionId, String reasonCode, String reason) {}

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> create(long userId, AppealRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        String kind = request == null || request.kind() == null ? "" : request.kind().trim();
        if (!List.of("NO_SHOW", "RECORD", "SANCTION").contains(kind)) errors.put("kind", "무엇에 대한 이의인지 확인해 주세요.");
        String code = request == null || request.reasonCode() == null ? "OTHER" : request.reasonCode().trim();
        if (!REASONS.containsKey(code)) errors.put("reasonCode", "이유를 골라 주세요.");
        String text = request == null || request.reason() == null ? "" : request.reason().trim();
        if (text.length() < 5 || text.length() > 1000) errors.put("reason", "설명을 5자 이상 적어 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        LocalDateTime now = LocalDateTime.now(clock).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        Long participation = null, record = null, sanction = null, activity = null, host = null;
        LocalDateTime from;
        switch (kind) {
            case "NO_SHOW" -> {
                Map<String, Object> p = row("SELECT p.id, p.user_id, p.status, a.id AS activity, a.organizer_id AS host, a.ends_at, a.title FROM participations p JOIN activities a ON a.id = p.activity_id WHERE p.id = ? FOR UPDATE", request.participationId());
                if (p == null || ((Number) p.get("user_id")).longValue() != userId || !"NO_SHOW".equals(p.get("status"))) throw notFound();
                participation = request.participationId(); activity = ((Number) p.get("activity")).longValue(); host = ((Number) p.get("host")).longValue();
                from = (LocalDateTime) p.get("ends_at");
            }
            case "RECORD" -> {
                Map<String, Object> r = row("SELECT r.id, r.confirmed_at, r.status, p.user_id, a.id AS activity, a.organizer_id AS host FROM activity_records r JOIN participations p ON p.id = r.participation_id JOIN activities a ON a.id = p.activity_id WHERE r.id = ? FOR UPDATE", request.recordId());
                if (r == null || ((Number) r.get("user_id")).longValue() != userId) throw notFound();
                record = request.recordId(); activity = ((Number) r.get("activity")).longValue(); host = ((Number) r.get("host")).longValue();
                from = (LocalDateTime) r.get("confirmed_at");
            }
            default -> {
                Map<String, Object> s = row("SELECT id, user_id, starts_at FROM sanctions WHERE id = ? AND revoked_at IS NULL", request.sanctionId());
                if (s == null || ((Number) s.get("user_id")).longValue() != userId) throw notFound();
                sanction = request.sanctionId();
                from = (LocalDateTime) s.get("starts_at");
            }
        }
        if (now.isAfter(from.plus(WINDOW))) throw new ApiException(HttpStatus.CONFLICT, "APPEAL_CLOSED", "이의 신청은 7일 안에만 할 수 있어요.");
        String column = participation != null ? "participation_id" : record != null ? "record_id" : "sanction_id";
        Long target = participation != null ? participation : record != null ? record : sanction;
        if (jdbc.queryForObject("SELECT COUNT(*) FROM appeals WHERE " + column + " = ?", Integer.class, target) > 0)
            throw new ApiException(HttpStatus.CONFLICT, "APPEAL_EXISTS", "이미 이의 신청했어요. 결과를 알림으로 알려 드릴게요.");
        boolean toHost = host != null && host != userId;
        jdbc.update("""
                INSERT INTO appeals(kind, record_id, participation_id, sanction_id, user_id, reason_code, reason, status, submitted_at, deadline_at, host_id, host_due_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", kind, record, participation, sanction, userId, code, text, toHost ? "SUBMITTED" : "ESCALATED",
                now, from.plus(WINDOW).isBefore(now) ? now : from.plus(WINDOW), toHost ? host : null, toHost ? now.plus(HOST_TIME) : null);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        if (record != null) jdbc.update("UPDATE activity_records SET status = 'HELD' WHERE id = ?", record);
        if (toHost) notifications.send(host, "APPEAL", "이의 신청이 들어왔어요", REASONS.get(code) + " · 3일 안에 답해 주세요", "#/manage/" + activity + "?tab=attendance", activity, "APPEAL_HOST:" + id);
        return Map.of("id", id, "status", toHost ? "SUBMITTED" : "ESCALATED");
    }

    /** The organizer's list on 모집 관리 › 출석 (open ones first). */
    public List<Map<String, Object>> forActivity(long organizerId, long activityId) {
        Integer own = jdbc.queryForObject("SELECT COUNT(*) FROM activities WHERE id = ? AND organizer_id = ?", Integer.class, activityId, organizerId);
        if (own == 0) throw notFound();
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT ap.id, ap.kind, ap.reason_code AS reasonCode, ap.reason, ap.status, ap.host_note AS hostNote, ap.participation_id AS participationId,
                       DATE_FORMAT(ap.host_due_at, '%Y-%m-%dT%H:%i') AS hostDueAt, u.display_name AS name
                FROM appeals ap JOIN users u ON u.id = ap.user_id
                LEFT JOIN participations p ON p.id = ap.participation_id LEFT JOIN activity_records r ON r.id = ap.record_id LEFT JOIN participations rp ON rp.id = r.participation_id
                WHERE COALESCE(p.activity_id, rp.activity_id) = ? ORDER BY ap.status = 'SUBMITTED' DESC, ap.id DESC""", activityId);
        rows.forEach(row -> { row.put("name", mask((String) row.remove("name"))); row.put("reasonLabel", REASONS.get(row.get("reasonCode"))); });
        return rows;
    }

    public record HostAnswer(String decision, String note) {}

    /** 출석으로 바꾸기 (ACCEPT) ends it; 그대로 두기 (KEEP, reason required) sends it to an admin. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> hostAnswer(long organizerId, long appealId, HostAnswer answer) {
        Map<String, Object> ap = row("SELECT * FROM appeals WHERE id = ? FOR UPDATE", appealId);
        if (ap == null || ap.get("host_id") == null || ((Number) ap.get("host_id")).longValue() != organizerId) throw notFound();
        if (!"SUBMITTED".equals(ap.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_ANSWERED", "이미 답한 이의 신청이에요.");
        String decision = answer == null || answer.decision() == null ? "" : answer.decision();
        String note = answer == null || answer.note() == null ? "" : answer.note().trim();
        if (!List.of("ACCEPT", "KEEP").contains(decision)) throw ApiException.validation(Map.of("decision", "답을 골라 주세요."));
        if ("KEEP".equals(decision) && (note.length() < 2 || note.length() > 500)) throw ApiException.validation(Map.of("note", "그대로 두는 이유를 적어 주세요."));
        LocalDateTime now = LocalDateTime.now(clock);
        jdbc.update("UPDATE appeals SET host_note = ?, host_at = ? WHERE id = ?", note.isEmpty() ? "출석으로 바꿨어요" : note, now, appealId);
        if ("ACCEPT".equals(decision)) return resolve(ap, true, organizerId, note.isEmpty() ? "모집자가 출석으로 바꿨어요" : note);
        jdbc.update("UPDATE appeals SET status = 'ESCALATED' WHERE id = ?", appealId);
        notifications.send(((Number) ap.get("user_id")).longValue(), "APPEAL", "이의 신청을 관리자가 확인해요", "모집자 답: " + note, "#/my?view=status", null, "APPEAL_ESC:" + appealId);
        return Map.of("status", "ESCALATED");
    }

    /** Scheduler: organizer did not answer in 3 days → an admin. */
    @Transactional
    public int escalateDue() {
        List<Map<String, Object>> due = jdbc.queryForList("SELECT id, user_id FROM appeals WHERE status = 'SUBMITTED' AND host_due_at <= ?", LocalDateTime.now(clock));
        for (Map<String, Object> ap : due) {
            jdbc.update("UPDATE appeals SET status = 'ESCALATED' WHERE id = ? AND status = 'SUBMITTED'", ap.get("id"));
            notifications.send(((Number) ap.get("user_id")).longValue(), "APPEAL", "이의 신청을 관리자가 확인해요", "모집자가 3일 안에 답하지 않아 관리자가 확인해요", "#/my?view=status", null, "APPEAL_ESC:" + ap.get("id"));
        }
        return due.size();
    }

    // ---- admin ----

    public List<Map<String, Object>> queue(String status) {
        String filter = "DONE".equals(status) ? "ap.status IN ('ACCEPTED', 'REJECTED')" : "ap.status IN ('ESCALATED', 'SUBMITTED')";
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT ap.id, ap.kind, ap.reason_code AS reasonCode, ap.reason, ap.status, ap.host_note AS hostNote, ap.result_note AS resultNote,
                       DATE_FORMAT(ap.submitted_at, '%Y-%m-%d %H:%i') AS submittedAt, u.display_name AS name,
                       COALESCE(a1.title, a2.title, s.reason) AS subject, c.method AS checkInMethod, s.type AS sanctionType
                FROM appeals ap JOIN users u ON u.id = ap.user_id
                LEFT JOIN participations p ON p.id = ap.participation_id LEFT JOIN activities a1 ON a1.id = p.activity_id
                LEFT JOIN activity_records r ON r.id = ap.record_id LEFT JOIN participations rp ON rp.id = r.participation_id LEFT JOIN activities a2 ON a2.id = rp.activity_id
                LEFT JOIN check_ins c ON c.participation_id = COALESCE(ap.participation_id, rp.id)
                LEFT JOIN sanctions s ON s.id = ap.sanction_id
                WHERE\s""" + filter + " ORDER BY ap.status = 'ESCALATED' DESC, ap.id DESC LIMIT 100");
        rows.forEach(row -> { row.put("name", mask((String) row.remove("name"))); row.put("reasonLabel", REASONS.get(row.get("reasonCode"))); });
        return rows;
    }

    public record Decision(String decision, String reason) {}

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> decide(long adminId, long appealId, Decision request) {
        Map<String, Object> ap = row("SELECT * FROM appeals WHERE id = ? FOR UPDATE", appealId);
        if (ap == null) throw notFound();
        if (!List.of("SUBMITTED", "ESCALATED").contains(ap.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_HANDLED", "이미 처리한 이의 신청이에요.");
        String decision = request == null || request.decision() == null ? "" : request.decision();
        String why = request == null || request.reason() == null ? "" : request.reason().trim();
        if (!List.of("ACCEPT", "REJECT").contains(decision)) throw ApiException.validation(Map.of("decision", "인정 또는 기각을 골라 주세요."));
        if (why.isEmpty() || why.length() > 500) throw ApiException.validation(Map.of("reason", "처리 사유를 적어 주세요."));
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, 'APPEAL', ?, ?, ?, ?, ?)",
                adminId, appealId, "APPEAL_" + decision, ap.get("status"), "ACCEPT".equals(decision) ? "ACCEPTED" : "REJECTED", why);
        return resolve(ap, "ACCEPT".equals(decision), adminId, why);
    }

    private Map<String, Object> resolve(Map<String, Object> ap, boolean accepted, long by, String why) {
        long id = ((Number) ap.get("id")).longValue(), user = ((Number) ap.get("user_id")).longValue();
        LocalDateTime now = LocalDateTime.now(clock);
        jdbc.update("UPDATE appeals SET status = ?, handled_by = ?, handled_at = ?, result_note = ? WHERE id = ?", accepted ? "ACCEPTED" : "REJECTED", by, now, why, id);
        String kind = (String) ap.get("kind");
        if ("NO_SHOW".equals(kind) && accepted) {
            long p = ((Number) ap.get("participation_id")).longValue();
            jdbc.update("UPDATE participations SET noshow_cleared = TRUE WHERE id = ?", p);
            // 실제로 참여했어요: the attendance it should have had — a manual check-in and its record.
            if ("ATTENDED".equals(ap.get("reason_code")) && jdbc.queryForObject("SELECT COUNT(*) FROM check_ins WHERE participation_id = ?", Integer.class, p) == 0) {
                jdbc.update("INSERT INTO check_ins(participation_id, method, within_radius, reason, checked_by, checked_at) VALUES (?, 'MANUAL', NULL, ?, ?, ?)", p, "이의 인정 · " + why, by, now);
                long check = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
                jdbc.update("INSERT INTO activity_records(participation_id, check_in_id, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?)", p, check, by, now);
                jdbc.update("UPDATE participations SET status = 'COMPLETED', updated_at = ? WHERE id = ?", now, p);
            }
        }
        if ("RECORD".equals(kind)) jdbc.update("UPDATE activity_records SET status = 'VALID' WHERE id = ?", ap.get("record_id"));
        if ("SANCTION".equals(kind) && accepted) jdbc.update("UPDATE sanctions SET revoked_at = ? WHERE id = ?", now, ap.get("sanction_id"));
        notifications.send(user, "APPEAL", accepted ? "이의 신청이 받아들여졌어요" : "이의 신청이 기각됐어요",
                accepted ? ("NO_SHOW".equals(kind) ? "불참 기록이 바뀌었고 불참 횟수에서 빠졌어요" : "SANCTION".equals(kind) ? "제한이 풀렸어요" : "기록을 다시 확인했어요") + " · " + why
                        : "기록이 그대로 유지돼요 · 사유: " + why, "#/my?view=status", null, "APPEAL_DONE:" + id);
        return Map.of("status", accepted ? "ACCEPTED" : "REJECTED");
    }

    private Map<String, Object> row(String sql, Object id) {
        return id == null ? null : jdbc.queryForList(sql, id).stream().findFirst().orElse(null);
    }

    static String mask(String name) {
        if (name == null || name.isEmpty()) return "회원";
        return name.length() <= 2 ? name.charAt(0) + "*" : name.charAt(0) + "*".repeat(name.length() - 2) + name.charAt(name.length() - 1);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "이의 신청할 기록을 찾을 수 없어요.");
    }
}
