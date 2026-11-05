package com.volink.auth;

import com.volink.ApiTestSupport;
import com.volink.FakeExternal;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 연결된 로그인 계정 and 회원 탈퇴 (V19). */
class AccountWithdrawalIntegrationTest extends ApiTestSupport {
    @Autowired FakeExternal.Social social;

    private long userId(String email) {
        return jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }

    private long pid(String body) throws Exception {
        return json.readTree(body).path("participation").path("id").asLong();
    }

    @Test
    void accountShowsHowTheMemberSignsInWithoutAPlaceholderEmail() throws Exception {
        String email = member("GENERAL");
        String token = token(email);
        perform(get("/api/me/account"), null, token).andExpect(status().isOk())
                .andExpect(jsonPath("$.method").value("EMAIL")).andExpect(jsonPath("$.email").value(email)).andExpect(jsonPath("$.links.length()").value(0));

        long id = userId(email);
        jdbc.update("UPDATE users SET email = ? WHERE id = ?", "kakao-" + id + "@social.volink.invalid", id);
        jdbc.update("INSERT INTO social_accounts(user_id, provider, subject) VALUES (?, 'KAKAO', ?)", id, "k" + id);
        perform(get("/api/me/account"), null, token).andExpect(jsonPath("$.method").value("KAKAO"))
                .andExpect(jsonPath("$.email").doesNotExist()).andExpect(jsonPath("$.links[0].provider").value("KAKAO"));
        perform(get("/api/me"), null, token).andExpect(jsonPath("$.providers[0]").value("KAKAO"));
    }

    @Test
    void hostingWithApplicantsBlocksWithdrawalUntilCancelled() throws Exception {
        String host = token(member("GENERAL"));
        long activity = createActivity(activity("탈퇴 막힘 확인 활동", "신청자가 있으면 모집자가 탈퇴하지 못하는지 보는 활동이에요."), host);
        String guest = token(member("GENERAL"));
        perform(post("/api/activities/" + activity + "/participations"), Map.of(), guest).andExpect(status().isCreated());

        perform(get("/api/me/withdrawal"), null, host).andExpect(jsonPath("$.allowed").value(false)).andExpect(jsonPath("$.blocking[0].id").value(activity));
        perform(post("/api/me/withdraw"), Map.of(), host).andExpect(status().isBadRequest());
        perform(post("/api/me/withdraw"), Map.of("confirm", true), host).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("HOSTING_ACTIVE"));

        perform(post("/api/activities/" + activity + "/cancel"), Map.of("reasonCode", "PERSONAL", "message", "개인 사정으로 취소합니다."), host).andExpect(status().isOk());
        perform(get("/api/me/withdrawal"), null, host).andExpect(jsonPath("$.allowed").value(true));
        perform(post("/api/me/withdraw"), Map.of("confirm", true), host).andExpect(status().isNoContent());
    }

    @Test
    void withdrawalCancelsApplicationsClearsTheAccountAndKeepsPostsAnonymous() throws Exception {
        String host = token(member("GENERAL"));
        java.util.HashMap<String, Object> body = new java.util.HashMap<>(activity("자리 넘기기 확인 활동", "탈퇴한 사람의 자리가 대기자에게 가는지 보는 활동이에요."));
        body.put("capacity", 1);
        long activity = createActivity(body, host);
        long emptyHosted;

        String email = member("GENERAL");
        String leaver = token(email);
        long id = userId(email);
        long mine = pid(perform(post("/api/activities/" + activity + "/participations"), Map.of(), leaver).andReturn().getResponse().getContentAsString());
        perform(post("/api/participations/" + mine + "/approve"), Map.of(), host).andExpect(status().isNoContent());
        String waiting = token(member("GENERAL"));
        long next = pid(perform(post("/api/activities/" + activity + "/participations"), Map.of(), waiting).andReturn().getResponse().getContentAsString());
        emptyHosted = createActivity(activity("아무도 없는 내 활동", "신청자가 없어서 탈퇴하면 함께 내려가는 활동이에요."), leaver);

        // A community post with a nickname, Kakao linked.
        perform(put("/api/community/me"), Map.of("nickname", "떠나는" + (System.nanoTime() % 10000), "agree", true), leaver).andExpect(status().isOk());
        long post = json.readTree(perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "안녕히 계세요", "body", "그동안 고마웠어요 모두"), leaver)
                .andReturn().getResponse().getContentAsString()).path("id").asLong();
        jdbc.update("INSERT INTO social_accounts(user_id, provider, subject) VALUES (?, 'KAKAO', ?)", id, "kakao-" + id);
        social.unlinked.clear();

        perform(get("/api/me/withdrawal"), null, leaver).andExpect(jsonPath("$.applications").value(1)).andExpect(jsonPath("$.hosted").value(1));
        perform(post("/api/me/withdraw"), Map.of("confirm", true), leaver).andExpect(status().isNoContent());

        // The seat went to the next person; the empty hosted activity is gone from view.
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, mine)).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, next)).isEqualTo("OFFERED");
        assertThat(jdbc.queryForObject("SELECT status FROM activities WHERE id = ?", String.class, emptyHosted)).isEqualTo("DELETED");

        // Personal data cleared, the old token and login stop working, Kakao unlinked.
        Map<String, Object> row = jdbc.queryForMap("SELECT email, display_name, community_nickname, status FROM users WHERE id = ?", id);
        assertThat(row.get("email")).isEqualTo("withdrawn-" + id + "@withdrawn.volink.invalid");
        assertThat(row.get("display_name")).isEqualTo(AccountService.WITHDRAWN_NAME);
        assertThat(row.get("community_nickname")).isNull();
        assertThat(row.get("status")).isEqualTo("WITHDRAWN");
        for (String table : new String[]{"social_accounts", "user_interests", "notifications"})
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE user_id = ?", Integer.class, id)).isZero();
        assertThat(social.unlinked).containsExactly("kakao-" + id);
        assertThat(jdbc.queryForObject("SELECT unlinked FROM account_withdrawals WHERE user_id = ?", String.class, id)).isEqualTo("KAKAO");
        perform(get("/api/me"), null, leaver).andExpect(status().isUnauthorized());
        perform(post("/api/auth/login"), Map.of("email", email, "password", PASSWORD), null).andExpect(status().isUnauthorized());

        // The post stays, written by "탈퇴한 회원".
        perform(get("/api/community/me"), null, waiting);
        perform(put("/api/community/me"), Map.of("nickname", "남은이" + (System.nanoTime() % 10000), "agree", true), waiting).andExpect(status().isOk());
        perform(get("/api/community/posts/" + post), null, waiting).andExpect(status().isOk()).andExpect(jsonPath("$.author").value(AccountService.WITHDRAWN_NAME));
    }
}
