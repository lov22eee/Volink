package com.volink.admin;

import com.volink.activity.ActivityService;
import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.volink.notification.NotificationService;
import com.volink.organization.OrganizationDocumentService;
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
    private final NotificationService notifications;
    private final OrganizationDocumentService documents;

    public AdminService(JdbcTemplate jdbc, ActivityService activities, Clock clock, NotificationService notifications, OrganizationDocumentService documents) {
        this.jdbc = jdbc;
        this.documents = documents;
        this.activities = activities;
        this.clock = clock;
        this.notifications = notifications;
    }

    public List<Map<String, Object>> organizations(String status) {
        List<Map<String, Object>> rows = jdbc.queryForList(Sql.kst("""
                SELECT o.id, o.name, o.org_type AS orgType, o.contact, o.address, o.vms_registered AS vmsRegistered, o.vms_code AS vmsCode,
                       o.status, o.reject_reason AS rejectReason,
                       u.display_name AS managerName, u.email AS managerEmail, DATE_FORMAT(KST(o.created_at), '%Y-%m-%d %H:%i') AS requestedAt
                FROM organizations o JOIN users u ON u.id = o.manager_user_id
                WHERE o.status = ? ORDER BY o.created_at, o.id
                """), status);
        // 기관 확인 서류 (V40, optional): the admin opens each with /api/org-documents/{id}.
        rows.forEach(row -> row.put("documents", documents.list(((Number) row.get("id")).longValue())));
        return rows;
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
        // The manager hears the result in the app (and as a phone push when they allowed it; sent after commit).
        long manager = jdbc.queryForObject("SELECT manager_user_id FROM organizations WHERE id = ?", Long.class, id);
        if (approve) notifications.send(manager, "ORGANIZATION_REVIEW", "기관 확인이 끝났어요", "이제 기관 주관 활동을 열 수 있어요.", "#/home");
        else notifications.send(manager, "ORGANIZATION_REVIEW", "기관 확인이 반려됐어요", "반려 사유: " + reason, "#/home");
    }

    public List<Map<String, Object>> reviewActivities() {
        return activities.reviewQueue();
    }

    @Transactional
    public void reviewActivity(long adminId, long id, boolean approve, String rawReason) {
        String reason = clean(rawReason, approve ? "관리자 검토 후 공개" : null);
        Map<String, Object> row = jdbc.queryForList("SELECT status, risk_level, organizer_id, title FROM activities WHERE id = ? FOR UPDATE", id)
                .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "활동을 찾을 수 없습니다."));
        if (!"DRAFT".equals(row.get("status")) || !"REVIEW".equals(row.get("risk_level")))
            throw invalidState("검토 대기 중인 활동만 처리할 수 있습니다.");
        String to = approve ? "RECRUITING" : "CANCELLED";
        jdbc.update("UPDATE activities SET status = ?, review_note = ? WHERE id = ?", to, reason, id);
        activities.log(id, adminId, "DRAFT", to, reason);
        record(adminId, "ACTIVITY", id, approve ? "APPROVE" : "REJECT", "DRAFT", to, reason);
        // 2026-11-08: the organizer hears the result (phone push too) instead of finding it in 내 모집.
        long organizer = ((Number) row.get("organizer_id")).longValue();
        String title = (String) row.get("title");
        if (approve) notifications.send(organizer, "ACTIVITY_REVIEW", "모집글이 승인됐어요", title + " · 관리자 검토를 마쳐 이제 신청을 받을 수 있어요.", "#/manage/" + id, id, "ACTIVITY_REVIEW:" + id);
        else notifications.send(organizer, "ACTIVITY_REVIEW", "모집글이 반려됐어요", title + " · 반려 사유: " + reason, "#/activity/" + id, id, "ACTIVITY_REVIEW:" + id);
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

    /**
     * Dashboard: applications per Korean calendar day for the last {@code days} days (today included, missing days as 0)
     * and how many applications are in each status now. Rows are counted by their first application time; applying
     * again after a cancel reuses the same row, so it is not counted twice. Read only.
     */
    public Map<String, Object> applicationStats(int days) {
        int span = Math.max(7, Math.min(60, days));
        LocalDate today = LocalDate.now(clock), from = today.minusDays(span - 1L);
        Map<String, Long> perDay = new LinkedHashMap<>();
        for (int i = 0; i < span; i++) perDay.put(from.plusDays(i).toString(), 0L);
        jdbc.queryForList(Sql.kst("""
                SELECT DATE_FORMAT(KST(created_at), '%Y-%m-%d') AS day, COUNT(*) AS n FROM participations
                WHERE KST(created_at) >= ? GROUP BY day
                """), from.toString())
                .forEach(row -> perDay.computeIfPresent((String) row.get("day"), (day, zero) -> ((Number) row.get("n")).longValue()));
        Map<String, Long> statuses = new LinkedHashMap<>();
        jdbc.queryForList("SELECT status, COUNT(*) AS n FROM participations GROUP BY status ORDER BY status")
                .forEach(row -> statuses.put((String) row.get("status"), ((Number) row.get("n")).longValue()));
        return Map.of("days", perDay.entrySet().stream().map(e -> Map.of("date", e.getKey(), "applications", e.getValue())).toList(), "statuses", statuses);
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    private static ApiException invalidState(String message) {
        return new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", message);
    }
}
