package com.volink.phone;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.volink.ApiTestSupport;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 1인 1계정 (V42, 2026-11-22): a verified phone before 신청 · 모집글 · 글쓰기, one account per number. */
class PhoneIntegrationTest extends ApiTestSupport {
    @Autowired PhoneService phones;

    @BeforeEach void on() { phones.enforce(true); }
    @AfterEach void off() { phones.enforce(false); }

    private static String number() { return "+8210" + (10_000_000 + ThreadLocalRandom.current().nextInt(89_999_999)); }
    private static Map<String, Object> proof(String phone) { return Map.of("proof", "dev:" + phone); }
    private long id(String email) { return jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email); }
    private Map<String, Object> body(String title) { return activity(title, "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."); }

    @Test
    void aNewMemberProvesAPhoneBeforeOpeningAnActivity() throws Exception {
        String token = token(member("GENERAL"));
        perform(get("/api/me/phone"), null, token).andExpect(jsonPath("$.required").value(true)).andExpect(jsonPath("$.verified").value(false));
        perform(post("/api/activities"), body("공원 산책로 함께 정리하기"), token).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("PHONE_REQUIRED"));
        String phone = number();
        perform(post("/api/me/phone"), proof(phone), token).andExpect(jsonPath("$.status").value("VERIFIED")).andExpect(jsonPath("$.last4").value(phone.substring(phone.length() - 4)));
        createActivity(body("공원 산책로 함께 정리하기"), token);
        // the number itself is not stored, only its hash and last four digits
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE phone_hash LIKE ?", Integer.class, "%" + phone.substring(1) + "%")).isZero();
    }

    @Test
    void anAccountFromBeforeTheChangeWaitsUntilItsGraceDay() throws Exception {
        String email = member("GENERAL"), token = token(email);
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Seoul"));
        jdbc.update("UPDATE users SET phone_grace_until = ? WHERE id = ?", now.plusDays(3), id(email));
        perform(get("/api/me/phone"), null, token).andExpect(jsonPath("$.required").value(false)).andExpect(jsonPath("$.active").value(true));
        createActivity(body("공원 산책로 함께 정리하기"), token);
        jdbc.update("UPDATE users SET phone_grace_until = ? WHERE id = ?", now.minusMinutes(1), id(email));
        perform(post("/api/activities"), body("공원 산책로 함께 정리하기"), token).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("PHONE_REQUIRED"));
    }

    @Test
    void oneNumberHoldsOneAccount() throws Exception {
        String phone = number();
        String first = member("GENERAL");
        perform(post("/api/me/phone"), proof(phone), token(first)).andExpect(jsonPath("$.status").value("VERIFIED"));
        // another account with the same number: told which account has it (masked), nothing changes
        String secondToken = token(member("GENERAL"));
        perform(post("/api/me/phone"), proof(phone), secondToken).andExpect(jsonPath("$.status").value("TAKEN"))
                .andExpect(jsonPath("$.account.email").value(first.substring(0, 2) + "***" + first.substring(first.indexOf('@'))));
        // before an e-mail sign-up the app asks, and a sign-up with a taken number is refused without making the account
        perform(post("/api/auth/phone-check"), proof(phone), null).andExpect(jsonPath("$.status").value("TAKEN"));
        Map<String, Object> body = new HashMap<>(signupBody("taken-" + phone.substring(5) + "@example.com", "GENERAL", TODAY.minusYears(20)));
        body.put("phoneProof", "dev:" + phone);
        perform(post("/api/auth/signup"), body, null).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("PHONE_TAKEN"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, body.get("email"))).isZero();
        String fresh = number();
        perform(post("/api/auth/phone-check"), proof(fresh), null).andExpect(jsonPath("$.status").value("FREE"));
        body.put("phoneProof", "dev:" + fresh);
        perform(post("/api/auth/signup"), body, null).andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT phone_last4 FROM users WHERE email = ?", String.class, body.get("email"))).isEqualTo(fresh.substring(fresh.length() - 4));
        // the new empty account goes back to the one that has the number
        perform(post("/api/me/phone/abandon"), Map.of(), secondToken).andExpect(jsonPath("$.status").value("WITHDRAWN"));
    }

    @Test
    void anAdminMovesADisputedNumberAndAWithdrawalFreesIt() throws Exception {
        String phone = number();
        String holder = member("GENERAL"), holderToken = token(holder);
        perform(post("/api/me/phone"), proof(phone), holderToken).andExpect(jsonPath("$.status").value("VERIFIED"));
        String asker = member("GENERAL"), askerToken = token(asker);
        perform(post("/api/me/phone/dispute"), Map.of("proof", "dev:" + phone, "note", "번호를 새로 받았어요"), askerToken).andExpect(jsonPath("$.status").value("DISPUTED"));
        perform(post("/api/me/phone/dispute"), Map.of("proof", "dev:" + phone), askerToken).andExpect(status().isConflict());
        String admin = token(admin());
        long dispute = jdbc.queryForObject("SELECT id FROM phone_disputes WHERE user_id = ?", Long.class, id(asker));
        perform(get("/api/admin/phone-disputes"), null, admin).andExpect(status().isOk());
        perform(post("/api/admin/phone-disputes/" + dispute + "/decision"), Map.of("decision", "MOVE", "reason", ""), admin).andExpect(status().isBadRequest());
        perform(post("/api/admin/phone-disputes/" + dispute + "/decision"), Map.of("decision", "MOVE", "reason", "통신사 명의 확인"), admin).andExpect(jsonPath("$.status").value("MOVED"));
        perform(get("/api/me/phone"), null, askerToken).andExpect(jsonPath("$.verified").value(true));
        perform(get("/api/me/phone"), null, holderToken).andExpect(jsonPath("$.verified").value(false)).andExpect(jsonPath("$.required").value(true));
        // 기관 accounts are not asked
        perform(get("/api/me/phone"), null, token(member("INSTITUTION"))).andExpect(jsonPath("$.active").value(false));
    }

    @Test
    void connecting1365NeedsAVerifiedPhoneEvenDuringTheGracePeriod() throws Exception {
        String email = member("GENERAL"), token = token(email);
        jdbc.update("UPDATE users SET phone_grace_until = ? WHERE id = ?", LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusDays(5), id(email));
        Map<String, Object> rows = Map.of("items", java.util.List.of(Map.of("title", "하천 정화 활동", "date", TODAY.minusDays(3).toString(), "startTime", "10:00", "endTime", "12:00")));
        perform(post("/api/me/external/import"), rows, token).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("PHONE_REQUIRED"));
        perform(post("/api/me/phone"), proof(number()), token).andExpect(jsonPath("$.status").value("VERIFIED"));
        perform(post("/api/me/external/import"), rows, token).andExpect(status().is2xxSuccessful());
    }
}
