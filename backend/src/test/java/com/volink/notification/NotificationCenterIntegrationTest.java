package com.volink.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.volink.ApiTestSupport;
import com.volink.checkin.CheckInService;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Notification center A (V16): typed events, filter chips, grouped applications, read state, dedupe, settings. */
class NotificationCenterIntegrationTest extends ApiTestSupport {
    @Autowired NotificationService notifications;
    @Autowired CheckInService checkIns;

    @Test
    void eventsArriveTypedWithTheirActivityAndRepeatedApplicationsGroup() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(activity("알림센터 플로깅", "함께 줍깅해요 — 장갑과 집게를 준비해 두었어요."), organizer);
        List<String> members = new ArrayList<>();
        List<Long> applications = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            String member = token(member("GENERAL"));
            members.add(member);
            applications.add(json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), member).andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString()).path("participation").path("id").asLong());
        }
        // Organizer: three new applications within 30 minutes → one row "새 참가 신청 3건" holding all three ids.
        JsonNode center = center(organizer, "APPLY");
        JsonNode first = center.path("items").get(0);
        assertThat(first.path("type").asText()).isEqualTo("APPLIED");
        assertThat(first.path("count").asInt()).isEqualTo(3);
        assertThat(first.path("ids").size()).isEqualTo(3);
        assertThat(first.path("title").asText()).isEqualTo("새 참가 신청 3건");
        assertThat(first.path("activityId").asLong()).isEqualTo(activity);
        assertThat(first.path("activityTitle").asText()).isEqualTo("알림센터 플로깅");
        assertThat(center.path("unread").path("APPLY").asInt()).isEqualTo(3);
        assertThat(center(organizer, "TALK").path("items").size()).isZero();

        // Approve → the member's APPROVED; a confirmed member cancels → the organizer's CANCELLED.
        perform(post("/api/participations/" + applications.get(0) + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        assertThat(center(members.get(0), "APPLY").path("items").get(0).path("type").asText()).isEqualTo("APPROVED");
        perform(post("/api/participations/" + applications.get(0) + "/cancel"), Map.of("reason", "몸이 좋지 않아요"), members.get(0)).andExpect(status().isOk());
        assertThat(center(organizer, "APPLY").path("items").get(0).path("type").asText()).isEqualTo("CANCELLED");

        // Reading the grouped row reads every notification in it; someone else's ids are not touched.
        List<Long> ids = new ArrayList<>();
        first.path("ids").forEach(id -> ids.add(id.asLong()));
        long otherId = jdbc.queryForObject("SELECT MAX(id) FROM notifications WHERE user_id = ?", Long.class, organizerId(members.get(0)));
        List<Long> withOther = new ArrayList<>(ids);
        withOther.add(otherId);
        perform(post("/api/notifications/read"), Map.of("ids", withOther), organizer).andExpect(status().isOk()).andExpect(jsonPath("$.read").value(3));
        assertThat(center(organizer, "APPLY").path("items").get(1).path("read").asBoolean()).isTrue();
        perform(post("/api/notifications/read-all"), Map.of(), organizer).andExpect(status().isNoContent());
        assertThat(center(organizer, null).path("unread").path("ALL").asInt()).isZero();
        perform(get("/api/me/notification-center").param("category", "SECRET"), null, organizer).andExpect(status().isBadRequest());
    }

    @Test
    void noticesAnswersManualCheckInAndRecordsReachTheRightPeople() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(activity("소식 알림 활동", "공지와 질문 — 장갑과 집게를 준비해 두었어요."), organizer);
        String member = token(member("GENERAL"));
        long pid = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), member).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("participation").path("id").asLong();
        perform(post("/api/participations/" + pid + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());

        perform(post("/api/activities/" + activity + "/notices"), Map.of("body", "장갑을 챙겨 주세요"), organizer).andExpect(status().isCreated());
        assertThat(center(member, "TALK").path("items").get(0).path("type").asText()).isEqualTo("NOTICE");
        long question = json.readTree(perform(post("/api/activities/" + activity + "/questions"), Map.of("body", "주차 되나요?"), member)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).path("id").asLong();
        assertThat(center(organizer, "TALK").path("items").get(0).path("type").asText()).isEqualTo("QUESTION");
        perform(post("/api/activity-posts/" + question + "/answer"), Map.of("body", "네 가능해요"), organizer).andExpect(status().isCreated());
        assertThat(center(member, "TALK").path("items").get(0).path("type").asText()).isEqualTo("ANSWER");

        // Manual check-in by the organizer → the member is told; completion → record + review invitation (once each).
        LocalDateTime start = LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusMinutes(10).withSecond(0).withNano(0);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", start, start.plusMinutes(60), activity);
        perform(post("/api/participations/" + pid + "/manual-check-in"), Map.of("reason", "휴대폰을 두고 왔어요"), organizer).andExpect(status().isNoContent());
        assertThat(center(member, "ACTIVITY").path("items").get(0).path("type").asText()).isEqualTo("CHECKED_IN");
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", start.minusHours(2), start.minusHours(1), activity);
        perform(post("/api/activities/" + activity + "/complete"), Map.of(), organizer).andExpect(status().isOk());
        List<String> types = new ArrayList<>();
        center(member, "ACTIVITY").path("items").forEach(item -> types.add(item.path("type").asText()));
        assertThat(types).contains("RECORD_CONFIRMED", "REVIEW_INVITE");
        long user = organizerId(member);
        notifications.send(user, "REVIEW_INVITE", "활동 후기를 남겨 보세요", "다시", "#/activity/" + activity, (long) activity, "REVIEW:" + pid);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'REVIEW_INVITE'", Integer.class, user)).isEqualTo(1);
    }

    @Test
    void handledApplicationsAndQuestionsShowWhatBecameOfThemAndCountAsRead() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(activity("처리 표시 활동", "처리하면 알림이 바뀌어요 — 장갑과 집게를 준비해 두었어요."), organizer);
        String a = token(member("GENERAL")), b = token(member("GENERAL"));
        long pa = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), a).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("participation").path("id").asLong();
        long pb = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), b).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("participation").path("id").asLong();
        // Old-style row (before V25, no reference): settled once nothing waits on the activity.
        notifications.send(organizerId(organizer), "PENDING_REMINDER", "승인을 기다리는 신청이 2건 있어요", "처리 표시 활동", "#/manage/" + activity);
        JsonNode group = center(organizer, "APPLY").path("items");
        assertThat(group.get(0).path("done").isNull()).isTrue();

        perform(post("/api/participations/" + pa + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        JsonNode rows = center(organizer, "APPLY");
        // One of two handled: the grouped row still waits; the reminder too.
        assertThat(rows.path("items").get(1).path("done").isNull()).isTrue();
        assertThat(rows.path("items").get(0).path("done").isNull()).isTrue();
        assertThat(rows.path("unread").path("APPLY").asInt()).isEqualTo(2);

        perform(post("/api/participations/" + pb + "/reject"), Map.of("reason", "정원 조정"), organizer).andExpect(status().isNoContent());
        rows = center(organizer, "APPLY");
        assertThat(rows.path("items").get(0).path("done").asText()).isEqualTo("처리 완료");
        assertThat(rows.path("items").get(1).path("done").asText()).isEqualTo("처리 완료"); // 승인 완료 + 거절함
        assertThat(rows.path("items").get(1).path("read").asBoolean()).isTrue();
        assertThat(rows.path("unread").path("APPLY").asInt()).isZero();
        assertThat(jdbc.queryForList("SELECT done_label FROM notifications WHERE ref_id IN (?, ?) AND type = 'APPLIED' ORDER BY ref_id", String.class, pa, pb))
                .containsExactly("승인 완료", "거절함");

        long question = json.readTree(perform(post("/api/activities/" + activity + "/questions"), Map.of("body", "물은 있나요?"), a)
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).path("id").asLong();
        assertThat(center(organizer, "TALK").path("items").get(0).path("done").isNull()).isTrue();
        perform(post("/api/activity-posts/" + question + "/answer"), Map.of("body", "네 준비해 둘게요"), organizer).andExpect(status().isCreated());
        JsonNode talk = center(organizer, "TALK");
        assertThat(talk.path("items").get(0).path("done").asText()).isEqualTo("답변 완료");
        assertThat(talk.path("unread").path("TALK").asInt()).isZero();
    }

    @Test
    void aDeletedActivityIsMarkedAndOldStyleSendsGetTheirActivityFromTheLink() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(activity("지워질 활동", "곧 지워요 — 장갑과 집게를 준비해 두었어요."), organizer);
        long user = organizerId(organizer);
        notifications.send(user, "DAY_BEFORE", "내일 함께해요", "지워질 활동 · 10:00", "#/activity/" + activity);
        assertThat(center(organizer, "ACTIVITY").path("items").get(0).path("activityGone").asBoolean()).isFalse();
        jdbc.update("UPDATE activities SET status = 'DELETED' WHERE id = ?", activity);
        JsonNode item = center(organizer, "ACTIVITY").path("items").get(0);
        assertThat(item.path("activityId").asLong()).isEqualTo(activity);
        assertThat(item.path("activityGone").asBoolean()).isTrue();
    }

    @Test
    void pagesAreNewestFirstAndFollowTheCursor() throws Exception {
        String member = token(member("GENERAL"));
        long user = organizerId(member);
        for (int i = 0; i < 5; i++) notifications.send(user, "COMMUNITY_COMMENT", "댓글 " + i, "본문", "#/post/1");
        JsonNode page = json.readTree(perform(get("/api/me/notification-center").param("size", "3"), null, member).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        assertThat(page.path("items").get(0).path("title").asText()).isEqualTo("댓글 4");
        assertThat(page.path("items").size()).isEqualTo(3);
        JsonNode rest = json.readTree(perform(get("/api/me/notification-center").param("size", "3").param("before", page.path("next").asText()), null, member)
                .andReturn().getResponse().getContentAsString());
        assertThat(rest.path("items").size()).isEqualTo(2);
        assertThat(rest.path("items").get(1).path("title").asText()).isEqualTo("댓글 0");
        assertThat(rest.path("next").isNull()).isTrue();
    }

    @Test
    void pushSettingsDefaultOnAndSaveWithChosenQuietHours() throws Exception {
        String member = token(member("GENERAL"));
        long user = organizerId(member);
        perform(get("/api/me/notification-settings"), null, member).andExpect(jsonPath("$.push").value(true)).andExpect(jsonPath("$.apply").value(true))
                .andExpect(jsonPath("$.quiet").value(true)).andExpect(jsonPath("$.quietStart").value("22:00")).andExpect(jsonPath("$.quietEnd").value("08:00"));
        // Default quiet hours cross midnight.
        assertThat(notifications.pushAllowed(user, "APPLY", java.time.LocalTime.of(23, 30))).isFalse();
        assertThat(notifications.pushAllowed(user, "APPLY", java.time.LocalTime.of(7, 59))).isFalse();
        assertThat(notifications.pushAllowed(user, "APPLY", java.time.LocalTime.of(8, 0))).isTrue();
        // Own quiet hours inside a day, one kind off.
        perform(put("/api/me/notification-settings"), Map.of("talk", false, "quietStart", "13:00", "quietEnd", "14:30"), member).andExpect(status().isOk())
                .andExpect(jsonPath("$.quietStart").value("13:00"));
        assertThat(notifications.pushAllowed(user, "APPLY", java.time.LocalTime.of(13, 15))).isFalse();
        assertThat(notifications.pushAllowed(user, "APPLY", java.time.LocalTime.of(23, 30))).isTrue();
        assertThat(notifications.pushAllowed(user, "TALK", java.time.LocalTime.of(10, 0))).isFalse();
        // Night allowed (onboarding "밤에도 받기"), then everything off.
        perform(put("/api/me/notification-settings"), Map.of("quiet", false), member).andExpect(status().isOk());
        assertThat(notifications.pushAllowed(user, "APPLY", java.time.LocalTime.of(13, 15))).isTrue();
        perform(put("/api/me/notification-settings"), Map.of("push", false), member).andExpect(jsonPath("$.push").value(false));
        assertThat(notifications.pushAllowed(user, "APPLY", java.time.LocalTime.of(10, 0))).isFalse();
        perform(put("/api/me/notification-settings"), Map.of("quietStart", "25:00"), member).andExpect(status().isBadRequest());
        perform(put("/api/me/notification-settings"), Map.of("quietStart", "09:00", "quietEnd", "09:00"), member).andExpect(status().isBadRequest());
    }

    @Test
    void signupNoLongerNeedsInterests() throws Exception {
        Map<String, Object> body = signupBody(email(), "GENERAL", TODAY.minusYears(20));
        body.put("interests", List.of());
        perform(post("/api/auth/signup"), body, null).andExpect(status().isCreated()).andExpect(jsonPath("$.interests.length()").value(0));
    }

    @Test
    void confirmedPeopleHearOnTheMorningOfTheDayOnce() throws Exception {
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Seoul"));
        Assumptions.assumeTrue(now.getHour() >= 7 && now.isBefore(now.toLocalDate().atTime(22, 0)), "needs a Korean daytime clock");
        String organizer = token(member("GENERAL"));
        long activity = createActivity(activity("오늘 아침 알림", "당일 안내 — 장갑과 집게를 준비해 두었어요."), organizer);
        String member = token(member("GENERAL"));
        long pid = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), member).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).path("participation").path("id").asLong();
        perform(post("/api/participations/" + pid + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        LocalDateTime start = now.plusHours(1).withSecond(0).withNano(0);
        Assumptions.assumeTrue(start.toLocalDate().equals(now.toLocalDate()));
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", start, start.plusMinutes(60), activity);
        checkIns.advance();
        checkIns.advance();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE type = 'DAY_OF' AND activity_id = ?", Integer.class, activity)).isEqualTo(1);
    }

    private JsonNode center(String token, String category) throws Exception {
        var request = get("/api/me/notification-center");
        if (category != null) request.param("category", category);
        return json.readTree(perform(request, null, token).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private long organizerId(String token) throws Exception {
        return json.readTree(perform(get("/api/me"), null, token).andReturn().getResponse().getContentAsString()).path("id").asLong();
    }
}
