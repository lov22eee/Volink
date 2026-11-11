package com.volink.admin;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.hamcrest.Matchers.*;

import com.volink.ApiTestSupport;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** PC 관리자 콘솔 (2026-11-11): action log, overview, server status and member lookup — admin only, read only. */
class OpsIntegrationTest extends ApiTestSupport {
    @Test
    void onlyAnAdminSeesTheConsoleData() throws Exception {
        String member = token(member("GENERAL"));
        for (String path : new String[]{"/api/admin/actions", "/api/admin/overview", "/api/admin/system", "/api/admin/members?q=ab"})
            perform(get(path), null, member).andExpect(status().isForbidden());
    }

    @Test
    void anAdminDecisionShowsInTheLogAndTheMemberCanBeFound() throws Exception {
        String admin = token(admin());
        String email = member("GENERAL");
        long id = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
        // An activity sent to review, then approved with a reason: one line in today's log with the activity title.
        String organizer = token(member("GENERAL"));
        long activity = createActivity(activity("하천변 야간 정리", "편한 신발을 신고 하천변 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        perform(post("/api/admin/activities/" + activity + "/approve"), Map.of("reason", "낮 시간으로 안내 확인"), admin).andExpect(status().isNoContent());
        perform(get("/api/admin/actions?today=true&type=ACTIVITY"), null, admin).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].targetId").value((int) activity)).andExpect(jsonPath("$[0].targetName").value("하천변 야간 정리"))
                .andExpect(jsonPath("$[0].reason").value("낮 시간으로 안내 확인"));
        // Too short a word finds nothing; the e-mail finds the member, and the detail has counts and lists.
        perform(get("/api/admin/members?q=a"), null, admin).andExpect(jsonPath("$", hasSize(0)));
        perform(get("/api/admin/members?q=" + email), null, admin).andExpect(jsonPath("$[0].id").value((int) id));
        perform(get("/api/admin/members/" + id), null, admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.completed").value(0)).andExpect(jsonPath("$.sanctions", hasSize(0))).andExpect(jsonPath("$.participations").isArray());
        perform(get("/api/admin/members/999999999"), null, admin).andExpect(status().isNotFound());
    }

    @Test
    void overviewAndServerStatusAnswer() throws Exception {
        String admin = token(admin());
        perform(get("/api/admin/overview"), null, admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.weeks", hasSize(12))).andExpect(jsonPath("$.speed", hasSize(4))).andExpect(jsonPath("$.members").isNumber());
        perform(get("/api/admin/system"), null, admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.database.ok").value(true)).andExpect(jsonPath("$.database.schema").isNotEmpty())
                .andExpect(jsonPath("$.disk.freeBytes").isNumber()).andExpect(jsonPath("$.volunteer1365.limit").value(900));
    }
}
