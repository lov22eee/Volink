package com.volink.admin;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.volink.ApiTestSupport;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 기관 모집글 (2026-11-11, V36): an approved institution may link its 1365 recruitment page; nobody else can. */
class OrgPostIntegrationTest extends ApiTestSupport {
    @Test
    void onlyAnInstitutionPostKeepsA1365LinkAndAnEditWithoutItKeepsIt() throws Exception {
        String email = member("INSTITUTION");
        String org = token(email);
        long organization = jdbc.queryForObject("SELECT o.id FROM organizations o JOIN users u ON u.id = o.manager_user_id WHERE u.email = ?", Long.class, email);
        perform(post("/api/admin/organizations/" + organization + "/approve"), Map.of(), token(admin())).andExpect(status().isNoContent());
        Map<String, Object> body = new HashMap<>(activity("김장 나눔 도우미", "어르신 댁에 보낼 김장을 함께 담가요. 앞치마와 장갑은 센터에서 드려요."));
        body.put("activityType", "INSTITUTION");
        body.put("vmsLink", "https://example.com/fake");
        perform(post("/api/activities"), body, org).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("vmsLink"));
        body.put("vmsLink", "https://www.1365.go.kr/vols/P9210/partcptn/timeCptn.do?progrmRegistNo=123");
        long id = createActivity(body, org);
        perform(get("/api/activities/" + id), null, null).andExpect(jsonPath("$.vmsLink").value("https://www.1365.go.kr/vols/P9210/partcptn/timeCptn.do?progrmRegistNo=123"));
        body.remove("vmsLink");
        body.put("capacity", 7);
        perform(put("/api/activities/" + id), body, org).andExpect(status().isOk());
        perform(get("/api/activities/" + id), null, null).andExpect(jsonPath("$.vmsLink").isNotEmpty()).andExpect(jsonPath("$.capacity").value(7));
        body.put("vmsLink", "");
        perform(put("/api/activities/" + id), body, org).andExpect(status().isOk());
        perform(get("/api/activities/" + id), null, null).andExpect(jsonPath("$.vmsLink").doesNotExist());
        // A personal post cannot carry one.
        Map<String, Object> personal = new HashMap<>(activity("공원 산책로 정리", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."));
        personal.put("vmsLink", "https://www.1365.go.kr/vols/x");
        perform(post("/api/activities"), personal, token(member("GENERAL"))).andExpect(status().isBadRequest());
    }

    @Test
    void adultOnlyPostsRefuseUnder19AQuestionNeedsAnAnswerAndTheOrganizationPageIsPublic() throws Exception {
        String email = member("INSTITUTION");
        String org = token(email);
        long organization = jdbc.queryForObject("SELECT o.id FROM organizations o JOIN users u ON u.id = o.manager_user_id WHERE u.email = ?", Long.class, email);
        perform(get("/api/organizations/" + organization), null, null).andExpect(status().isNotFound());
        perform(post("/api/admin/organizations/" + organization + "/approve"), Map.of(), token(admin())).andExpect(status().isNoContent());
        Map<String, Object> body = new HashMap<>(activity("김장 나눔 도우미", "어르신 댁에 보낼 김장을 함께 담가요. 앞치마와 장갑은 센터에서 드려요."));
        body.put("activityType", "INSTITUTION");
        body.put("youthOk", false);
        body.put("applyQuestion", "앞치마 사이즈를 알려 주세요 (S/M/L)");
        long id = createActivity(body, org);
        perform(get("/api/activities/" + id), null, null).andExpect(jsonPath("$.youthOk").value(false))
                .andExpect(jsonPath("$.applyQuestion").value("앞치마 사이즈를 알려 주세요 (S/M/L)")).andExpect(jsonPath("$.organizationId").value((int) organization));
        // 17 years old: refused. 20 years old: needs an answer, no contact details, then it is kept for the organizer.
        String young = email();
        perform(post("/api/auth/signup"), signupBody(young, "GENERAL", TODAY.minusYears(17)), null).andExpect(status().isCreated());
        perform(post("/api/activities/" + id + "/participations"), Map.of("answer", "M"), token(young)).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ADULT_ONLY"));
        String adult = token(member("GENERAL"));
        perform(post("/api/activities/" + id + "/participations"), Map.of(), adult).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("answer"));
        perform(post("/api/activities/" + id + "/participations"), Map.of("answer", "M 010-1234-5678"), adult).andExpect(status().isBadRequest());
        perform(post("/api/activities/" + id + "/participations"), Map.of("answer", "M 사이즈요"), adult).andExpect(status().isCreated());
        perform(get("/api/activities/" + id + "/participations"), null, org).andExpect(jsonPath("$.items[0].answer").value("M 사이즈요"));
        // The page: intro (no contact details), the open post.
        perform(put("/api/me/organization/intro"), Map.of("intro", "전화 010-1234-5678"), org).andExpect(status().isBadRequest());
        perform(put("/api/me/organization/intro"), Map.of("intro", "옥정동 어르신 반찬 나눔과 김장을 함께해요."), org).andExpect(status().isOk());
        perform(get("/api/organizations/" + organization), null, null).andExpect(status().isOk())
                .andExpect(jsonPath("$.intro").value("옥정동 어르신 반찬 나눔과 김장을 함께해요.")).andExpect(jsonPath("$.recruiting[0].id").value((int) id))
                .andExpect(jsonPath("$.contact").doesNotExist());
        perform(put("/api/me/organization/intro"), Map.of("intro", "개인"), token(member("GENERAL"))).andExpect(status().isForbidden());
    }
}
