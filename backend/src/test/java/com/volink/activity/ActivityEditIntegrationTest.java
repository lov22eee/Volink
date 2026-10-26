package com.volink.activity;

import com.volink.ApiTestSupport;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 4주차 보완 2: spacing-insensitive risk words, organizer edit/delete locked by applications (docs/test-cases.md E-01..E-05). */
class ActivityEditIntegrationTest extends ApiTestSupport {
    @Test
    void theFormCanAskWhichFieldHasARiskWordWithoutSaving() throws Exception {
        String organizer = token(member("GENERAL"));
        perform(post("/api/activities/check"), Map.of("title", "어르신 말벗 산책", "description", "전기 배관 주변을 정리합니다.", "supplies", java.util.List.of("장갑", "사다리")), organizer)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title[0].keyword").value("어르신")).andExpect(jsonPath("$.title[0].level").value("REVIEW"))
                .andExpect(jsonPath("$.description[*].level").value(org.hamcrest.Matchers.hasItem("BLOCKED")))
                .andExpect(jsonPath("$.supplies[0].keyword").value("사다리"));
        perform(post("/api/activities/check"), Map.of("title", "공원 산책로 함께 걷고 줍기", "description", "천천히 걸으며 쓰레기를 줍습니다."), organizer)
                .andExpect(jsonPath("$.title.length()").value(0)).andExpect(jsonPath("$.description.length()").value(0));
        mvc.perform(post("/api/activities/check").contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activities WHERE title = '어르신 말벗 산책'", Integer.class)).isZero();
    }

    @Test
    void riskWordsMatchWithoutSpaces() throws Exception {
        String organizer = token(member("GENERAL"));
        perform(post("/api/activities"), activity("전기 배관 작업 도와주세요", "안녕하세요. 전기 배관 작업 도와주실 분들을 모집합니다."), organizer)
                .andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("ACTIVITY_BLOCKED"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("배관")));
        perform(post("/api/activities"), activity("전기배관 청소작업 모집", "건물 전기배관 주변을 함께 청소하는 활동입니다. 편하게 오세요."), organizer)
                .andExpect(status().isUnprocessableEntity());
        perform(post("/api/activities"), activity("가스안전 캠페인 함께해요", "공원 입구에서 가스 안전 안내문을 함께 나눠 드리는 활동입니다."), organizer)
                .andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.riskReasons").value(org.hamcrest.Matchers.containsString("가스")));
        perform(post("/api/activities"), activity("사 다 리 없이 하는 청소", "높은 곳 없이 사 다 리 를 쓰지 않는 가벼운 청소 활동입니다."), organizer)
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void organizerEditsAndTheRiskCheckRunsAgain() throws Exception {
        String organizer = token(member("GENERAL"));
        long id = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        Map<String, Object> edit = activity("공원 산책로 함께 정리하기 2", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다.");
        edit.put("capacity", 8);
        perform(put("/api/activities/" + id), edit, token(member("GENERAL"))).andExpect(status().isNotFound());
        perform(put("/api/activities/" + id), edit, organizer).andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("공원 산책로 함께 정리하기 2")).andExpect(jsonPath("$.capacity").value(8)).andExpect(jsonPath("$.status").value("RECRUITING"));
        // Edited into a ladder job: refused, nothing changes.
        edit.put("description", "사다리를 타고 올라가 공원 가로등을 닦는 활동입니다. 함께해요.");
        perform(put("/api/activities/" + id), edit, organizer).andExpect(status().isUnprocessableEntity());
        mvc.perform(get("/api/activities/" + id)).andExpect(jsonPath("$.status").value("RECRUITING")).andExpect(jsonPath("$.capacity").value(8));
        // Edited into a REVIEW activity: hidden again until an admin approves.
        edit.put("description", "공원에서 어르신과 함께 천천히 걸으며 쓰레기를 줍는 활동입니다.");
        perform(put("/api/activities/" + id), edit, organizer).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DRAFT"));
        mvc.perform(get("/api/activities/" + id)).andExpect(status().isNotFound());
        mvc.perform(get("/api/activities/" + id).header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.applicants").value(0));
    }

    @Test
    void applicationsLockTheFullEditAndDeleteButNotTheNotes() throws Exception {
        String organizer = token(member("GENERAL"));
        long id = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        String applicantEmail = member("GENERAL");
        long applicant = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, applicantEmail);
        jdbc.update("INSERT INTO participations(activity_id, user_id, status) VALUES (?, ?, 'APPLIED')", id, applicant);

        perform(put("/api/activities/" + id), activity("다른 제목으로 바꾸기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("HAS_APPLICANTS"));
        mvc.perform(delete("/api/activities/" + id).header("Authorization", "Bearer " + organizer)).andExpect(status().isConflict());
        perform(patch("/api/activities/" + id + "/notes"), Map.of("description", "편한 신발을 신고 오세요. 집게와 봉투는 나눠 드립니다.", "meetingPoint", "정문 앞"), organizer)
                .andExpect(status().isOk()).andExpect(jsonPath("$.meetingPoint").value("정문 앞"));
        perform(patch("/api/activities/" + id + "/notes"), Map.of("description", "사다리를 가져와서 함께 높은 곳을 닦아요. 꼭 오세요.", "meetingPoint", ""), organizer)
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(get("/api/activities/" + id).header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.applicants").value(1));
    }

    @Test
    void deletedActivitiesDisappearEverywhere() throws Exception {
        String organizer = token(member("GENERAL"));
        long id = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        mvc.perform(delete("/api/activities/" + id).header("Authorization", "Bearer " + token(member("GENERAL")))).andExpect(status().isNotFound());
        mvc.perform(delete("/api/activities/" + id).header("Authorization", "Bearer " + organizer)).andExpect(status().isNoContent());
        mvc.perform(get("/api/activities/" + id).header("Authorization", "Bearer " + organizer)).andExpect(status().isNotFound());
        mvc.perform(get("/api/activities")).andExpect(jsonPath("$[?(@.id == " + id + ")]").isEmpty());
        mvc.perform(get("/api/me/activities").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$[?(@.id == " + id + ")]").isEmpty());
        assertThat(jdbc.queryForObject("SELECT to_status FROM activity_logs WHERE activity_id = ? ORDER BY id DESC LIMIT 1", String.class, id)).isEqualTo("DELETED");
        // A started activity cannot be edited.
        long started = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        jdbc.update("UPDATE activities SET starts_at = NOW() - INTERVAL 1 HOUR, ends_at = NOW() WHERE id = ?", started);
        mvc.perform(delete("/api/activities/" + started).header("Authorization", "Bearer " + organizer)).andExpect(status().isConflict());
    }
}
