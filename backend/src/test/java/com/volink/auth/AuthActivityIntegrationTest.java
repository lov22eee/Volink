package com.volink.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.volink.IntegrationTestBase;
import jakarta.servlet.http.Cookie;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Week 3 rules through the real HTTP API and a real MySQL (docs/test-cases.md A-01..A-05, R-01..R-03). */
class AuthActivityIntegrationTest extends IntegrationTestBase {
    static final String PASSWORD = "testPass123";
    static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Seoul"));

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired PasswordEncoder passwords;

    @Test
    void signupStoresAGeneralMemberWithInterestsAndIgnoresARequestedAdminRole() throws Exception {
        String email = email();
        Map<String, Object> body = signupBody(email, "GENERAL", TODAY.minusYears(20));
        body.put("role", "ADMIN");
        body.put("interests", List.of("환경 정화", "지역 돌봄"));
        perform(post("/api/auth/signup"), body, null).andExpect(status().isCreated())
                .andExpect(jsonPath("$.role").value("USER")).andExpect(jsonPath("$.memberType").value("GENERAL"))
                .andExpect(jsonPath("$.interests.length()").value(2)).andExpect(jsonPath("$.password_hash").doesNotExist());
        Map<String, Object> row = jdbc.queryForMap("SELECT role, password_hash FROM users WHERE email = ?", email);
        assertThat(row.get("role")).isEqualTo("USER");
        assertThat((String) row.get("password_hash")).startsWith("$2").doesNotContain(PASSWORD);
    }

