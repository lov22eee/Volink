package com.volink.demo;

import java.util.Map;
import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Testcontainers
class DevelopmentIntegrationTest {
    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>(DockerImageName
            .parse("mysql@sha256:6ea90827b1100f8f2ae306a539f86d2c264a26ed435a2a9f75551dd5c3aeb242")
            .asCompatibleSubstituteFor("mysql"));

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    void migrationsAndDemoDataAreAppliedOnce() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1", Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM categories", Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users", Integer.class)).isZero();
    }

    @Test
    void demoCatalogReadsTheActualDatabaseWithoutCredentials() throws Exception {
        mvc.perform(get("/api/demo/catalog"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.demo").value(true))
                .andExpect(jsonPath("$.places.length()").value(3))
                .andExpect(jsonPath("$.personas.length()").value(9))
                .andExpect(jsonPath("$.activities.length()").value(3))
                .andExpect(jsonPath("$.places[0].coordinateStatus").value("UNVERIFIED"))
                .andExpect(jsonPath("$.personas[0].password").doesNotExist());
        assertThat(jdbc.queryForList("SELECT persona_role, COUNT(*) AS n FROM demo_personas GROUP BY persona_role"))
                .extracting(row -> Map.entry(row.get("persona_role"), ((Number) row.get("n")).intValue()))
                .containsExactlyInAnyOrder(Map.entry("ORGANIZER", 2), Map.entry("PARTICIPANT", 6), Map.entry("ADMIN", 1));
    }

    @Test
    void readinessShowsWeekOneAndDoesNotClaimAuthentication() throws Exception {
        mvc.perform(get("/api/project/status"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.database").value("UP"))
                .andExpect(jsonPath("$.week").value(1)).andExpect(jsonPath("$.authenticationImplemented").value(false));
        mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void protectedAndWriteEndpointsAreNotOpened() throws Exception {
        mvc.perform(get("/api/users")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/demo/catalog")).andExpect(status().isForbidden());
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

    private long user() {
        jdbc.update("INSERT INTO users(email, display_name, password_hash) VALUES ('integration@example.invalid', '테스트', 'not-a-login-credential')");
        return jdbc.queryForObject("SELECT id FROM users WHERE email = 'integration@example.invalid'", Long.class);
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
