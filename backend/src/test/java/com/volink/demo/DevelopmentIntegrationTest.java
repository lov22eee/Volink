package com.volink.demo;

import java.util.Map;
import java.sql.SQLException;
import com.volink.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DevelopmentIntegrationTest extends IntegrationTestBase {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    void migrationsAndDemoDataAreAppliedOnce() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1", Integer.class)).isEqualTo(7);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM categories", Integer.class)).isEqualTo(3);
        // The test profile never creates demo login accounts (dev profile + DEMO_ACCOUNT_PASSWORD only).
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email LIKE '%@demo.volink.kr'", Integer.class)).isZero();
    }

    @Test
    void demoCatalogReadsTheActualDatabaseWithoutCredentials() throws Exception {
        mvc.perform(get("/api/demo/catalog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.demo").value(true))
                .andExpect(jsonPath("$.places.length()").value(3))
                .andExpect(jsonPath("$.personas.length()").value(11))
                .andExpect(jsonPath("$.activities.length()").value(3))
                .andExpect(jsonPath("$.places[0].coordinateStatus").value(org.hamcrest.Matchers.oneOf("UNVERIFIED", "ENTERED")))
                .andExpect(jsonPath("$.activities[0].activityType").value("GENERAL"))
                .andExpect(jsonPath("$.personas[0].password").doesNotExist());
        assertThat(jdbc.queryForList("SELECT persona_role, COUNT(*) AS n FROM demo_personas GROUP BY persona_role"))
                .extracting(row -> Map.entry(row.get("persona_role"), ((Number) row.get("n")).intValue()))
                .containsExactlyInAnyOrder(Map.entry("ORGANIZER", 2), Map.entry("PARTICIPANT", 6),
                        Map.entry("INSTITUTION", 2), Map.entry("ADMIN", 1));
    }

    @Test
    void readinessShowsTheCurrentWeek() throws Exception {
        mvc.perform(get("/api/project/status"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.database").value("UP"))
                .andExpect(jsonPath("$.week").value(6)).andExpect(jsonPath("$.authenticationImplemented").value(true));
        mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void protectedAndWriteEndpointsAreNotOpened() throws Exception {
        mvc.perform(get("/api/users")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/demo/catalog")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    @Transactional
    void capacityCannotBeOutsideTwoToTen() {
        long user = user();
        for (int capacity : new int[]{1, 11}) {
            assertCheckViolation(() -> insertActivity(user, capacity, "2026-10-10 10:00:00", "2026-10-10 11:00:00"));
        }
    }

    @Test
    @Transactional
    void durationMustBePositiveAndNoLongerThanThreeHours() {
        long user = user();
        assertCheckViolation(() -> insertActivity(user, 6, "2026-10-10 10:00:00", "2026-10-10 13:00:01"));
        assertCheckViolation(() -> insertActivity(user, 6, "2026-10-10 10:00:00", "2026-10-10 10:00:00"));
        insertActivity(user, 6, "2026-10-10 10:00:00", "2026-10-10 13:00:00");
    }

    @Test
    @Transactional
    void theSameUserCannotApplyToTheSameActivityTwice() {
        long user = user();
        insertActivity(user, 6, "2026-10-10 10:00:00", "2026-10-10 11:00:00");
        long activity = jdbc.queryForObject("SELECT MAX(id) FROM activities", Long.class);
        jdbc.update("INSERT INTO participations(activity_id, user_id) VALUES (?, ?)", activity, user);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO participations(activity_id, user_id) VALUES (?, ?)", activity, user))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @Transactional
    void manualCheckInRequiresANonBlankReason() {
        long user = user();
        insertActivity(user, 6, "2026-10-10 10:00:00", "2026-10-10 11:00:00");
        long activity = jdbc.queryForObject("SELECT MAX(id) FROM activities", Long.class);
        jdbc.update("INSERT INTO participations(activity_id, user_id) VALUES (?, ?)", activity, user);
        long participation = jdbc.queryForObject("SELECT MAX(id) FROM participations", Long.class);
        assertCheckViolation(() -> jdbc.update("INSERT INTO check_ins(participation_id, method, reason, checked_by, checked_at) VALUES (?, 'MANUAL', '   ', ?, NOW())", participation, user));
        jdbc.update("INSERT INTO check_ins(participation_id, method, reason, checked_by, checked_at) VALUES (?, 'MANUAL', '위치 권한 거부 후 현장 확인', ?, NOW())", participation, user);
    }

    @Test
    void schemaMatchesTheDocumentedErd() {
        assertThat(jdbc.queryForList("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = DATABASE() AND table_name <> 'flyway_schema_history'
                """, String.class)).containsExactlyInAnyOrder(
                "users", "categories", "activities", "activity_locations", "participations", "check_ins", "activity_records",
                "activity_logs", "organizations", "user_interests", "admin_actions", "notifications", "reports",
                "report_evidences", "appeals", "sanctions", "risk_keywords", "refresh_tokens",
                "demo_places", "demo_personas", "demo_activity_templates");
        assertThat(jdbc.queryForList("SELECT risk_level, COUNT(*) AS n FROM risk_keywords GROUP BY risk_level"))
                .extracting(row -> Map.entry(row.get("risk_level"), ((Number) row.get("n")).intValue()))
                .containsExactlyInAnyOrder(Map.entry("BLOCKED", 15), Map.entry("REVIEW", 17));
        assertThat(jdbc.queryForObject("SELECT base_risk FROM categories WHERE name = '지역 돌봄'", String.class)).isEqualTo("REVIEW");
    }

    @Test
    @Transactional
    void membersNeedABirthDateAndAdminsCannotBeInstitutions() {
        assertCheckViolation(() -> jdbc.update("INSERT INTO users(email, display_name, password_hash) VALUES ('no-birth@example.invalid', '테스트', 'x')"));
        assertCheckViolation(() -> jdbc.update("INSERT INTO users(email, display_name, password_hash, role, member_type) VALUES ('admin@example.invalid', '관리', 'x', 'ADMIN', 'INSTITUTION')"));
        assertCheckViolation(() -> jdbc.update("INSERT INTO users(email, display_name, password_hash, member_type, birth_date) VALUES ('type@example.invalid', '테스트', 'x', 'COMPANY', '2000-01-01')"));
        jdbc.update("INSERT INTO users(email, display_name, password_hash, role) VALUES ('admin@example.invalid', '관리', 'x', 'ADMIN')");
    }

    @Test
    @Transactional
    void institutionReviewNeedsAReviewerAndRejectionReason() {
        long manager = user();
        long admin = admin();
        assertCheckViolation(() -> jdbc.update("INSERT INTO organizations(manager_user_id, name, contact, status) VALUES (?, '예시 기관', '000-0000', 'APPROVED')", manager));
        assertCheckViolation(() -> jdbc.update("INSERT INTO organizations(manager_user_id, name, contact, status, reviewed_by, reviewed_at, reject_reason) VALUES (?, '예시 기관', '000-0000', 'REJECTED', ?, NOW(), '  ')", manager, admin));
        jdbc.update("INSERT INTO organizations(manager_user_id, name, contact) VALUES (?, '예시 기관', '000-0000')", manager);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO organizations(manager_user_id, name, contact) VALUES (?, '두 번째 기관', '000-0000')", manager))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @Transactional
    void institutionActivitiesRequireAnOrganizationAndGeneralOnesMustNotHaveOne() {
        long user = user();
        jdbc.update("INSERT INTO organizations(manager_user_id, name, contact) VALUES (?, '예시 기관', '000-0000')", user);
        long organization = jdbc.queryForObject("SELECT id FROM organizations WHERE manager_user_id = ?", Long.class, user);
        String sql = "INSERT INTO activities(organizer_id, category_id, activity_type, organization_id, title, description, starts_at, ends_at, capacity) VALUES (?, 1, ?, ?, '테스트', '검증용', '2026-10-20 10:00:00', '2026-10-20 11:00:00', 6)";
        assertCheckViolation(() -> jdbc.update(sql, user, "INSTITUTION", null));
        assertCheckViolation(() -> jdbc.update(sql, user, "GENERAL", organization));
        jdbc.update(sql, user, "INSTITUTION", organization);
        jdbc.update(sql, user, "GENERAL", null);
    }

    @Test
    @Transactional
    void participationAcceptsRejectedButNotUnknownStatuses() {
        long user = user();
        insertActivity(user, 6, "2026-10-10 10:00:00", "2026-10-10 11:00:00");
        long activity = jdbc.queryForObject("SELECT MAX(id) FROM activities", Long.class);
        assertCheckViolation(() -> jdbc.update("INSERT INTO participations(activity_id, user_id, status) VALUES (?, ?, 'DELETED')", activity, user));
        assertCheckViolation(() -> jdbc.update("INSERT INTO participations(activity_id, user_id, status, wait_order) VALUES (?, ?, 'WAITLISTED', 0)", activity, user));
        jdbc.update("INSERT INTO participations(activity_id, user_id, status) VALUES (?, ?, 'REJECTED')", activity, user);
    }

    @Test
    @Transactional
    void reportEvidenceAppealAndSanctionRulesAreEnforced() {
        long user = user();
        long admin = admin();
        insertActivity(user, 6, "2026-10-10 10:00:00", "2026-10-10 11:00:00");
        long activity = jdbc.queryForObject("SELECT MAX(id) FROM activities", Long.class);
        assertCheckViolation(() -> jdbc.update("INSERT INTO reports(reporter_id, activity_id, reason_type, description) VALUES (?, ?, 'SAFETY', '짧음')", user, activity));
        assertCheckViolation(() -> jdbc.update("INSERT INTO reports(reporter_id, activity_id, reason_type, description, status) VALUES (?, ?, 'SAFETY', '현장에서 위험한 도구를 사용했습니다.', 'DISMISSED')", user, activity));
        jdbc.update("INSERT INTO reports(reporter_id, activity_id, reason_type, description) VALUES (?, ?, 'SAFETY', '현장에서 위험한 도구를 사용했습니다.')", user, activity);
        long report = jdbc.queryForObject("SELECT MAX(id) FROM reports", Long.class);
        String evidence = "INSERT INTO report_evidences(report_id, storage_key, content_type, size_bytes) VALUES (?, ?, ?, ?)";
        assertCheckViolation(() -> jdbc.update(evidence, report, "reports/1/a.exe", "application/x-msdownload", 100));
        assertCheckViolation(() -> jdbc.update(evidence, report, "reports/1/b.png", "image/png", 10485761));
        jdbc.update(evidence, report, "reports/1/c.png", "image/png", 10485760);

        jdbc.update("INSERT INTO participations(activity_id, user_id, status) VALUES (?, ?, 'CHECKED_IN')", activity, user);
        long participation = jdbc.queryForObject("SELECT MAX(id) FROM participations", Long.class);
        jdbc.update("INSERT INTO check_ins(participation_id, method, checked_by, checked_at) VALUES (?, 'QR', ?, '2026-10-10 10:01:00')", participation, user);
        long checkIn = jdbc.queryForObject("SELECT MAX(id) FROM check_ins", Long.class);
        jdbc.update("INSERT INTO activity_records(participation_id, check_in_id, confirmed_by, confirmed_at) VALUES (?, ?, ?, '2026-10-10 11:05:00')", participation, checkIn, user);
        long record = jdbc.queryForObject("SELECT MAX(id) FROM activity_records", Long.class);
        String appeal = "INSERT INTO appeals(record_id, user_id, reason, submitted_at, deadline_at) VALUES (?, ?, '출석이 누락되어 확인을 요청합니다.', ?, '2026-10-17 11:05:00')";
        assertCheckViolation(() -> jdbc.update(appeal, record, user, "2026-10-17 11:05:01"));
        jdbc.update(appeal, record, user, "2026-10-17 11:05:00");

        String sanction = "INSERT INTO sanctions(user_id, type, reason, report_id, starts_at, ends_at, created_by) VALUES (?, 'RESTRICTION', ?, ?, '2026-10-20 00:00:00', ?, ?)";
        assertCheckViolation(() -> jdbc.update(sanction, user, " ", report, null, admin));
        assertCheckViolation(() -> jdbc.update(sanction, user, "반복 노쇼", report, "2026-10-19 00:00:00", admin));
        jdbc.update(sanction, user, "반복 노쇼", report, "2026-10-27 00:00:00", admin);
        assertCheckViolation(() -> jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, reason) VALUES (?, 'REPORT', ?, 'DISMISS', '')", admin, report));
    }

    private long user() {
        jdbc.update("INSERT INTO users(email, display_name, password_hash, birth_date) VALUES ('integration@example.invalid', '테스트', 'not-a-login-credential', '2000-01-01')");
        return jdbc.queryForObject("SELECT id FROM users WHERE email = 'integration@example.invalid'", Long.class);
    }

    private long admin() {
        jdbc.update("INSERT INTO users(email, display_name, password_hash, role) VALUES ('integration-admin@example.invalid', '관리', 'not-a-login-credential', 'ADMIN')");
        return jdbc.queryForObject("SELECT id FROM users WHERE email = 'integration-admin@example.invalid'", Long.class);
    }

    private void assertCheckViolation(Runnable action) {
        // MySQL reports CHECK violations as HY000 / 3819; verify the DB error rather than an assumed Spring subtype.
        assertThatThrownBy(action::run).isInstanceOf(DataAccessException.class)
                .hasRootCauseInstanceOf(SQLException.class).satisfies(error -> {
                    Throwable root = error;
                    while (root.getCause() != null) root = root.getCause();
                    assertThat(((SQLException) root).getErrorCode()).isEqualTo(3819);
                });
    }

    private void insertActivity(long user, int capacity, String start, String end) {
        jdbc.update("INSERT INTO activities(organizer_id, category_id, title, description, starts_at, ends_at, capacity) VALUES (?, 1, '테스트 활동', '검증용', ?, ?, ?)", user, start, end, capacity);
    }
}
