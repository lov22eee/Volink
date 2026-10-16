package com.volink;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Shared HTTP helpers for API integration tests: sign up, log in, create activities. Every account is a fresh @example.com address. */
public abstract class ApiTestSupport extends IntegrationTestBase {
    protected static final String PASSWORD = "testPass123";
    protected static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Seoul"));

    @Autowired protected MockMvc mvc;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected ObjectMapper json;
    @Autowired protected PasswordEncoder passwords;

    protected ResultActions perform(MockHttpServletRequestBuilder request, Object body, String token) throws Exception {
        request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        if (token != null) request.header("Authorization", "Bearer " + token);
        return mvc.perform(request);
    }

    protected static String email() {
        return "w3-" + UUID.randomUUID() + "@example.com";
    }

    protected Map<String, Object> signupBody(String email, String type, LocalDate birthDate) {
        Map<String, Object> body = new HashMap<>(Map.of("memberType", type, "name", "테스트", "email", email, "password", PASSWORD,
                "birthDate", birthDate.toString(), "interests", List.of("환경 정화"), "agreedNotice", true));
        if ("INSTITUTION".equals(type)) {
            body.put("organizationName", "예시 기관");
            body.put("organizationContact", "000-0000-0000");
        }
        return body;
    }

    protected String member(String type) throws Exception {
        String email = email();
        perform(post("/api/auth/signup"), signupBody(email, type, TODAY.minusYears(20)), null).andExpect(status().isCreated());
        return email;
    }

    protected String admin() {
        String email = "w3-admin-" + UUID.randomUUID() + "@example.com";
        jdbc.update("INSERT INTO users(email, display_name, password_hash, role) VALUES (?, '관리자', ?, 'ADMIN')", email, passwords.encode(PASSWORD));
        return email;
    }

    protected String token(String email) throws Exception {
        JsonNode body = json.readTree(perform(post("/api/auth/login"), Map.of("email", email, "password", PASSWORD), null)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        return body.get("accessToken").asText();
    }

    protected static Map<String, Object> activity(String title, String description) {
        return new HashMap<>(Map.of("activityType", "GENERAL", "title", title, "category", "환경 정화", "placeId", 1,
                "date", TODAY.plusDays(7).toString(), "time", "10:00", "capacity", 6, "durationMinutes", 90,
                "description", description, "safetyConfirmed", true));
    }

    protected long createActivity(Map<String, Object> body, String token) throws Exception {
        return json.readTree(perform(post("/api/activities"), body, token).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
    }
}
