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

    // ---- helpers ----

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
