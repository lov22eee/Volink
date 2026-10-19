package com.volink.safety;

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
 * Warnings, restrictions (no new applications or activities) and suspensions (no writes at all), always with a reason.
 * Three no-shows within 90 days restrict the account for 14 days automatically (created_by NULL = system).
 * Expired restrictions and suspensions are lifted by the minute scheduler.
 */
@Service
public class SanctionService {
    public static final int NO_SHOW_LIMIT = 3;
    public static final int NO_SHOW_WINDOW_DAYS = 90;
    public static final int AUTO_RESTRICTION_DAYS = 14;

    private final JdbcTemplate jdbc;
    private final NotificationService notifications;
    private final Clock clock;

    public SanctionService(JdbcTemplate jdbc, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.clock = clock;
    }

    public record SanctionRequest(String type, String reason, Integer days, Long reportId) {}

    @Transactional
    public Map<String, Object> sanction(long adminId, long userId, SanctionRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        String type = request.type() == null ? "" : request.type();
        if (!List.of("WARNING", "RESTRICTION", "SUSPENSION").contains(type)) errors.put("type", "제재 종류를 골라 주세요.");
        String reason = request.reason() == null ? "" : request.reason().trim();
        if (reason.isEmpty() || reason.length() > 500) errors.put("reason", "제재 사유를 500자 이내로 입력해 주세요.");
        boolean timed = !"WARNING".equals(type);
        if (timed && (request.days() == null || request.days() < 1 || request.days() > 365)) errors.put("days", "기간은 1~365일로 정해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        String role = jdbc.queryForList("SELECT role FROM users WHERE id = ? FOR UPDATE", String.class, userId).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "회원을 찾을 수 없습니다."));
        if ("ADMIN".equals(role)) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 계정은 제재할 수 없습니다.");
        LocalDateTime now = LocalDateTime.now(clock);
        LocalDateTime ends = timed ? now.plusDays(request.days()) : null;
        jdbc.update("INSERT INTO sanctions(user_id, type, reason, report_id, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
                userId, type, reason, request.reportId(), now, ends, adminId);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        String from = jdbc.queryForObject("SELECT status FROM users WHERE id = ?", String.class, userId);
        String to = refresh(userId);
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, 'USER', ?, ?, ?, ?, ?)",
                adminId, userId, type, from, to, reason);
        notifications.send(userId, "SANCTION", label(type) + " 안내", reason + (ends == null ? "" : " · " + ends.toLocalDate() + "까지"), "#/mine");
        return Map.of("id", id, "status", to);
    }

    /** Called when someone is marked NO_SHOW. */
    @Transactional
    public void afterNoShow(long userId) {
        LocalDateTime now = LocalDateTime.now(clock);
        int noShows = jdbc.queryForObject("""
                SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id
                WHERE p.user_id = ? AND p.status = 'NO_SHOW' AND a.ends_at >= ?""", Integer.class, userId, now.minusDays(NO_SHOW_WINDOW_DAYS));
        boolean active = jdbc.queryForObject("SELECT COUNT(*) FROM sanctions WHERE user_id = ? AND type IN ('RESTRICTION', 'SUSPENSION') AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?)",
                Integer.class, userId, now) > 0;
        if (noShows < NO_SHOW_LIMIT || active) return;
        String reason = "최근 " + NO_SHOW_WINDOW_DAYS + "일 불참(노쇼) " + noShows + "회로 " + AUTO_RESTRICTION_DAYS + "일간 신청이 자동 제한됩니다.";
        jdbc.update("INSERT INTO sanctions(user_id, type, reason, starts_at, ends_at, created_by) VALUES (?, 'RESTRICTION', ?, ?, ?, NULL)",
                userId, reason, now, now.plusDays(AUTO_RESTRICTION_DAYS));
        refresh(userId);
        notifications.send(userId, "SANCTION", "신청 제한 안내", reason, "#/mine");
    }

    /** Minute scheduler: lifts restrictions/suspensions whose time is over. */
    @Transactional
    public int liftExpired() {
        LocalDateTime now = LocalDateTime.now(clock);
        List<Long> users = jdbc.queryForList("SELECT DISTINCT user_id FROM sanctions WHERE lifted_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ?", Long.class, now);
        jdbc.update("UPDATE sanctions SET lifted_at = ? WHERE lifted_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ?", now, now);
        users.forEach(this::refresh);
        return users.size();
    }

    public List<Map<String, Object>> mine(long userId) {
        return jdbc.queryForList("""
                SELECT type, reason, DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i') AS startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i') AS endsAt,
                       lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?) AS active
                FROM sanctions WHERE user_id = ? ORDER BY id DESC""", LocalDateTime.now(clock), userId);
    }

    /** Admin lookup by e-mail (part of it). Contacts are not shown. */
    public List<Map<String, Object>> search(String email) {
        String query = email == null ? "" : email.trim();
        if (query.length() < 3) throw ApiException.validation(Map.of("email", "이메일을 3글자 이상 입력해 주세요."));
        LocalDateTime since = LocalDateTime.now(clock).minusDays(NO_SHOW_WINDOW_DAYS);
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT u.id, u.email, u.display_name AS name, u.role, u.status,
                       (SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id WHERE p.user_id = u.id AND p.status = 'NO_SHOW' AND a.ends_at >= ?) AS noShows
                FROM users u WHERE u.email LIKE ? ORDER BY u.id LIMIT 20""", since, "%" + query.replace("%", "").replace("_", "") + "%");
        rows.forEach(row -> row.put("sanctions", mine(((Number) row.get("id")).longValue())));
        return rows;
    }

    /** users.status follows the strongest sanction that is still running. */
    private String refresh(long userId) {
        LocalDateTime now = LocalDateTime.now(clock);
        List<String> running = jdbc.queryForList("SELECT type FROM sanctions WHERE user_id = ? AND lifted_at IS NULL AND (ends_at IS NULL OR ends_at > ?)", String.class, userId, now);
        String status = running.contains("SUSPENSION") ? "SUSPENDED" : running.contains("RESTRICTION") ? "RESTRICTED" : "ACTIVE";
        jdbc.update("UPDATE users SET status = ? WHERE id = ?", status, userId);
        return status;
    }

    private static String label(String type) {
        return switch (type) { case "WARNING" -> "경고"; case "RESTRICTION" -> "이용 제한"; default -> "이용 정지"; };
    }
}
