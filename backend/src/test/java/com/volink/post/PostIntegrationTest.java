package com.volink.post;

import com.volink.ApiTestSupport;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 활동 소식: notices by the organizer, questions by confirmed participants, one answer per question, no contact details. */
class PostIntegrationTest extends ApiTestSupport {
    String organizer, confirmed, pending;
    long activity;

    @BeforeEach
    void activityWithAConfirmedAndAPendingParticipant() throws Exception {
        organizer = token(member("GENERAL"));
        activity = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        confirmed = token(member("GENERAL"));
        long id = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), confirmed)
                .andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
        perform(post("/api/participations/" + id + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        pending = token(member("GENERAL"));
        perform(post("/api/activities/" + activity + "/participations"), Map.of(), pending).andExpect(status().isCreated());
    }

    @Test
    void organizerNoticesAndParticipantQuestionsShareOneThreadWithAnswers() throws Exception {
        perform(post("/api/activities/" + activity + "/notices"), Map.of("body", "장갑은 제가 20켤레 챙겨갈게요"), organizer).andExpect(status().isCreated());
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + confirmed)).andExpect(jsonPath("$.items[0].title").value("새 공지가 올라왔어요"));
        long question = json.readTree(perform(post("/api/activities/" + activity + "/questions"), Map.of("body", "주차 되나요?"), confirmed)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$.unanswered").value(1)).andExpect(jsonPath("$.canNotice").value(true)).andExpect(jsonPath("$.canAsk").value(false));
        perform(post("/api/activity-posts/" + question + "/answer"), Map.of("body", "공영주차장 1시간 무료예요"), organizer).andExpect(status().isCreated());
        perform(post("/api/activity-posts/" + question + "/answer"), Map.of("body", "한 번 더"), organizer).andExpect(status().isConflict());
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + confirmed)).andExpect(jsonPath("$.items[0].title").value("질문에 답변이 달렸어요"));
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + confirmed))
                .andExpect(status().isOk()).andExpect(jsonPath("$.canAsk").value(true)).andExpect(jsonPath("$.canNotice").value(false))
                .andExpect(jsonPath("$.notices[0].author").value("모집자")).andExpect(jsonPath("$.notices[0].body").value("장갑은 제가 20켤레 챙겨갈게요"))
                .andExpect(jsonPath("$.questions[0].mine").value(true)).andExpect(jsonPath("$.questions[0].author").value(org.hamcrest.Matchers.containsString("*")))
                .andExpect(jsonPath("$.questions[0].answer.body").value("공영주차장 1시간 무료예요")).andExpect(jsonPath("$.unanswered").value(0));
    }

    @Test
    void onlyTheOrganizerAndConfirmedParticipantsMayReadOrWrite() throws Exception {
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + pending)).andExpect(status().isForbidden());
        mvc.perform(get("/api/activities/" + activity + "/posts")).andExpect(status().isUnauthorized());
        perform(post("/api/activities/" + activity + "/questions"), Map.of("body", "저도 질문"), pending).andExpect(status().isForbidden());
        perform(post("/api/activities/" + activity + "/notices"), Map.of("body", "공지인 척"), confirmed).andExpect(status().isForbidden());
        long question = json.readTree(perform(post("/api/activities/" + activity + "/questions"), Map.of("body", "우천 시에는요?"), confirmed)
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
        perform(post("/api/activity-posts/" + question + "/answer"), Map.of("body", "제가 답할게요"), confirmed).andExpect(status().isForbidden());
        // Admins can read (for reports) but not post.
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + token(admin()))).andExpect(status().isOk())
                .andExpect(jsonPath("$.canNotice").value(false)).andExpect(jsonPath("$.canAsk").value(false));
    }

    @Test
    void contactDetailsEmptyOrLongBodiesAreRefused() throws Exception {
        for (String body : new String[] { "제 번호 010-1234-5678로 연락 주세요", "01012345678", "메일 helper@example.com", "https://open.kakao.com/o/abc", "오픈채팅 들어오세요" })
            perform(post("/api/activities/" + activity + "/questions"), Map.of("body", body), confirmed).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.fieldErrors[0].field").value("body"));
        perform(post("/api/activities/" + activity + "/notices"), Map.of("body", "  "), organizer).andExpect(status().isBadRequest());
        perform(post("/api/activities/" + activity + "/notices"), Map.of("body", "가".repeat(501)), organizer).andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_posts WHERE activity_id = ?", Integer.class, activity)).isZero();
    }

    @Test
    void authorsDeleteTheirOwnPostsAndTheOrganizerCanRemoveAQuestion() throws Exception {
        long question = json.readTree(perform(post("/api/activities/" + activity + "/questions"), Map.of("body", "몇 시까지 하나요?"), confirmed)
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
        perform(post("/api/activity-posts/" + question + "/answer"), Map.of("body", "11시 30분까지요"), organizer).andExpect(status().isCreated());
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/activity-posts/" + question)
                .header("Authorization", "Bearer " + pending)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/activity-posts/" + question).header("Authorization", "Bearer " + organizer)).andExpect(status().isNoContent());
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + confirmed)).andExpect(jsonPath("$.questions").isEmpty());
        // The rows stay (deleted_at) with the answer, for later reports.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_posts WHERE activity_id = ? AND deleted_at IS NOT NULL", Integer.class, activity)).isEqualTo(2);
    }

    @Test
    void aFinishedActivityIsReadOnly() throws Exception {
        jdbc.update("UPDATE activities SET status = 'FINISHED' WHERE id = ?", activity);
        perform(post("/api/activities/" + activity + "/notices"), Map.of("body", "수고하셨어요"), organizer).andExpect(status().isConflict());
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + confirmed))
                .andExpect(status().isOk()).andExpect(jsonPath("$.canAsk").value(false));
    }

    @Test
    void privateQuestionsAndWhatIsNewAndWhoReadTheNotice() throws Exception {
        String other = token(member("GENERAL"));
        long id = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), other)
                .andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
        perform(post("/api/participations/" + id + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());

        perform(post("/api/activities/" + activity + "/notices"), Map.of("body", "우비를 챙겨 주세요"), organizer).andExpect(status().isCreated());
        long secret = json.readTree(perform(post("/api/activities/" + activity + "/questions"), Map.of("body", "무릎이 안 좋은데 괜찮을까요?", "privately", true), confirmed)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
        // The other participant does not see the private question; the organizer and the asker do.
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + other))
                .andExpect(jsonPath("$.questions.length()").value(0)).andExpect(jsonPath("$.newNotices").value(1)).andExpect(jsonPath("$.notices[0].readCount").doesNotExist());
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + confirmed))
                .andExpect(jsonPath("$.questions[0].private").value(true));
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$.questions[0].id").value(secret)).andExpect(jsonPath("$.notices[0].readCount").value(0)).andExpect(jsonPath("$.audience").value(2));
        // Opening the news marks it as seen: the organizer sees 1 of 2 read, the badge goes away.
        Thread.sleep(1100);
        perform(post("/api/activities/" + activity + "/posts/seen"), null, other).andExpect(status().isNoContent());
        perform(post("/api/activities/" + activity + "/posts/seen"), null, pending).andExpect(status().isForbidden());
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + other)).andExpect(jsonPath("$.newNotices").value(0));
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.notices[0].readCount").value(1));
        // An answer is new for the asker until they open the news again.
        Thread.sleep(1100);
        perform(post("/api/activity-posts/" + secret + "/answer"), Map.of("body", "천천히 걸으셔도 괜찮아요"), organizer).andExpect(status().isCreated());
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + confirmed)).andExpect(jsonPath("$.newAnswers").value(1));
        mvc.perform(get("/api/activities/" + activity + "/posts").header("Authorization", "Bearer " + other)).andExpect(jsonPath("$.questions.length()").value(0));
    }
}
