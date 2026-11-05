package com.volink.checkin;

import com.volink.ApiTestSupport;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.ResultActions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Week 6: QR + time + location check-in, manual check-in, completion records and no-shows (docs/test-cases.md C-01..C-05). */
class CheckInIntegrationTest extends ApiTestSupport {
    static final double LAT = 35.1, LNG = 129.0;
    static final double DEG_PER_KM = 1 / 111.19490;

    @Autowired QrService qr;
    @Autowired CheckInService checkIns;

    String organizer, member;
    long activity, participation;

    /** Place 1 at a known spot, an activity there, one confirmed member. */
    @BeforeEach
    void confirmedMember() throws Exception {
        perform(put("/api/admin/places/1"), Map.of("latitude", LAT, "longitude", LNG), token(admin())).andExpect(status().isOk());
        organizer = token(member("GENERAL"));
        activity = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        member = token(member("GENERAL"));
        participation = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), member)
                .andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
        perform(post("/api/participations/" + participation + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
    }

    @Test
    void fullFlowFromQrCheckInToACompletionRecord() throws Exception {
        startsIn(10);
        String qrToken = json.readTree(mvc.perform(get("/api/activities/" + activity + "/qr").header("Authorization", "Bearer " + organizer))
                .andExpect(status().isOk()).andExpect(jsonPath("$.open").value(true)).andExpect(jsonPath("$.validSeconds").value(60))
                .andReturn().getResponse().getContentAsString()).get("token").asText();
        mvc.perform(get("/api/activities/" + activity + "/qr").header("Authorization", "Bearer " + member)).andExpect(status().isNotFound());
        checkIn(member, qrToken, LAT + 0.1 * DEG_PER_KM, LNG).andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("CHECKED_IN"));
        checkIn(member, qrToken, LAT, LNG).andExpect(status().isConflict());
        mvc.perform(get("/api/activities/" + activity + "/participations").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$.items[0].status").value("CHECKED_IN")).andExpect(jsonPath("$.items[0].checkInMethod").value("QR"));
        // C-04: not before the end.
        perform(post("/api/participations/" + participation + "/complete"), Map.of(), organizer).andExpect(status().isConflict());

        ended();
        perform(post("/api/participations/" + participation + "/complete"), Map.of(), member).andExpect(status().isNotFound());
        perform(post("/api/participations/" + participation + "/complete"), Map.of(), organizer).andExpect(status().isNoContent());
        mvc.perform(get("/api/me/records").header("Authorization", "Bearer " + member)).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].activityId").value(activity)).andExpect(jsonPath("$[0].status").value("VALID"))
                .andExpect(jsonPath("$[0].checkInMethod").value("QR")).andExpect(jsonPath("$[0].appealDeadline").exists());
        Map<String, Object> record = jdbc.queryForMap("SELECT confirmed_at FROM activity_records r JOIN participations p ON p.id = r.participation_id WHERE p.id = ?", participation);
        assertThat((LocalDateTime) record.get("confirmed_at")).isAfter(now().minusMinutes(2));
        assertThat(jdbc.queryForList("SELECT to_status FROM activity_logs WHERE participation_id = ? ORDER BY id", String.class, participation))
                .containsExactly("APPLIED", "CONFIRMED", "CHECKED_IN", "COMPLETED");
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + member)).andExpect(jsonPath("$.items[0].type").value("RECORD_CONFIRMED"));
        // The coordinates sent at check-in are not stored anywhere: only inside/outside.
        assertThat(jdbc.queryForObject("SELECT within_radius FROM check_ins WHERE participation_id = ?", Boolean.class, participation)).isTrue();
    }

    @Test
    void checkInOutsideTheTimeWindowIsRefused() throws Exception {
        startsIn(120);
        mvc.perform(get("/api/activities/" + activity + "/qr").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$.open").value(false)).andExpect(jsonPath("$.token").doesNotExist());
        checkIn(member, qr.issue(activity), LAT, LNG).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("CHECKIN_OUT_OF_TIME"));
    }

    @Test
    void expiredForgedOrOtherActivityQrIsRefused() throws Exception {
        startsIn(10);
        checkIn(member, qr.token(activity, Instant.now().minusSeconds(61)), LAT, LNG).andExpect(status().isGone()).andExpect(jsonPath("$.code").value("QR_EXPIRED"));
        checkIn(member, activity + "." + Instant.now().getEpochSecond() + ".forged", LAT, LNG).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("QR_INVALID"));
        checkIn(member, qr.issue(activity + 1000), LAT, LNG).andExpect(status().isBadRequest());
        checkIn(token(member("GENERAL")), qr.issue(activity), LAT, LNG).andExpect(status().isForbidden());
        checkIn(member, qr.token(activity, Instant.now().minusSeconds(50)), LAT, LNG).andExpect(status().isCreated());
    }

    @Test
    void outsideTheRadiusNeedsAManualCheckInWithAReason() throws Exception {
        startsIn(10);
        checkIn(member, qr.issue(activity), LAT + 0.3 * DEG_PER_KM, LNG).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("CHECKIN_OUT_OF_RANGE")).andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("200m")));
        checkIn(member, qr.issue(activity), null, null).andExpect(status().isUnprocessableEntity());
        perform(post("/api/participations/" + participation + "/manual-check-in"), Map.of("reason", " "), organizer).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("reason"));
        perform(post("/api/participations/" + participation + "/manual-check-in"), Map.of("reason", "위치 권한 거부, 현장에서 얼굴 확인"), member).andExpect(status().isNotFound());
        perform(post("/api/participations/" + participation + "/manual-check-in"), Map.of("reason", "위치 권한 거부, 현장에서 얼굴 확인"), organizer).andExpect(status().isNoContent());
        Map<String, Object> row = jdbc.queryForMap("SELECT method, within_radius, reason FROM check_ins WHERE participation_id = ?", participation);
        assertThat(row.get("method")).isEqualTo("MANUAL");
        assertThat(row.get("within_radius")).isNull();
        assertThat(row.get("reason")).isEqualTo("위치 권한 거부, 현장에서 얼굴 확인");
    }

    @Test
    void schedulerStartsAndFinishesActivitiesAndMarksNoShows() throws Exception {
        String late = token(member("GENERAL"));
        long pending = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), late)
                .andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
        startsIn(-1);
        checkIns.advance();
        assertThat(jdbc.queryForObject("SELECT status FROM activities WHERE id = ?", String.class, activity)).isEqualTo("IN_PROGRESS");
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, pending)).isEqualTo("EXPIRED");
        // C-04: completion without a check-in is refused.
        ended();
        perform(post("/api/participations/" + participation + "/complete"), Map.of(), organizer).andExpect(status().isConflict());
        checkIns.advance();
        assertThat(jdbc.queryForObject("SELECT status FROM activities WHERE id = ?", String.class, activity)).isEqualTo("FINISHED");
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, participation)).isEqualTo("NO_SHOW");
        mvc.perform(get("/api/activities/" + activity)).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("FINISHED"));
    }

    @Test
    void theQrRotatesEvery30SecondsAndTheOrganizerSeesAttendance() throws Exception {
        startsIn(10);
        mvc.perform(get("/api/activities/" + activity + "/qr").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$.rotateSeconds").value(30)).andExpect(jsonPath("$.expected").value(1)).andExpect(jsonPath("$.checkedIn").value(0));
        checkIn(member, qr.issue(activity), LAT, LNG).andExpect(status().isCreated()).andExpect(jsonPath("$.checkedInAt").exists());
        mvc.perform(get("/api/activities/" + activity + "/qr").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.checkedIn").value(1));
    }

    @Test
    void reportedGpsErrorIsForgivenUpTo50MetresOnly() throws Exception {
        startsIn(10);
        // 230 m away with a 40 m reading error: inside 200 + 40.
        checkIn(member, qr.issue(activity), LAT + 0.23 * DEG_PER_KM, LNG, 40.0).andExpect(status().isCreated());
        String other = joinConfirmed();
        // 300 m away claiming 500 m error: the slack stops at 50 m, and the message says how far.
        checkIn(other, qr.issue(activity), LAT + 0.3 * DEG_PER_KM, LNG, 500.0).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("약 300m")));
    }

    @Test
    void organizerCompletesEveryoneWhoCheckedInAtOnce() throws Exception {
        joinConfirmed();
        startsIn(10);
        checkIn(member, qr.issue(activity), LAT, LNG).andExpect(status().isCreated());
        perform(post("/api/activities/" + activity + "/complete"), Map.of(), organizer).andExpect(status().isConflict());
        ended();
        perform(post("/api/activities/" + activity + "/complete"), Map.of(), member).andExpect(status().isNotFound());
        perform(post("/api/activities/" + activity + "/complete"), Map.of(), organizer).andExpect(status().isOk()).andExpect(jsonPath("$.completed").value(1));
        assertThat(jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, participation)).isEqualTo("COMPLETED");
        // The one who never checked in is not completed (the scheduler marks them NO_SHOW).
        assertThat(jdbc.queryForObject("SELECT p.status FROM participations p JOIN users u ON u.id = p.user_id WHERE p.activity_id = ? AND p.id <> ?", String.class, activity, participation))
                .isEqualTo("CONFIRMED");
    }

    @Test
    void aCheckedInPersonStillHoldsTheirSeatSoNobodyElseGetsIt() throws Exception {
        // Capacity 1: the member checks in; a later applicant must find the activity full, not a free seat.
        jdbc.update("UPDATE activities SET capacity = 1 WHERE id = ?", activity);
        startsIn(10);
        checkIn(member, qr.issue(activity), LAT, LNG).andExpect(status().isCreated());
        // Full, and the waitlist closed 2 h before the start, so the application is refused instead of becoming APPLIED.
        perform(post("/api/activities/" + activity + "/participations"), Map.of(), token(member("GENERAL")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("WAITLIST_CLOSED"));
    }

    @Test
    void remindersGoOutOnceAndPeopleLeftWaitingAreTold() throws Exception {
        String late = token(member("GENERAL"));
        perform(post("/api/activities/" + activity + "/participations"), Map.of(), late).andExpect(status().isCreated());
        long organizerId = jdbc.queryForObject("SELECT organizer_id FROM activities WHERE id = ?", Long.class, activity);
        startsIn(20 * 60);
        checkIns.advance();
        checkIns.advance();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND title LIKE '승인을 기다리는 신청이 1건%'", Integer.class, organizerId)).isEqualTo(1);
        startsIn(20);
        checkIns.advance();
        checkIns.advance();
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + member)).andExpect(jsonPath("$.items[0].title").value("체크인이 열렸어요"));
        // Count only this activity's reminders: other tests leave activities in the window too.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE title = '체크인이 열렸어요' AND link_path = ?", Integer.class, "#/activity/" + activity)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND title = '출석 QR을 띄울 시간이에요'", Integer.class, organizerId)).isEqualTo(1);
        startsIn(-1);
        checkIns.advance();
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + late)).andExpect(jsonPath("$.items[0].title").value("승인 전에 활동이 시작됐어요"));
    }

    @Test
    void theFourDigitCodeChecksInLikeTheQrAndWrongGuessesAreLimited() throws Exception {
        startsIn(10);
        String code = json.readTree(mvc.perform(get("/api/activities/" + activity + "/qr").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$.code").isString()).andExpect(jsonPath("$.codeSecondsLeft").isNumber()).andReturn().getResponse().getContentAsString()).get("code").asText();
        String wrong = code.equals("0000") ? "1111" : "0000";
        // Location is still checked with a code.
        byCode(member, code, LAT + 0.3 * DEG_PER_KM, LNG).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("CHECKIN_OUT_OF_RANGE"));
        for (int i = 0; i < CheckInService.CODE_TRIES; i++) byCode(member, wrong, LAT, LNG).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CODE_INVALID"));
        byCode(member, code, LAT, LNG).andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.code").value("CODE_LOCKED"));
        String other = joinConfirmed();
        byCode(other, code, LAT, LNG).andExpect(status().isCreated()).andExpect(jsonPath("$.method").value("CODE"));
    }

    @Test
    void severalPeopleCanBeCheckedInByHandWithOneReason() throws Exception {
        startsIn(10);
        String other = joinConfirmed();
        long second = jdbc.queryForObject("SELECT p.id FROM participations p WHERE p.activity_id = ? AND p.id <> ? AND p.status = 'CONFIRMED'", Long.class, activity, participation);
        perform(post("/api/activities/" + activity + "/manual-check-ins"), Map.of("participationIds", java.util.List.of(participation, second), "reason", " "), organizer).andExpect(status().isBadRequest());
        perform(post("/api/activities/" + activity + "/manual-check-ins"), Map.of("participationIds", java.util.List.of(participation, second), "reason", "휴대폰 없음"), member).andExpect(status().isNotFound());
        perform(post("/api/activities/" + activity + "/manual-check-ins"), Map.of("participationIds", java.util.List.of(participation, second), "reason", "휴대폰 없음"), organizer)
                .andExpect(status().isOk()).andExpect(jsonPath("$.checkedIn").value(2));
        assertThat(jdbc.queryForList("SELECT method FROM check_ins c JOIN participations p ON p.id = c.participation_id WHERE p.activity_id = ?", String.class, activity)).containsOnly("MANUAL").hasSize(2);
        assertThat(other).isNotBlank();
    }

    private ResultActions byCode(String token, String code, Double lat, Double lng) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("code", code);
        body.put("lat", lat);
        body.put("lng", lng);
        return perform(post("/api/activities/" + activity + "/check-ins"), body, token);
    }

    // ---- helpers ----

    /** A second confirmed member; returns their token. */
    private String joinConfirmed() throws Exception {
        String other = token(member("GENERAL"));
        long id = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), other)
                .andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
        perform(post("/api/participations/" + id + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        return other;
    }

    private ResultActions checkIn(String token, String qrToken, Double lat, Double lng, Double accuracy) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("qrToken", qrToken);
        body.put("lat", lat);
        body.put("lng", lng);
        body.put("accuracy", accuracy);
        return perform(post("/api/activities/" + activity + "/check-ins"), body, token);
    }

    private ResultActions checkIn(String token, String qrToken, Double lat, Double lng) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("qrToken", qrToken);
        body.put("lat", lat);
        body.put("lng", lng);
        return perform(post("/api/activities/" + activity + "/check-ins"), body, token);
    }

    private void startsIn(int minutes) {
        LocalDateTime start = now().plusMinutes(minutes);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", start, start.plusMinutes(60), activity);
    }

    private void ended() {
        LocalDateTime start = now().minusMinutes(90);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", start, start.plusMinutes(60), activity);
    }

    private static LocalDateTime now() {
        return LocalDateTime.now(ZoneId.of("Asia/Seoul"));
    }
}
