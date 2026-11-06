package com.volink.external;

import com.fasterxml.jackson.databind.JsonNode;
import com.volink.ApiTestSupport;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 1365 activities in my records (V27): mark, went or not, certificate values, review, lab import, reminders. */
class ExternalRecordIntegrationTest extends ApiTestSupport {
    @Autowired ExternalRecordService records;

    private Map<String, Object> program(String title, int days) {
        return Map.of("programNo", "P" + ThreadLocalRandom.current().nextInt(100000, 999999), "title", title, "organization", "양주시자원봉사센터",
                "place", "양주시 옥정동", "date", TODAY.plusDays(days).toString(), "startTime", "11:00", "endTime", "13:00");
    }

    private long id(JsonNode node) { return node.path("id").asLong(); }

    private JsonNode body(org.springframework.test.web.servlet.ResultActions result) throws Exception {
        return json.readTree(result.andReturn().getResponse().getContentAsString());
    }

    @Test
    void markedApplicationGoesThroughWentCertificateAndReview() throws Exception {
        String member = token(member("GENERAL"));
        Map<String, Object> request = program("노인복지관 배식 지원", 2);
        JsonNode created = body(perform(post("/api/me/external"), request, member).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PLANNED")).andExpect(jsonPath("$.source").value("SELF")).andExpect(jsonPath("$.certified").value(false)));
        long id = id(created);
        perform(post("/api/me/external"), request, member).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EXTERNAL_EXISTS"));
        // Not started yet: cannot say "went".
        perform(put("/api/me/external/" + id + "/status"), Map.of("status", "ATTENDED"), member).andExpect(status().isConflict());
        // Someone else's record is not found.
        String other = token(member("GENERAL"));
        perform(get("/api/me/external/" + id), null, other).andExpect(status().isNotFound());

        jdbc.update("UPDATE external_records SET starts_at = ?, ends_at = ? WHERE id = ?", LocalDateTime.now().minusDays(1), LocalDateTime.now().minusDays(1).plusHours(2), id);
        perform(put("/api/me/external/" + id + "/status"), Map.of("status", "ATTENDED"), member).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ATTENDED"));
        perform(put("/api/me/external/" + id + "/certificate"), Map.of("title", "노인복지관 배식 지원", "organization", "양주시자원봉사센터", "date", TODAY.minusDays(1).toString(), "minutes", 120), member)
                .andExpect(status().isOk()).andExpect(jsonPath("$.certified").value(true)).andExpect(jsonPath("$.certMinutes").value(120));
        perform(put("/api/me/external/" + id + "/certificate"), Map.of("title", "x", "date", TODAY.plusDays(3).toString(), "minutes", 0), member).andExpect(status().isBadRequest());

        // Review about the 1365 record: shown with its title and the certificate mark, never "verified".
        perform(put("/api/community/me"), Map.of("nickname", "배식" + ThreadLocalRandom.current().nextInt(1000, 9999), "agree", true), member).andExpect(status().isOk());
        JsonNode post = body(perform(post("/api/community/posts"), Map.of("category", "REVIEW", "title", "배식 봉사 다녀왔어요", "body", "어르신들이 반겨 주셔서 좋았어요.", "externalId", id), member)
                .andExpect(status().isCreated()));
        assertThat(post.path("externalTitle").asText()).isEqualTo("노인복지관 배식 지원");
        assertThat(post.path("externalCertified").asBoolean()).isTrue();
        assertThat(post.path("verified").asBoolean()).isFalse();
        perform(get("/api/me/external/" + id), null, member).andExpect(jsonPath("$.reviewId").value(post.path("id").asLong()));
        perform(delete("/api/me/external/" + id), null, member).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("HAS_REVIEW"));

        // A review needs a record the person said they went to.
        long planned = id(body(perform(post("/api/me/external"), program("하천 정화", 5), member).andExpect(status().isCreated())));
        perform(post("/api/community/posts"), Map.of("category", "REVIEW", "title", "아직 안 갔어요", "body", "아직 가지 않은 활동이에요.", "externalId", planned), member).andExpect(status().isBadRequest());
        perform(delete("/api/me/external/" + planned), null, member).andExpect(status().isNoContent());
    }

    @Test
    void labImportSkipsRowsAlreadyThereAndRemindersGoOnce() throws Exception {
        String member = token(member("GENERAL"));
        Map<String, Object> soon = Map.of("title", "도서관 정리 도우미", "date", TODAY.plusDays(1).toString(), "startTime", "10:00", "endTime", "12:00", "labStatus", "승인완료");
        Map<String, Object> past = Map.of("title", "하천 정화 활동", "date", TODAY.minusDays(2).toString(), "startTime", "09:00", "endTime", "11:00", "labStatus", "활동완료");
        perform(post("/api/me/external/import"), Map.of("items", List.of(soon, past)), member).andExpect(status().isOk()).andExpect(jsonPath("$.added").value(2));
        perform(post("/api/me/external/import"), Map.of("items", List.of(soon)), member).andExpect(status().isOk()).andExpect(jsonPath("$.added").value(0));
        JsonNode list = body(perform(get("/api/me/external"), null, member).andExpect(status().isOk()));
        assertThat(list.size()).isEqualTo(2);
        assertThat(list.get(1).path("source").asText()).isEqualTo("LAB");
        assertThat(list.get(1).path("status").asText()).isEqualTo("ATTENDED"); // a finished row read from 1365
        perform(post("/api/me/external/import"), Map.of("items", List.of()), member).andExpect(status().isBadRequest());

        // A planned one that ended over 2 hours ago gets "다녀왔어요?"; the one starting tomorrow gets the reminder (once each).
        long mine = jdbc.queryForObject("SELECT user_id FROM external_records WHERE id = ?", Long.class, list.get(0).path("id").asLong());
        jdbc.update("INSERT INTO external_records(user_id, title, starts_at, ends_at) VALUES (?, '지난 배식', ?, ?)", mine, LocalDateTime.now().minusHours(6), LocalDateTime.now().minusHours(4));
        records.remind();
        records.remind();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'EXT_CHECK'", Integer.class, mine)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'EXT_DAY_BEFORE'", Integer.class, mine)).isEqualTo(1);
    }
}
