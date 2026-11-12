package com.volink.safety;

import com.volink.ApiTestSupport;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Week 7 (2026-11-09, docs/test-cases.md W7-*): capacity change, public names, organizer extra time, reports with the admin
 * decision and the report ladder, community photos, no-show penalty and appeals, reviews of hosted activities.
 */
class Week7IntegrationTest extends ApiTestSupport {
    @Autowired PenaltyService penalties;
    static final java.util.concurrent.atomic.AtomicInteger seq = new java.util.concurrent.atomic.AtomicInteger(new java.util.Random().nextInt(50_000));

    private static LocalDateTime now() { return LocalDateTime.now(ZoneId.of("Asia/Seoul")); }

    private Map<String, Object> body(int capacity) {
        Map<String, Object> body = new HashMap<>(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."));
        body.put("capacity", capacity);
        return body;
    }

    private long apply(long activity, String token) throws Exception {
        return json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), token).andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
    }

    private String stateOf(long participation) {
        return jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, participation);
    }

    private void nickname(String token) throws Exception {
        perform(put("/api/community/me"), Map.of("nickname", "칠주" + (seq.getAndIncrement() % 100_000), "agree", true), token).andExpect(status().isOk());
    }

    private long userId(String email) {
        return jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }

    @Test
    void moreSeatsGoToTheWaitingListInOrderAndNeverBelowTheSeatsHeld() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(body(1), organizer);
        long first = apply(activity, token(member("GENERAL")));
        perform(post("/api/participations/" + first + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        long second = apply(activity, token(member("GENERAL")));
        String thirdToken = token(member("GENERAL"));
        long third = apply(activity, thirdToken);
        assertThat(stateOf(second)).isEqualTo("WAITLISTED");
        perform(put("/api/activities/" + activity + "/capacity"), Map.of("capacity", 2), token(member("GENERAL"))).andExpect(status().isNotFound());
        perform(put("/api/activities/" + activity + "/capacity"), Map.of("capacity", 10), organizer).andExpect(status().isBadRequest());
        perform(put("/api/activities/" + activity + "/capacity"), Map.of("capacity", 2), organizer).andExpect(status().isOk()).andExpect(jsonPath("$.offered").value(1));
        assertThat(stateOf(second)).isEqualTo("OFFERED");
        assertThat(stateOf(third)).isEqualTo("WAITLISTED");
        // The one ahead got the seat offer, so the place shown moves up from 2 to 1 (2026-11-10).
        perform(get("/api/activities/" + activity + "/my-participation"), null, thirdToken).andExpect(status().isOk())
                .andExpect(jsonPath("$.participation.waitOrder").value(1));
        perform(get("/api/me/participations"), null, thirdToken).andExpect(jsonPath("$[0].waitOrder").value(1));
        // Two seats are held now (one confirmed, one offered): 1 is refused.
        perform(put("/api/activities/" + activity + "/capacity"), Map.of("capacity", 1), organizer).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("BELOW_TAKEN"));
    }

    @Test
    void everyoneSeesTheNicknameAndOnlyConfirmedPeopleTheRealName() throws Exception {
        String organizerEmail = member("GENERAL"), organizer = token(organizerEmail);
        long activity = createActivity(body(3), organizer);
        String stranger = token(member("GENERAL")), joinerEmail = member("GENERAL"), joiner = token(joinerEmail);
        String real = jdbc.queryForObject("SELECT display_name FROM users WHERE email = ?", String.class, organizerEmail);
        mvc.perform(get("/api/activities/" + activity).header("Authorization", "Bearer " + stranger))
                .andExpect(jsonPath("$.organizerName").value(org.hamcrest.Matchers.not(real))).andExpect(jsonPath("$.organizerRealName").doesNotExist())
                .andExpect(jsonPath("$.organizerStats.hosted").value(1));
        nickname(organizer);
        String nick = jdbc.queryForObject("SELECT community_nickname FROM users WHERE email = ?", String.class, organizerEmail);
        mvc.perform(get("/api/activities").param("q", "공원")).andExpect(jsonPath("$[?(@.id == " + activity + ")].organizerName").value(nick));
        long p = apply(activity, joiner);
        perform(post("/api/participations/" + p + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        mvc.perform(get("/api/activities/" + activity).header("Authorization", "Bearer " + joiner)).andExpect(jsonPath("$.organizerRealName").value(real));
    }

    @Test
    void theOrganizerAddsTheExtraTimeOnceWithin24HoursOnlyForWhoStayed() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(body(3), organizer);
        long stayed = apply(activity, token(member("GENERAL")));
        long left = apply(activity, token(member("GENERAL")));
        for (long p : List.of(stayed, left)) perform(post("/api/participations/" + p + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", now().plusMinutes(10), now().plusMinutes(70), activity);
        for (long p : List.of(stayed, left)) perform(post("/api/participations/" + p + "/manual-check-in"), Map.of("reason", "현장에서 얼굴로 확인함"), organizer).andExpect(status().isNoContent());
        Map<String, Object> extra = new HashMap<>(Map.of("minutes", 40, "reason", "CLEANUP", "participationIds", List.of(stayed), "includeMe", true));
        perform(put("/api/activities/" + activity + "/extra-time"), extra, organizer).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("NOT_ENDED"));
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", now().minusMinutes(90), now().minusMinutes(30), activity);
        perform(put("/api/activities/" + activity + "/extra-time"), Map.of("minutes", 150, "reason", "CLEANUP", "participationIds", List.of(stayed)), organizer).andExpect(status().isBadRequest());
        perform(put("/api/activities/" + activity + "/extra-time"), extra, organizer).andExpect(status().isOk()).andExpect(jsonPath("$.people").value(1));
        assertThat(jdbc.queryForObject("SELECT extra_minutes FROM participations WHERE id = ?", Integer.class, stayed)).isEqualTo(40);
        assertThat(jdbc.queryForObject("SELECT extra_minutes FROM participations WHERE id = ?", Integer.class, left)).isZero();
        assertThat(jdbc.queryForObject("SELECT extra_minutes FROM activities WHERE id = ?", Integer.class, activity)).isEqualTo(40);
        perform(put("/api/activities/" + activity + "/extra-time"), extra, organizer).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EXTRA_DONE"));
    }

    @Test
    void anAcceptedReportHidesThePostAndTheSecondOneLimitsWriting() throws Exception {
        String writerEmail = member("GENERAL"), writer = token(writerEmail), reporter = token(member("GENERAL")), admin = token(admin());
        nickname(writer); nickname(reporter);
        long post1 = json.readTree(perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "같이 해요", "body", "자세한 이야기는 따로 해요 반가워요"), writer)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
        perform(post("/api/reports"), Map.of("targetType", "POST", "targetId", post1, "reason", "CONTACT"), writer).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("OWN_TARGET"));
        perform(post("/api/reports"), Map.of("targetType", "POST", "targetId", post1, "reason", "CONTACT", "description", "외부 연락을 유도해요"), reporter).andExpect(status().isOk());
        perform(post("/api/reports"), Map.of("targetType", "POST", "targetId", post1, "reason", "CONTACT"), reporter).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("REPORT_EXISTS"));
        long report = jdbc.queryForObject("SELECT id FROM reports WHERE target_type = 'POST' AND target_id = ?", Long.class, post1);
        perform(post("/api/admin/reports/" + report + "/decision"), Map.of("decision", "ACCEPT", "hide", true, "reason", ""), admin).andExpect(status().isBadRequest());
        perform(post("/api/admin/reports/" + report + "/decision"), Map.of("decision", "ACCEPT", "hide", true, "reason", "외부 연락처 유도"), reporter).andExpect(status().isForbidden());
        perform(post("/api/admin/reports/" + report + "/decision"), Map.of("decision", "ACCEPT", "hide", true, "reason", "외부 연락처 유도"), admin).andExpect(status().isOk());
        mvc.perform(get("/api/community/posts/" + post1).header("Authorization", "Bearer " + reporter)).andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("SELECT type FROM sanctions WHERE user_id = ? AND source = 'REPORT'", String.class, userId(writerEmail))).isEqualTo("WARNING");
        // A second accepted report → 7 days without writing (posts and comments), reading stays.
        long post2 = json.readTree(perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "또 같이 해요", "body", "따로 이야기해요 반가워요 정말"), writer)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
        perform(post("/api/reports"), Map.of("targetType", "POST", "targetId", post2, "reason", "SPAM"), reporter).andExpect(status().isOk());
        long report2 = jdbc.queryForObject("SELECT id FROM reports WHERE target_type = 'POST' AND target_id = ?", Long.class, post2);
        perform(post("/api/admin/reports/" + report2 + "/decision"), Map.of("decision", "ACCEPT", "hide", false, "reason", "도배"), admin).andExpect(status().isOk());
        perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "다시 왔어요", "body", "안녕하세요 반가워요 모두"), writer)
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("RESTRICTED"));
        mvc.perform(get("/api/me/status").header("Authorization", "Bearer " + writer)).andExpect(jsonPath("$.write.until").isNotEmpty()).andExpect(jsonPath("$.host").isEmpty()).andExpect(jsonPath("$.warnings").value(2));
        // 2026-11-12 (user decision): the 2nd step is 24 hours of 글·댓글 only — a 모집글 can still be opened.
        assertThat(jdbc.queryForObject("SELECT TIMESTAMPDIFF(HOUR, starts_at, ends_at) FROM sanctions WHERE user_id = ? AND source = 'REPORT' AND scope = 'WRITE'", Integer.class, userId(writerEmail))).isEqualTo(24);
        createActivity(body(3), writer);
    }

    @Test
    void theReportLadderLimitsTheCommunityOnlyAndSixStepsGoToAnAdmin() throws Exception {
        String writerEmail = member("GENERAL"), writer = token(writerEmail), reporter = token(member("GENERAL")), adminEmail = admin(), admin = token(adminEmail);
        nickname(writer); nickname(reporter);
        long user = userId(writerEmail), adminId = userId(adminEmail);
        long post = json.readTree(perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "사다리 확인", "body", "사다리 확인용 글이에요 반가워요"), writer)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
        perform(post("/api/reports"), Map.of("targetType", "POST", "targetId", post, "reason", "SPAM"), reporter).andExpect(status().isOk());
        long report = jdbc.queryForObject("SELECT id FROM reports WHERE target_type = 'POST' AND target_id = ?", Long.class, post);
        // A step older than a year does not count.
        jdbc.update("INSERT INTO sanctions(user_id, type, scope, source, reason, report_id, starts_at, ends_at, created_by) VALUES (?, 'WARNING', 'NONE', 'REPORT', '오래된 경고', ?, ?, NULL, ?)",
                user, report, now().minusDays(400), adminId);
        int[] hours = { 0, 24, 7 * 24, 14 * 24, 30 * 24, 30 * 24 };
        String[] scopes = { "NONE", "WRITE", "POST", "POST", "POST", "POST" };
        for (int i = 0; i < 6; i++) {
            penalties.afterReport(user, report, adminId, "도배");
            Map<String, Object> last = jdbc.queryForMap("SELECT scope, TIMESTAMPDIFF(HOUR, starts_at, ends_at) AS h FROM sanctions WHERE user_id = ? AND source = 'REPORT' ORDER BY id DESC LIMIT 1", user);
            assertThat(last.get("scope")).isEqualTo(scopes[i]);
            if (i > 0) assertThat(((Number) last.get("h")).intValue()).isEqualTo(hours[i]);
        }
        assertThat(penalties.reportSteps(user)).isEqualTo(6);
        // 봉사 신청은 그대로, 모집글·글은 막힘.
        assertThatCode(() -> penalties.check(user, "APPLY")).doesNotThrowAnyException();
        perform(post("/api/activities"), body(3), writer).andExpect(status().isForbidden()).andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("모집글을 만들 수 없어요")));
        // The 6th step puts the person on the admin's 할 일; 커뮤니티 이용 정지 has no end and takes it off.
        mvc.perform(get("/api/admin/community-reviews").header("Authorization", "Bearer " + admin)).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.userId == " + user + ")].steps").value(org.hamcrest.Matchers.contains(6)));
        perform(post("/api/admin/community-reviews/" + user), Map.of("decision", "STOP", "reason", ""), admin).andExpect(status().isBadRequest());
        perform(post("/api/admin/community-reviews/" + user), Map.of("decision", "STOP", "reason", "반복된 도배"), writer).andExpect(status().isForbidden());
        perform(post("/api/admin/community-reviews/" + user), Map.of("decision", "STOP", "reason", "반복된 도배"), admin).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sanctions WHERE user_id = ? AND type = 'SUSPENSION' AND scope = 'POST' AND ends_at IS NULL", Integer.class, user)).isEqualTo(1);
        mvc.perform(get("/api/admin/community-reviews").header("Authorization", "Bearer " + admin)).andExpect(jsonPath("$[?(@.userId == " + user + ")]").isEmpty());
        perform(post("/api/admin/community-reviews/" + user), Map.of("decision", "STOP", "reason", "다시"), admin).andExpect(status().isConflict());
    }

    @Test
    void aPhotoIsReEncodedShownByItsKeyAndAttachedToThePost() throws Exception {
        String writer = token(member("GENERAL"));
        nickname(writer);
        BufferedImage image = new BufferedImage(40, 30, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(image, "png", png);
        String upload = mvc.perform(multipart("/api/photos").file(new MockMultipartFile("file", "a.png", "image/png", png.toByteArray())).header("Authorization", "Bearer " + writer))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        long photo = json.readTree(upload).get("id").asLong();
        String url = json.readTree(upload).get("url").asText();
        mvc.perform(multipart("/api/photos").file(new MockMultipartFile("file", "a.txt", "text/plain", "not a photo".getBytes())).header("Authorization", "Bearer " + writer))
                .andExpect(status().isBadRequest());
        long postId = json.readTree(perform(post("/api/community/posts"), Map.of("category", "FREE", "title", "사진 올려요", "body", "공원 풍경이에요 예뻐요", "photoIds", List.of(photo)), writer)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
        mvc.perform(get("/api/community/posts/" + postId).header("Authorization", "Bearer " + writer)).andExpect(jsonPath("$.photos.length()").value(1));
        byte[] shown = mvc.perform(get(url)).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
        assertThat(shown[0] & 0xff).isEqualTo(0xff); // JPEG now (re-encoded)
        mvc.perform(get("/api/photos/../../etc/passwd")).andExpect(status().is4xxClientError());
    }

    @Test
    void threeNoShowsLimitApplyingAndAnAcceptedAppealClearsOne() throws Exception {
        String organizer = token(member("GENERAL")), memberEmail = member("GENERAL"), member = token(memberEmail);
        long user = userId(memberEmail);
        long last = 0;
        for (int i = 0; i < 3; i++) {
            long activity = createActivity(body(3), organizer);
            last = apply(activity, member);
            perform(post("/api/participations/" + last + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
            jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ?, status = 'FINISHED' WHERE id = ?", now().minusHours(3), now().minusHours(1), activity);
            jdbc.update("UPDATE participations SET status = 'NO_SHOW' WHERE id = ?", last);
            penalties.afterNoShow(user, activity, "공원 정리");
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM sanctions WHERE user_id = ? AND scope = 'APPLY'", Integer.class, user)).isEqualTo(1);
        assertThat(penalties.status(user).get("apply")).isNotNull();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> penalties.check(user, "APPLY")).isInstanceOf(com.volink.common.ApiException.class);
        long next = createActivity(body(3), organizer);
        perform(post("/api/activities/" + next + "/participations"), Map.of(), member).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("RESTRICTED"));
        // The 불참 limit is about applying only: opening a 모집글 still works.
        createActivity(body(3), member);
        // The last no-show is appealed: the organizer turns it into attendance → it stops counting.
        perform(post("/api/appeals"), Map.of("kind", "NO_SHOW", "participationId", last, "reasonCode", "ATTENDED", "reason", "QR이 안 찍혀서 직접 말씀드렸어요"), member).andExpect(status().isOk());
        perform(post("/api/appeals"), Map.of("kind", "NO_SHOW", "participationId", last, "reasonCode", "ATTENDED", "reason", "한 번 더 보내요"), member).andExpect(status().isConflict());
        long appeal = jdbc.queryForObject("SELECT id FROM appeals WHERE participation_id = ?", Long.class, last);
        perform(post("/api/appeals/" + appeal + "/answer"), Map.of("decision", "KEEP", "note", ""), organizer).andExpect(status().isBadRequest());
        perform(post("/api/appeals/" + appeal + "/answer"), Map.of("decision", "ACCEPT"), organizer).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ACCEPTED"));
        assertThat(stateOf(last)).isEqualTo("COMPLETED");
        assertThat(penalties.noShows(user)).isEqualTo(2);
    }

    @Test
    void anOrganizerMayReviewTheirFinishedActivityOnce() throws Exception {
        String organizer = token(member("GENERAL")), joiner = token(member("GENERAL"));
        nickname(organizer);
        long activity = createActivity(body(3), organizer);
        long p = apply(activity, joiner);
        perform(post("/api/participations/" + p + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", now().plusMinutes(10), now().plusMinutes(70), activity);
        perform(post("/api/participations/" + p + "/manual-check-in"), Map.of("reason", "현장에서 얼굴로 확인함"), organizer).andExpect(status().isNoContent());
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ?, status = 'FINISHED' WHERE id = ?", now().minusMinutes(90), now().minusMinutes(30), activity);
        perform(post("/api/participations/" + p + "/complete"), Map.of(), organizer).andExpect(status().isNoContent());
        mvc.perform(get("/api/community/reviewable").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$[0].hosted").value(true));
        Map<String, Object> review = Map.of("category", "REVIEW", "title", "처음 모집해 봤어요", "body", "생각보다 많이 와 주셨어요 고마워요", "activityId", activity);
        perform(post("/api/community/posts"), review, organizer).andExpect(status().isCreated()).andExpect(jsonPath("$.reviewSource").value("HOST"));
        perform(post("/api/community/posts"), review, organizer).andExpect(status().isBadRequest());
    }
}
