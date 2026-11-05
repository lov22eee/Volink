package com.volink.post;

import com.volink.ApiTestSupport;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Community (V11): categories, review only for a completed activity, contact refused, likes, comments, delete. */
class CommunityIntegrationTest extends ApiTestSupport {
    String writer, other, organizer;
    long activity;

    @BeforeEach
    void users() throws Exception {
        writer = token(member("GENERAL"));
        other = token(member("GENERAL"));
        organizer = token(member("GENERAL"));
        activity = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        nickname(writer, "글쓴이" + seq());
        nickname(other, "읽는이" + seq());
    }

    static int counter = 0;
    static String seq() { return String.valueOf(System.nanoTime() % 10000 + (counter++)); }

    private void nickname(String token, String nick) throws Exception {
        perform(put("/api/community/me"), Map.of("nickname", nick, "agree", true), token).andExpect(status().isOk()).andExpect(jsonPath("$.ready").value(true));
    }

    @Test
    void aNicknameAndTheRulesComeFirst() throws Exception {
        String fresh = token(member("GENERAL"));
        mvc.perform(get("/api/community/me").header("Authorization", "Bearer " + fresh)).andExpect(jsonPath("$.ready").value(false));
        perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "안녕하세요", "body", "처음 인사드려요 반가워요"), fresh)
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("COMMUNITY_SETUP_REQUIRED"));
        perform(put("/api/community/me"), Map.of("nickname", "따뜻한 자몽", "agree", false), fresh).andExpect(status().isBadRequest());
        perform(put("/api/community/me"), Map.of("nickname", "운영자 자몽", "agree", true), fresh).andExpect(status().isBadRequest());
        perform(put("/api/community/me"), Map.of("nickname", "자", "agree", true), fresh).andExpect(status().isBadRequest());
        String nick = "자몽" + seq();
        nickname(fresh, nick);
        perform(put("/api/community/me"), Map.of("nickname", nick, "agree", true), writer).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NICKNAME_TAKEN"));
        // A change within 30 days is refused; the same nickname again is fine.
        perform(put("/api/community/me"), Map.of("nickname", "새자몽" + seq(), "agree", true), fresh).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NICKNAME_CHANGE_LIMIT"));
        long id = postId(fresh, Map.of("category", "FREE", "title", "안녕하세요", "body", "처음 인사드려요 반가워요"));
        mvc.perform(get("/api/community/posts/" + id).header("Authorization", "Bearer " + other)).andExpect(jsonPath("$.author").value(nick));
    }

    @Test
    void membersPostQuestionsAndEveryoneMemberSeesThemWithHiddenNames() throws Exception {
        mvc.perform(get("/api/community/posts")).andExpect(status().isUnauthorized());
        long id = postId(writer, Map.of("category", "QUESTION", "title", "첫 봉사 준비물이 있을까요?", "body", "이번 주말 처음 참여하는데 무엇을 챙기면 좋을까요?"));
        mvc.perform(get("/api/community/posts?category=QUESTION").header("Authorization", "Bearer " + other))
                .andExpect(jsonPath("$[0].id").value(id)).andExpect(jsonPath("$[0].author").value(containsString("글쓴이")))
                .andExpect(jsonPath("$[0].mine").value(false)).andExpect(jsonPath("$[0].verified").value(false)).andExpect(jsonPath("$[0].preview").exists());
        mvc.perform(get("/api/community/posts?category=REVIEW").header("Authorization", "Bearer " + other)).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void contactDetailsAndEmptyTitlesAreRefused() throws Exception {
        perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "같이 해요", "body", "연락 주세요 010-1234-5678"), writer)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("body"));
        perform(post("/api/community/posts"), Map.of("category", "FREE", "title", " ", "body", "내용은 충분히 길게 적었어요"), writer)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("title"));
        perform(post("/api/community/posts"), Map.of("category", "NOTICE", "title", "공지", "body", "내용은 충분히 길게 적었어요"), writer).andExpect(status().isBadRequest());
    }

    @Test
    void aReviewNeedsACompletedActivity() throws Exception {
        Map<String, Object> review = new HashMap<>(Map.of("category", "REVIEW", "title", "공원 정리 다녀왔어요", "body", "처음이었는데 금방 끝나고 뿌듯했어요.", "activityId", activity));
        perform(post("/api/community/posts"), review, writer).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("activityId"));
        complete(writer);
        mvc.perform(get("/api/community/reviewable").header("Authorization", "Bearer " + writer)).andExpect(jsonPath("$[0].id").value(activity));
        long id = postId(writer, review);
        mvc.perform(get("/api/community/posts/" + id).header("Authorization", "Bearer " + other))
                .andExpect(jsonPath("$.verified").value(true)).andExpect(jsonPath("$.activityTitle").value("공원 산책로 함께 정리하기"));
    }

    @Test
    void likesCommentsAndDeleting() throws Exception {
        long id = postId(writer, Map.of("category", "FREE", "title", "코팅 장갑이 편해요", "body", "목장갑보다 코팅 장갑이 훨씬 편했어요."));
        perform(put("/api/community/posts/" + id + "/like"), null, other).andExpect(jsonPath("$.likes").value(1));
        perform(put("/api/community/posts/" + id + "/like"), null, other).andExpect(jsonPath("$.likes").value(1));
        perform(post("/api/community/posts/" + id + "/comments"), Map.of("body", "좋은 팁 고마워요"), other).andExpect(status().isCreated())
                .andExpect(jsonPath("$.comments[0].body").value("좋은 팁 고마워요")).andExpect(jsonPath("$.comments[0].mine").value(true));
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + writer)).andExpect(jsonPath("$.items[0].type").value("COMMUNITY_COMMENT"));
        mvc.perform(get("/api/community/posts?sort=popular").header("Authorization", "Bearer " + writer)).andExpect(jsonPath("$[0].id").value(id))
                .andExpect(jsonPath("$[0].likes").value(1)).andExpect(jsonPath("$[0].comments").value(1));
        perform(delete("/api/community/posts/" + id + "/like"), null, other).andExpect(jsonPath("$.likes").value(0));
        perform(delete("/api/community/posts/" + id), null, other).andExpect(status().isNotFound());
        perform(delete("/api/community/posts/" + id), null, writer).andExpect(status().isNoContent());
        mvc.perform(get("/api/community/posts/" + id).header("Authorization", "Bearer " + other)).andExpect(status().isNotFound());
    }

    @Test
    void authorsEditTheirOwnPostsAndComments() throws Exception {
        long id = postId(writer, Map.of("category", "FREE", "title", "고칠 글이에요", "body", "처음에 쓴 내용이에요 고쳐 볼게요"));
        perform(put("/api/community/posts/" + id), Map.of("title", "고친 글이에요", "body", "고친 내용이에요 잘 보이나요"), other).andExpect(status().isNotFound());
        perform(put("/api/community/posts/" + id), Map.of("title", "고친 글이에요", "body", "연락 주세요 010-1234-5678"), writer).andExpect(status().isBadRequest());
        perform(put("/api/community/posts/" + id), Map.of("title", "고친 글이에요", "body", "고친 내용이에요 잘 보이나요"), writer).andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("고친 글이에요")).andExpect(jsonPath("$.edited").value(true));
        long comment = json.readTree(perform(post("/api/community/posts/" + id + "/comments"), Map.of("body", "댓글이에요"), other)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).path("comments").get(0).path("id").asLong();
        perform(put("/api/community/comments/" + comment), Map.of("body", "고친 댓글"), writer).andExpect(status().isNotFound());
        perform(put("/api/community/comments/" + comment), Map.of("body", "고친 댓글"), other).andExpect(status().isOk())
                .andExpect(jsonPath("$.comments[0].body").value("고친 댓글")).andExpect(jsonPath("$.comments[0].edited").value(true));

    }

    private long postId(String token, Map<String, Object> body) throws Exception {
        return json.readTree(perform(post("/api/community/posts"), body, token).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
    }

    /** Apply, approve, check in by hand, end, complete: the writer gets a record. */
    private void complete(String member) throws Exception {
        long pid = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), member).andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
        perform(post("/api/participations/" + pid + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Seoul"));
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", now.plusMinutes(10), now.plusMinutes(70), activity);
        perform(post("/api/participations/" + pid + "/manual-check-in"), Map.of("reason", "현장에서 얼굴로 확인함"), organizer).andExpect(status().isNoContent());
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", now.minusMinutes(90), now.minusMinutes(30), activity);
        perform(post("/api/participations/" + pid + "/complete"), Map.of(), organizer).andExpect(status().isNoContent());
    }
}
