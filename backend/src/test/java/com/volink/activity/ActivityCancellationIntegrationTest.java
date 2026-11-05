package com.volink.activity;

import com.fasterxml.jackson.databind.JsonNode;
import com.volink.ApiTestSupport;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Organizer's emergency cancellation (V18): reason code + message, snapshot, once, before the start, records kept. */
class ActivityCancellationIntegrationTest extends ApiTestSupport {
    private static Map<String, Object> cancel(String code, String message) {
        return Map.of("reasonCode", code, "message", message);
    }

    @Test
    void cancelWithConfirmedAndWaitingPeopleKeepsASnapshotAndTellsEachOnce() throws Exception {
        String host = token(member("GENERAL"));
        Map<String, Object> body = activity("긴급 취소 확인 활동", "긴급 취소가 제대로 되는지 확인하는 활동이에요.");
        body.put("capacity", 1);
        long activity = createActivity(body, host);
        String confirmed = token(member("GENERAL")), waiting = token(member("GENERAL")), stranger = token(member("GENERAL"));
        long p1 = pid(perform(post("/api/activities/" + activity + "/participations"), Map.of(), confirmed).andReturn().getResponse().getContentAsString());
        perform(post("/api/participations/" + p1 + "/approve"), Map.of(), host).andExpect(status().isNoContent());
        perform(post("/api/activities/" + activity + "/participations"), Map.of(), waiting).andExpect(status().isCreated());

        perform(post("/api/activities/" + activity + "/cancel"), Map.of("message", "갑자기 일이 생겼어요"), host).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("reasonCode"));
        perform(post("/api/activities/" + activity + "/cancel"), cancel("PERSONAL", " "), host).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("message"));
        perform(post("/api/activities/" + activity + "/cancel"), cancel("PERSONAL", "연락 주세요 010-1234-5678"), host).andExpect(status().isBadRequest());
        perform(post("/api/activities/" + activity + "/cancel"), cancel("PERSONAL", "모집자 사정으로 취소합니다."), stranger).andExpect(status().isNotFound());

        perform(post("/api/activities/" + activity + "/cancel"), cancel("WEATHER", "강풍 예보로 안전을 위해 취소합니다."), host).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED")).andExpect(jsonPath("$.cancellation.reasonCode").value("WEATHER"))
                .andExpect(jsonPath("$.cancellation.reasonLabel").value("기상 악화 및 안전 문제"))
                .andExpect(jsonPath("$.cancellation.confirmedCount").value(1)).andExpect(jsonPath("$.cancellation.waitingCount").value(1));
        // A second press changes nothing and tells nobody again.
        perform(post("/api/activities/" + activity + "/cancel"), cancel("WEATHER", "강풍 예보로 안전을 위해 취소합니다."), host).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ALREADY_CANCELLED"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE activity_id = ? AND type = 'ACTIVITY_CANCELLED'", Integer.class, activity)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM activity_cancellations WHERE activity_id = ?", Integer.class, activity)).isEqualTo(1);
        // Records stay: the rows remain with their history in the log.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ?", Integer.class, activity)).isEqualTo(2);
        assertThat(jdbc.queryForList("SELECT from_status FROM activity_logs WHERE activity_id = ? AND reason = '활동 취소'", String.class, activity)).containsExactlyInAnyOrder("CONFIRMED", "WAITLISTED");

        // The participant sees the reason and message; nobody can apply any more.
        perform(get("/api/activities/" + activity), null, confirmed).andExpect(jsonPath("$.cancellation.message").value("강풍 예보로 안전을 위해 취소합니다."));
        perform(post("/api/activities/" + activity + "/participations"), Map.of(), stranger).andExpect(status().is4xxClientError());
        JsonNode center = json.readTree(perform(get("/api/me/notification-center"), null, waiting).andReturn().getResponse().getContentAsString());
        assertThat(center.path("items").get(0).path("title").asText()).isEqualTo("봉사활동이 취소되었어요");
        assertThat(center.path("items").get(0).path("activityId").asLong()).isEqualTo(activity);
    }

    @Test
    void noParticipantsStartedOrCheckedInActivities() throws Exception {
        String host = token(member("GENERAL"));
        long empty = createActivity(activity("아무도 없는 활동", "신청자가 없는 활동을 취소해 보는 활동이에요."), host);
        perform(post("/api/activities/" + empty + "/cancel"), cancel("PLACE", "장소를 쓸 수 없게 되었어요."), host).andExpect(status().isOk())
                .andExpect(jsonPath("$.cancellation.confirmedCount").value(0));

        // Check-in opened (30 min before) and someone checked in: refused, the record stays.
        long checked = createActivity(activity("출석한 사람이 있는 활동", "출석 기록이 있으면 일반 취소가 막히는지 보는 활동이에요."), host);
        String member = token(member("GENERAL"));
        long pid = pid(perform(post("/api/activities/" + checked + "/participations"), Map.of(), member).andReturn().getResponse().getContentAsString());
        perform(post("/api/participations/" + pid + "/approve"), Map.of(), host).andExpect(status().isNoContent());
        LocalDateTime soon = LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusMinutes(10).withSecond(0).withNano(0);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", soon, soon.plusMinutes(60), checked);
        perform(post("/api/participations/" + pid + "/manual-check-in"), Map.of("reason", "현장에서 얼굴로 확인함"), host).andExpect(status().isNoContent());
        perform(post("/api/activities/" + checked + "/cancel"), cancel("STAFF", "운영 인력이 부족해 취소합니다."), host).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CHECKED_IN"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM check_ins WHERE participation_id = ?", Integer.class, pid)).isEqualTo(1);

        // Started (or finished): refused.
        long started = createActivity(activity("이미 시작한 활동", "시작한 활동은 일반 취소가 안 되는지 보는 활동이에요."), host);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", soon.minusHours(1), soon.plusHours(1), started);
        perform(post("/api/activities/" + started + "/cancel"), cancel("OTHER", "진행이 어려워 취소합니다."), host).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("STARTED"));
    }

    @Test
    void applicationsRacingWithTheCancellationEitherCountOrAreRefused() throws Exception {
        String host = token(member("GENERAL"));
        long activity = createActivity(activity("경쟁 상황 취소 활동", "신청과 취소가 동시에 들어오는 상황을 보는 활동이에요."), host);
        List<String> members = new ArrayList<>();
        for (int i = 0; i < 4; i++) members.add(token(member("GENERAL")));
        List<Callable<Integer>> tasks = new ArrayList<>();
        for (String m : members) tasks.add(() -> perform(post("/api/activities/" + activity + "/participations"), Map.of(), m).andReturn().getResponse().getStatus());
        tasks.add(() -> perform(post("/api/activities/" + activity + "/cancel"), cancel("PERSONAL", "개인 사정으로 취소합니다."), host).andReturn().getResponse().getStatus());
        var pool = Executors.newFixedThreadPool(tasks.size());
        List<Future<Integer>> results = pool.invokeAll(tasks);
        pool.shutdown();
        for (Future<Integer> f : results) f.get();
        // Whoever got in before the cancel is cancelled with it and told; nobody stays active on a cancelled activity.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND status <> 'CANCELLED'", Integer.class, activity)).isZero();
        int inBefore = jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ?", Integer.class, activity);
        assertThat(jdbc.queryForObject("SELECT applied_count FROM activity_cancellations WHERE activity_id = ?", Integer.class, activity)).isEqualTo(inBefore);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE activity_id = ? AND type = 'ACTIVITY_CANCELLED'", Integer.class, activity)).isEqualTo(inBefore);
    }

    private long pid(String json) throws Exception {
        return this.json.readTree(json).path("participation").path("id").asLong();
    }
}
