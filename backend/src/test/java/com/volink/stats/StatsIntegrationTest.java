package com.volink.stats;

import com.fasterxml.jackson.databind.JsonNode;
import com.volink.ApiTestSupport;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Home banner numbers: nearby recruiting count, monthly distinct participants from real records, no personal data. */
class StatsIntegrationTest extends ApiTestSupport {
    @Autowired StatsService stats;

    private JsonNode home(String token, String query) throws Exception {
        return json.readTree(perform(get("/api/stats/home" + query), null, token).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    /** One completed participation with a record (status VALID or HELD) confirmed at {@code at}. */
    private void record(long activity, long user, long organizer, LocalDateTime at, String status) {
        jdbc.update("INSERT INTO participations(activity_id, user_id, status, updated_at) VALUES (?, ?, 'COMPLETED', ?)", activity, user, at);
        long p = jdbc.queryForObject("SELECT id FROM participations WHERE activity_id = ? AND user_id = ?", Long.class, activity, user);
        jdbc.update("INSERT INTO check_ins(participation_id, method, within_radius, reason, checked_by, checked_at) VALUES (?, 'MANUAL', NULL, '테스트', ?, ?)", p, organizer, at);
        long c = jdbc.queryForObject("SELECT id FROM check_ins WHERE participation_id = ?", Long.class, p);
        jdbc.update("INSERT INTO activity_records(participation_id, check_in_id, confirmed_by, confirmed_at, status) VALUES (?, ?, ?, ?, ?)", p, c, organizer, at, status);
    }

    private long id(String email) { return jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email); }

    @Test
    void nearbyCountsRecruitingActivitiesAndMonthlyCountsEachPersonOncePerMonth() throws Exception {
        String hostEmail = member("GENERAL");
        String host = token(hostEmail);
        // Place 3 gets a position here (test database places have none until an admin enters them).
        perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/api/admin/places/3"), java.util.Map.of("latitude", 37.8156, "longitude", 127.0937), token(admin()))
                .andExpect(status().isOk());
        JsonNode before = home(host, "?lat=37.8156&lng=127.0937&radiusKm=5");
        java.util.HashMap<String, Object> near = new java.util.HashMap<>(activity("통계 확인 활동", "주변에서 모집 중인 활동 수가 늘어나는지 확인하는 테스트용 활동이에요."));
        near.put("placeId", 3);
        createActivity(near, host);
        JsonNode after = home(host, "?lat=37.8156&lng=127.0937&radiusKm=5");
        assertThat(after.path("nearby").path("located").asBoolean()).isTrue();
        assertThat(after.path("nearby").path("volink").asInt()).isEqualTo(before.path("nearby").path("volink").asInt() + 1);
        // 1365 is off in tests (no key): no number rather than a made-up zero.
        assertThat(after.path("nearby").path("program").isNull()).isTrue();
        // Far away (Busan): not counted; no position: the all-Volink count instead.
        assertThat(home(host, "?lat=35.1796&lng=129.0756&radiusKm=5").path("nearby").path("volink").asInt()).isZero();
        JsonNode nowhere = home(host, "");
        assertThat(nowhere.path("nearby").path("located").asBoolean()).isFalse();
        assertThat(nowhere.path("nearby").path("volink").isNull()).isTrue();
        assertThat(nowhere.path("nearby").path("volinkAll").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(nowhere.path("official").isNull()).isTrue();

        // Monthly: two activities by the same person this month count once; a HELD record does not count.
        stats.forget();
        JsonNode start = home(host, "").path("monthly");
        LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Seoul")).withNano(0);
        long organizer = id(hostEmail);
        java.util.HashMap<String, Object> first = new java.util.HashMap<>(activity("기록 활동 하나", "월별 참여 인원을 제대로 세는지 확인하는 테스트용 활동이에요."));
        first.put("date", TODAY.plusDays(8).toString());
        long a1 = createActivity(first, host);
        java.util.HashMap<String, Object> second = new java.util.HashMap<>(activity("기록 활동 둘", "월별 참여 인원을 제대로 세는지 확인하는 테스트용 활동이에요."));
        second.put("date", TODAY.plusDays(9).toString());
        long a2 = createActivity(second, host);
        long same = id(member("GENERAL")), other = id(member("GENERAL")), held = id(member("GENERAL"));
        record(a1, same, organizer, now, "VALID");
        record(a2, same, organizer, now, "VALID");
        record(a1, other, organizer, now, "VALID");
        record(a2, held, organizer, now, "HELD");
        stats.forget();
        JsonNode month = home(host, "").path("monthly");
        assertThat(month.path("points")).hasSize(6);
        JsonNode last = month.path("points").get(5);
        assertThat(last.path("month").asText()).isEqualTo(YearMonth.now(ZoneId.of("Asia/Seoul")).toString());
        assertThat(last.path("people").asInt()).isEqualTo(start.path("points").get(5).path("people").asInt() + 2);
        assertThat(month.path("source").asText()).isEqualTo("VOLINK_RECORDS");
        // Numbers only: no names, e-mails or ids anywhere in the answer.
        String body = perform(get("/api/stats/home"), null, host).andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("@").doesNotContain("name").doesNotContain("userId");
    }
}
