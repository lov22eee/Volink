package com.volink.admin;

import com.volink.activity.ActivityService;
import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Every admin decision needs a reason and is written to admin_actions (and activity_logs for activities). */
@Service
public class AdminService {
    private final JdbcTemplate jdbc;
    private final ActivityService activities;
    private final Clock clock;

    public AdminService(JdbcTemplate jdbc, ActivityService activities, Clock clock) {
        this.jdbc = jdbc;
        this.activities = activities;
        this.clock = clock;
    }

    public List<Map<String, Object>> organizations(String status) {
        return jdbc.queryForList(Sql.kst("""
                SELECT o.id, o.name, o.contact, o.status, o.reject_reason AS rejectReason,
                       u.display_name AS managerName, u.email AS managerEmail, DATE_FORMAT(KST(o.created_at), '%Y-%m-%d %H:%i') AS requestedAt
                FROM organizations o JOIN users u ON u.id = o.manager_user_id
                WHERE o.status = ? ORDER BY o.created_at, o.id
                """), status);
    }

    @Transactional
    public void reviewOrganization(long adminId, long id, boolean approve, String rawReason) {
        String reason = clean(rawReason, approve ? "기관 정보 확인 완료" : null);
        String from = jdbc.queryForList("SELECT status FROM organizations WHERE id = ? FOR UPDATE", String.class, id)
                .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "기관을 찾을 수 없습니다."));
        if (!"PENDING".equals(from)) throw invalidState("확인 대기 중인 기관만 처리할 수 있습니다.");
        String to = approve ? "APPROVED" : "REJECTED";
        jdbc.update("UPDATE organizations SET status = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ? WHERE id = ?",
                to, adminId, now(), approve ? null : reason, id);
        record(adminId, "ORGANIZATION", id, approve ? "APPROVE" : "REJECT", from, to, reason);
    }

    public List<Map<String, Object>> reviewActivities() {
        return activities.reviewQueue();
    }

    @Transactional
    public void reviewActivity(long adminId, long id, boolean approve, String rawReason) {
        String reason = clean(rawReason, approve ? "관리자 검토 후 공개" : null);
        Map<String, Object> row = jdbc.queryForList("SELECT status, risk_level FROM activities WHERE id = ? FOR UPDATE", id)
                .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "활동을 찾을 수 없습니다."));
        if (!"DRAFT".equals(row.get("status")) || !"REVIEW".equals(row.get("risk_level")))
            throw invalidState("검토 대기 중인 활동만 처리할 수 있습니다.");
        String to = approve ? "RECRUITING" : "CANCELLED";
        jdbc.update("UPDATE activities SET status = ?, review_note = ? WHERE id = ?", to, reason, id);
        activities.log(id, adminId, "DRAFT", to, reason);
        record(adminId, "ACTIVITY", id, approve ? "APPROVE" : "REJECT", "DRAFT", to, reason);
    }

    private void record(long adminId, String type, long id, String action, String from, String to, String reason) {
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
                adminId, type, id, action, from, to, reason);
    }

    /** Rejection always needs a written reason; approval gets a default note. */
    private static String clean(String reason, String fallback) {
        String value = reason == null ? "" : reason.trim();
        if (value.isEmpty() && fallback == null)
            throw ApiException.validation(Map.of("reason", "반려 사유를 입력해 주세요."));
        if (value.length() > 500) throw ApiException.validation(Map.of("reason", "사유는 500자 이내로 입력해 주세요."));
        return value.isEmpty() ? fallback : value;
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    private static ApiException invalidState(String message) {
        return new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", message);
    }
}