    @Test
    void underFourteenIsRefusedOnTheServerAndExactlyFourteenIsAccepted() throws Exception {
        String young = email();
        perform(post("/api/auth/signup"), signupBody(young, "GENERAL", TODAY.minusYears(14).plusDays(1)), null)
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("UNDER_AGE"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, young)).isZero();
        perform(post("/api/auth/signup"), signupBody(email(), "GENERAL", TODAY.minusYears(14)), null).andExpect(status().isCreated());
    }

    @Test
    void invalidSignupReturnsFieldErrorsAndDuplicateEmailIsAConflict() throws Exception {
        perform(post("/api/auth/signup"), Map.of(), null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors[*].field").value(org.hamcrest.Matchers.hasItems(
                        "memberType", "name", "birthDate", "interests", "email", "password", "notice")));
        Map<String, Object> weak = signupBody(email(), "GENERAL", TODAY.minusYears(20));
        weak.put("password", "onlyletters");
        perform(post("/api/auth/signup"), weak, null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("password"));
        String email = email();
        perform(post("/api/auth/signup"), signupBody(email, "GENERAL", TODAY.minusYears(20)), null).andExpect(status().isCreated());
        perform(post("/api/auth/signup"), signupBody(email.toUpperCase(), "GENERAL", TODAY.minusYears(20)), null)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }

    @Test
    void loginRefreshRotationAndLogoutWorkWithAnHttpOnlyCookie() throws Exception {
        String email = member("GENERAL");
        perform(post("/api/auth/login"), Map.of("email", email, "password", "wrongPass1"), null)
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
        MvcResult login = perform(post("/api/auth/login"), Map.of("email", email, "password", PASSWORD), null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.email").value(email)).andReturn();
        String setCookie = login.getResponse().getHeader("Set-Cookie");
        assertThat(setCookie).contains("HttpOnly").contains("SameSite=Strict").contains("Path=/api/auth");
        String access = json.readTree(login.getResponse().getContentAsString()).get("accessToken").asText();
        mvc.perform(get("/api/me").header("Authorization", "Bearer " + access)).andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email));

        Cookie first = cookie(login);
        MvcResult refreshed = mvc.perform(post("/api/auth/refresh").cookie(first)).andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty()).andReturn();
        mvc.perform(post("/api/auth/refresh").cookie(first)).andExpect(status().isUnauthorized());
        Cookie second = cookie(refreshed);
        mvc.perform(post("/api/auth/logout").cookie(second)).andExpect(status().isNoContent());
        mvc.perform(post("/api/auth/refresh").cookie(second)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").header("Authorization", "Bearer not-a-token")).andExpect(status().isUnauthorized());
    }

    @Test
    void repeatedWrongPasswordsAreRateLimited() throws Exception {
        String email = member("GENERAL");
        for (int i = 0; i < 5; i++)
            perform(post("/api/auth/login"), Map.of("email", email, "password", "wrongPass1"), null).andExpect(status().isUnauthorized());
        perform(post("/api/auth/login"), Map.of("email", email, "password", PASSWORD), null)
                .andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code").value("TOO_MANY_REQUESTS"));
    }

    @Test
    void activityCreationNeedsLoginAndReChecksEveryInputRuleOnTheServer() throws Exception {
        perform(post("/api/activities"), activity("공원 쓰레기 줍기 모임", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), null)
                .andExpect(status().isUnauthorized());
        String token = token(member("GENERAL"));
        Map<String, Object> bad = activity("짧음", "짧은 소개");
        bad.put("capacity", 11);
        bad.put("durationMinutes", 20);
        bad.put("date", TODAY.toString());
        bad.put("time", "05:30");
        bad.put("safetyConfirmed", false);
        perform(post("/api/activities"), bad, token).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[*].field").value(org.hamcrest.Matchers.containsInAnyOrder(
                        "title", "date", "time", "capacity", "duration", "description", "safety")));
        Map<String, Object> late = activity("저녁 공원 정리 모임", "공원 산책로 주변의 가벼운 쓰레기를 함께 정리합니다.");
        late.put("time", "21:00");
        late.put("durationMinutes", 90);
        perform(post("/api/activities"), late, token).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].message").value("활동은 22:00 전에 끝나야 합니다."));
    }

    @Test
    void lowRiskActivityIsPublishedAndBlockedActivityIsNeverSaved() throws Exception {
        String token = token(member("GENERAL"));
        String title = "공원 쓰레기 줍기 " + UUID.randomUUID().toString().substring(0, 6);
        long id = json.readTree(perform(post("/api/activities"), activity(title, "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), token)
                .andExpect(status().isCreated()).andExpect(jsonPath("$.riskLevel").value("LOW"))
                .andExpect(jsonPath("$.status").value("RECRUITING")).andReturn().getResponse().getContentAsString()).get("id").asLong();
        mvc.perform(get("/api/activities")).andExpect(jsonPath("$[?(@.id == " + id + ")].title").value(title));
        // The saved time must be exactly what the organizer typed (Korean local time), whatever the server's time zone is.
        mvc.perform(get("/api/activities/" + id)).andExpect(status().isOk()).andExpect(jsonPath("$.placeName").value("옥정중앙공원"))
                .andExpect(jsonPath("$.date").value(TODAY.plusDays(7).toString())).andExpect(jsonPath("$.startTime").value("10:00"))
                .andExpect(jsonPath("$.durationMinutes").value(90));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_logs WHERE activity_id = ? AND to_status = 'RECRUITING'", Integer.class, id)).isEqualTo(1);

        String blocked = "사다리 청소 " + UUID.randomUUID().toString().substring(0, 6);
        perform(post("/api/activities"), activity(blocked, "건물 외벽 창문을 사다리에 올라가서 함께 닦는 활동입니다."), token)
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("ACTIVITY_BLOCKED"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("사다리")));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activities WHERE title = ?", Integer.class, blocked)).isZero();
    }

    @Test
    void reviewActivityStaysHiddenUntilAnAdminApprovesAndRejectionNeedsAReason() throws Exception {
        String token = token(member("GENERAL"));
        String admin = token(admin());
        long id = json.readTree(perform(post("/api/activities"), activity("어르신과 함께 걷는 산책", "동네 공원에서 어르신과 천천히 걸으며 이야기를 나눕니다."), token)
                .andExpect(status().isCreated()).andExpect(jsonPath("$.riskLevel").value("REVIEW")).andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.riskReasons").value(org.hamcrest.Matchers.containsString("어르신")))
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
        mvc.perform(get("/api/activities")).andExpect(jsonPath("$[?(@.id == " + id + ")]").isEmpty());
        mvc.perform(get("/api/activities/" + id)).andExpect(status().isNotFound());
        mvc.perform(get("/api/activities/" + id).header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        mvc.perform(get("/api/admin/activities").header("Authorization", "Bearer " + token)).andExpect(status().isForbidden());

        mvc.perform(get("/api/admin/activities").header("Authorization", "Bearer " + admin))
                .andExpect(jsonPath("$[?(@.id == " + id + ")].riskReasons").exists());
        perform(post("/api/admin/activities/" + id + "/reject"), Map.of("reason", " "), admin).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("reason"));
        perform(post("/api/admin/activities/" + id + "/approve"), Map.of(), admin).andExpect(status().isNoContent());
        mvc.perform(get("/api/activities/" + id)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("RECRUITING"));
        perform(post("/api/admin/activities/" + id + "/approve"), Map.of(), admin).andExpect(status().isConflict());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM admin_actions WHERE target_type = 'ACTIVITY' AND target_id = ?", Integer.class, id)).isEqualTo(1);
    }

    @Test
    void restrictedAccountsCannotCreateActivities() throws Exception {
        String email = member("GENERAL");
        String token = token(email);
        jdbc.update("UPDATE users SET status = 'RESTRICTED' WHERE email = ?", email);
        perform(post("/api/activities"), activity("공원 쓰레기 줍기 모임", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), token)
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCOUNT_RESTRICTED"));
    }

    @Test
    void activitiesEndingAfterSunsetGoToReview() throws Exception {
        Map<String, Object> evening = activity("저녁 공원 정리 모임", "공원 산책로 주변의 가벼운 쓰레기를 함께 정리합니다.");
        evening.put("time", "19:30");
        evening.put("durationMinutes", 60);
        perform(post("/api/activities"), evening, token(member("GENERAL"))).andExpect(status().isCreated())
                .andExpect(jsonPath("$.riskLevel").value("REVIEW"))
                .andExpect(jsonPath("$.riskReasons").value(org.hamcrest.Matchers.containsString("해가 진 뒤")));
    }

    @Test
    void institutionActivityNeedsAnApprovedOrganization() throws Exception {
        String email = member("INSTITUTION");
        String token = token(email);
        mvc.perform(get("/api/me").header("Authorization", "Bearer " + token)).andExpect(jsonPath("$.organization.status").value("PENDING"));
        Map<String, Object> hosted = activity("기관과 함께하는 공원 정화", "기관 담당자와 함께 공원의 가벼운 쓰레기를 정리하는 활동입니다.");
        hosted.put("activityType", "INSTITUTION");
        perform(post("/api/activities"), hosted, token).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ORGANIZATION_NOT_APPROVED"));

        String admin = token(admin());
        long organization = jdbc.queryForObject("SELECT o.id FROM organizations o JOIN users u ON u.id = o.manager_user_id WHERE u.email = ?", Long.class, email);
        perform(post("/api/admin/organizations/" + organization + "/reject"), Map.of(), admin).andExpect(status().isBadRequest());
        perform(post("/api/admin/organizations/" + organization + "/approve"), Map.of(), admin).andExpect(status().isNoContent());
        perform(post("/api/activities"), hosted, token).andExpect(status().isCreated())
                .andExpect(jsonPath("$.activityType").value("INSTITUTION")).andExpect(jsonPath("$.organizationName").value("예시 기관"));
        perform(post("/api/activities"), activity("관리자가 여는 공원 활동", "관리자는 활동을 개설할 수 없는지 확인하는 요청입니다."), admin)
                .andExpect(status().isForbidden());
    }

    // ---- helpers ----

    private ResultActions perform(MockHttpServletRequestBuilder request, Object body, String token) throws Exception {
        request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        if (token != null) request.header("Authorization", "Bearer " + token);
        return mvc.perform(request);
    }

    private static String email() {
        return "w3-" + UUID.randomUUID() + "@example.com";
    }

    private Map<String, Object> signupBody(String email, String type, LocalDate birthDate) {
        Map<String, Object> body = new HashMap<>(Map.of("memberType", type, "name", "테스트", "email", email, "password", PASSWORD,
                "birthDate", birthDate.toString(), "interests", List.of("환경 정화"), "agreedNotice", true));
        if ("INSTITUTION".equals(type)) {
            body.put("organizationName", "예시 기관");
            body.put("organizationContact", "000-0000-0000");
        }
        return body;
    }

    private String member(String type) throws Exception {
        String email = email();
        perform(post("/api/auth/signup"), signupBody(email, type, TODAY.minusYears(20)), null).andExpect(status().isCreated());
        return email;
    }

    private String admin() {
        String email = "w3-admin-" + UUID.randomUUID() + "@example.com";
        jdbc.update("INSERT INTO users(email, display_name, password_hash, role) VALUES (?, '관리자', ?, 'ADMIN')", email, passwords.encode(PASSWORD));
        return email;
    }

    private String token(String email) throws Exception {
        JsonNode body = json.readTree(perform(post("/api/auth/login"), Map.of("email", email, "password", PASSWORD), null)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        return body.get("accessToken").asText();
    }

    private static Cookie cookie(MvcResult result) {
        String header = result.getResponse().getHeader("Set-Cookie");
        String value = header.substring(header.indexOf('=') + 1, header.indexOf(';'));
        return new Cookie(AuthController.REFRESH_COOKIE, value);
    }

    private static Map<String, Object> activity(String title, String description) {
        return new HashMap<>(Map.of("activityType", "GENERAL", "title", title, "category", "환경 정화", "placeId", 1,
                "date", TODAY.plusDays(7).toString(), "time", "10:00", "capacity", 6, "durationMinutes", 90,
                "description", description, "safetyConfirmed", true));
    }
}
