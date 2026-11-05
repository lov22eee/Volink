package com.volink.activity;

import com.volink.ApiTestSupport;
import com.volink.checkin.CheckInService;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Week 6 additions (V9): activity labels, organizer cancel and one reschedule, "늦어요/못 가요", the day-before reminder. */
class ActivityCareIntegrationTest extends ApiTestSupport {
    @Autowired CheckInService checkIns;

    String organizer, member, waiting;
    long activity, participation, waitParticipation;

    @BeforeEach
    void confirmedAndWaiting() throws Exception {
        organizer = token(member("GENERAL"));
        Map<String, Object> body = activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다.");
        body.put("difficulty", "NORMAL");
        body.put("placeKind", "MIXED");
        body.put("newcomerOk", false);
        body.put("capacity", 1);
        activity = createActivity(body, organizer);
        member = token(member("GENERAL"));
        participation = apply(member);
        perform(post("/api/participations/" + participation + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        waiting = token(member("GENERAL"));
        waitParticipation = apply(waiting);
    }

    @Test
    void labelsAreSavedAndValidated() throws Exception {
        mvc.perform(get("/api/activities/" + activity)).andExpect(jsonPath("$.difficulty").value("NORMAL"))
                .andExpect(jsonPath("$.placeKind").value("MIXED")).andExpect(jsonPath("$.newcomerOk").value(false));
        Map<String, Object> wrong = activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다.");
        wrong.put("difficulty", "EXTREME");
        perform(post("/api/activities"), wrong, organizer).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("difficulty"));
        // Without the new fields the defaults apply (older clients keep working).
        long plain = createActivity(activity("동네 화단 물주기 함께하기", "동네 화단에 물을 주고 잡초를 뽑는 가벼운 활동입니다."), organizer);
        mvc.perform(get("/api/activities/" + plain)).andExpect(jsonPath("$.difficulty").value("EASY"))
                .andExpect(jsonPath("$.placeKind").value("OUTDOOR")).andExpect(jsonPath("$.newcomerOk").value(true));
    }

    @Test
    void organizerCancelsWithAReasonAndEveryoneIsTold() throws Exception {
        perform(post("/api/activities/" + activity + "/cancel"), Map.of("reason", " "), organizer).andExpect(status().isBadRequest());
        perform(post("/api/activities/" + activity + "/cancel"), Map.of("reason", "비 예보"), member).andExpect(status().isNotFound());
        perform(post("/api/activities/" + activity + "/cancel"), Map.of("reason", "내일 비 예보가 있어 취소합니다"), organizer)
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED")).andExpect(jsonPath("$.cancelReason").value("내일 비 예보가 있어 취소합니다"));
        assertThat(jdbc.queryForList("SELECT status FROM participations WHERE activity_id = ?", String.class, activity)).containsOnly("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT cancel_count FROM participations WHERE id = ?", Integer.class, participation)).isZero();
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + member))
                .andExpect(jsonPath("$.items[0].title").value("봉사활동이 취소되었어요")).andExpect(jsonPath("$.items[0].body").value(containsString("기타 사유")));
        // People who applied still see it with the reason; others get 404 and it leaves the public list.
        mvc.perform(get("/api/activities/" + activity).header("Authorization", "Bearer " + member)).andExpect(status().isOk()).andExpect(jsonPath("$.cancelReason").exists());
        mvc.perform(get("/api/activities/" + activity)).andExpect(status().isNotFound());
        mvc.perform(get("/api/me/participations").header("Authorization", "Bearer " + member)).andExpect(jsonPath("$[0].activityStatus").value("CANCELLED"));
        perform(post("/api/activities/" + activity + "/cancel"), Map.of("reason", "다시 취소"), organizer).andExpect(status().isConflict());
    }

    @Test
    void rescheduleOnceKeepsConfirmedPeopleAndTellsThem() throws Exception {
        String date = TODAY.plusDays(9).toString();
        perform(post("/api/activities/" + activity + "/reschedule"), move(date, "21:30", 60), organizer).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("time"));
        perform(post("/api/activities/" + activity + "/reschedule"), move(date, "14:00", 60), member).andExpect(status().isNotFound());
        perform(post("/api/activities/" + activity + "/reschedule"), move(date, "14:00", 60), organizer).andExpect(status().isOk())
                .andExpect(jsonPath("$.date").value(date)).andExpect(jsonPath("$.startTime").value("14:00")).andExpect(jsonPath("$.durationMinutes").value(60))
                .andExpect(jsonPath("$.rescheduleCount").value(1));
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, participation)).isEqualTo("CONFIRMED");
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + member))
                .andExpect(jsonPath("$.items[0].title").value("활동 일정이 바뀌었어요")).andExpect(jsonPath("$.items[0].body").value(containsString("참가 확정은 그대로")));
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + waiting)).andExpect(jsonPath("$.items[0].title").value("활동 일정이 바뀌었어요"));
        perform(post("/api/activities/" + activity + "/reschedule"), move(TODAY.plusDays(10).toString(), "10:00", 60), organizer)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RESCHEDULE_USED"));
    }

    @Test
    void noRescheduleWithin24HoursOfTheStart() throws Exception {
        startsIn(60 * 20);
        perform(post("/api/activities/" + activity + "/reschedule"), move(TODAY.plusDays(9).toString(), "10:00", 60), organizer)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RESCHEDULE_TOO_LATE"));
    }

    @Test
    void lateNoticeGoesToTheOrganizerAndCantComeFreesTheSeat() throws Exception {
        perform(post("/api/participations/" + participation + "/late"), Map.of("minutes", 10), member).andExpect(status().isConflict());
        startsIn(60);
        perform(post("/api/participations/" + participation + "/late"), Map.of("minutes", 15), member).andExpect(status().isBadRequest());
        perform(post("/api/participations/" + waitParticipation + "/late"), Map.of("minutes", 10), waiting).andExpect(status().isConflict());
        perform(post("/api/participations/" + participation + "/late"), Map.of("minutes", 20), member).andExpect(status().isOk())
                .andExpect(jsonPath("$.participation.lateMinutes").value(20));
        mvc.perform(get("/api/activities/" + activity + "/participations").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$.items[?(@.status == 'CONFIRMED')].lateMinutes").value(20));
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.items[0].title").value(containsString("20분 늦어요")));

        // 못 가요: a cancellation with a word for the organizer. Within 2 hours of the start no seat is offered any more.
        perform(post("/api/participations/" + participation + "/cancel"), Map.of("reason", "갑자기 일이 생겼어요"), member).andExpect(status().isOk());
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.items[0].body").value(containsString("갑자기 일이 생겼어요")));
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, waitParticipation)).isEqualTo("WAITLISTED");
    }

    @Test
    void cantComeTheDayBeforeOffersTheSeatToTheWaitlist() throws Exception {
        perform(post("/api/participations/" + participation + "/cancel"), null, member).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, waitParticipation)).isEqualTo("OFFERED");
    }

    @Test
    void dayBeforeReminderGoesOnceAndAgainAfterAReschedule() throws Exception {
        startsIn(60 * 20);
        checkIns.advance();
        checkIns.advance();
        assertThat(reminders()).isEqualTo(1);
        // Pretend a reschedule happened: the reminder is sent again for the new time.
        jdbc.update("INSERT INTO activity_logs(activity_id, actor_id, from_status, to_status, reason) SELECT id, organizer_id, 'RECRUITING', 'RESCHEDULED', 'test' FROM activities WHERE id = ?", activity);
        checkIns.advance();
        assertThat(reminders()).isEqualTo(2);
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + member)).andExpect(jsonPath("$.items[0].title").value("내일 함께해요"));
    }

    @Test
    void organizerListCountsWhatNeedsAnAnswer() throws Exception {
        mvc.perform(get("/api/me/activities").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$[0].pending").value(0)).andExpect(jsonPath("$[0].unanswered").value(0)).andExpect(jsonPath("$[0].checkedIn").value(0));
    }

    @Test
    void savedActivitiesAreOnlyMine() throws Exception {
        perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/me/saved/" + activity), null, member).andExpect(status().isNoContent());
        perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/me/saved/" + activity), null, member).andExpect(status().isNoContent());
        perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/me/saved/999999"), null, member).andExpect(status().isNotFound());
        mvc.perform(get("/api/me/saved").header("Authorization", "Bearer " + member)).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].id").value(activity));
        mvc.perform(get("/api/me/saved").header("Authorization", "Bearer " + waiting)).andExpect(jsonPath("$.length()").value(0));
        perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/me/saved/" + activity), null, member).andExpect(status().isNoContent());
        mvc.perform(get("/api/me/saved").header("Authorization", "Bearer " + member)).andExpect(jsonPath("$.length()").value(0));
    }

    // ---- helpers ----

    private long apply(String token) throws Exception {
        return json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), token)
                .andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
    }

    private static Map<String, Object> move(String date, String time, int minutes) {
        Map<String, Object> body = new HashMap<>(Map.of("date", date, "time", time, "durationMinutes", minutes));
        body.put("reason", "장소 사정으로 시간을 옮겨요");
        return body;
    }

    private int reminders() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.title = '내일 함께해요' AND n.link_path = ?", Integer.class, "#/activity/" + activity);
    }

    private void startsIn(int minutes) {
        LocalDateTime start = LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusMinutes(minutes);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", start, start.plusMinutes(60), activity);
    }
}
