package com.volink.participation;

import com.volink.ApiTestSupport;
import com.volink.common.ApiException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Week 5: applications, capacity lock, waitlist offers and notifications (docs/test-cases.md P-01..P-07, A-05). */
class ParticipationIntegrationTest extends ApiTestSupport {
    @Autowired ParticipationService participations;

    @Test
    void oneApplicationPerPersonAndNeverOnYourOwnActivity() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(withCapacity(3), organizer);
        String member = token(member("GENERAL"));
        mvc.perform(post("/api/activities/" + activity + "/participations")).andExpect(status().isUnauthorized());
        apply(activity, member).andExpect(status().isCreated()).andExpect(jsonPath("$.participation.status").value("APPLIED"))
                .andExpect(jsonPath("$.pending").value(1));
        apply(activity, member).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DUPLICATE_APPLICATION"));
        apply(activity, organizer).andExpect(status().isForbidden());
        apply(activity, token(admin())).andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ?", Integer.class, activity)).isEqualTo(1);

        String restricted = member("GENERAL");
        String restrictedToken = token(restricted);
        jdbc.update("UPDATE users SET status = 'RESTRICTED' WHERE email = ?", restricted);
        apply(activity, restrictedToken).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ACCOUNT_RESTRICTED"));
    }

    @Test
    void approvalStopsAtCapacityAndLaterApplicantsGetWaitOrders() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(withCapacity(2), organizer);
        long a = pid(apply(activity, token(member("GENERAL"))));
        long b = pid(apply(activity, token(member("GENERAL"))));
        long c = pid(apply(activity, token(member("GENERAL"))));
        decide(a, "approve", organizer).andExpect(status().isNoContent());
        decide(b, "approve", organizer).andExpect(status().isNoContent());
        decide(c, "approve", organizer).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CAPACITY_FULL"));
        apply(activity, token(member("GENERAL"))).andExpect(jsonPath("$.participation.status").value("WAITLISTED")).andExpect(jsonPath("$.participation.waitOrder").value(1));
        apply(activity, token(member("GENERAL"))).andExpect(jsonPath("$.participation.waitOrder").value(2)).andExpect(jsonPath("$.confirmed").value(2));
        perform(post("/api/participations/" + c + "/reject"), Map.of("reason", "인원 구성상 이번에는 어렵습니다"), organizer).andExpect(status().isNoContent());
        assertThat(statusOf(c)).isEqualTo("REJECTED");
    }

    @Test
    void cancellationOffersTheSeatInOrderAndOffersExpireOrCanBeDeclined() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(withCapacity(2), organizer);
        String first = token(member("GENERAL"));
        long a = pid(apply(activity, first));
        decide(a, "approve", organizer);
        decide(pid(apply(activity, token(member("GENERAL")))), "approve", organizer);
        String[] waiting = {token(member("GENERAL")), token(member("GENERAL")), token(member("GENERAL"))};
        long[] w = new long[3];
        for (int i = 0; i < 3; i++) w[i] = pid(apply(activity, waiting[i]));

        perform(post("/api/participations/" + a + "/cancel"), Map.of(), first).andExpect(status().isOk())
                .andExpect(jsonPath("$.participation.status").value("CANCELLED")).andExpect(jsonPath("$.offered").value(1));
        assertThat(statusOf(w[0])).isEqualTo("OFFERED");
        // Seven days ahead, so the answer time is 6 hours.
        LocalDateTime expires = jdbc.queryForObject("SELECT offer_expires_at FROM participations WHERE id = ?", LocalDateTime.class, w[0]);
        assertThat(expires).isBetween(LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusHours(5).plusMinutes(58), LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusHours(6).plusMinutes(1));
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + waiting[0]))
                .andExpect(jsonPath("$.items[0].type").value("WAITLIST_OFFER")).andExpect(jsonPath("$.unread").value(2));

        // P-04: the answer time passes -> expired, the next person is offered.
        jdbc.update("UPDATE participations SET offer_expires_at = ? WHERE id = ?", LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusMinutes(1), w[0]);
        assertThat(participations.expireDue()).isGreaterThanOrEqualTo(2);
        assertThat(statusOf(w[0])).isEqualTo("EXPIRED");
        assertThat(statusOf(w[1])).isEqualTo("OFFERED");
        perform(post("/api/participations/" + w[0] + "/accept-offer"), Map.of(), waiting[0]).andExpect(status().isConflict());

        perform(post("/api/participations/" + w[1] + "/decline-offer"), Map.of(), waiting[1]).andExpect(status().isOk());
        assertThat(statusOf(w[2])).isEqualTo("OFFERED");
        jdbc.update("UPDATE participations SET offer_expires_at = ? WHERE id = ?", LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusMinutes(1), w[2]);
        perform(post("/api/participations/" + w[2] + "/accept-offer"), Map.of(), waiting[2]).andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("OFFER_EXPIRED"));
        jdbc.update("UPDATE participations SET offer_expires_at = ? WHERE id = ?", LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusHours(1), w[2]);
        perform(post("/api/participations/" + w[2] + "/accept-offer"), Map.of(), waiting[2]).andExpect(status().isOk())
                .andExpect(jsonPath("$.participation.status").value("CONFIRMED")).andExpect(jsonPath("$.confirmed").value(2));

        // P-07: every change is logged with the participation.
        assertThat(jdbc.queryForList("SELECT to_status FROM activity_logs WHERE participation_id = ? ORDER BY id", String.class, w[0]))
                .containsExactly("WAITLISTED", "OFFERED", "EXPIRED");
        assertThat(jdbc.queryForList("SELECT to_status FROM activity_logs WHERE participation_id = ? ORDER BY id", String.class, w[2]))
                .containsExactly("WAITLISTED", "OFFERED", "CONFIRMED");
        // Re-applying after a first cancellation is allowed once.
        apply(activity, first).andExpect(status().isCreated()).andExpect(jsonPath("$.participation.status").value("WAITLISTED"));
    }

    @Test
    void withinTwoHoursOfTheStartFreedSeatsStayEmptyAndTheWaitlistCloses() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(withCapacity(2), organizer);
        String confirmed = token(member("GENERAL"));
        long a = pid(apply(activity, confirmed));
        decide(a, "approve", organizer);
        decide(pid(apply(activity, token(member("GENERAL")))), "approve", organizer);
        long waiting = pid(apply(activity, token(member("GENERAL"))));
        LocalDateTime soon = LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusMinutes(90);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", soon, soon.plusMinutes(60), activity);

        perform(post("/api/participations/" + a + "/cancel"), Map.of(), confirmed).andExpect(status().isOk());
        assertThat(statusOf(waiting)).isEqualTo("WAITLISTED");
        participations.expireDue();
        assertThat(statusOf(waiting)).isEqualTo("EXPIRED");
        decide(pid(apply(activity, token(member("GENERAL")))), "approve", organizer).andExpect(status().isNoContent());
        apply(activity, token(member("GENERAL"))).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("WAITLIST_CLOSED"));
    }

    @Test
    void onlyTheOrganizerSeesApplicantsWithMaskedNamesAndNoContact() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(withCapacity(3), organizer);
        String member = token(member("GENERAL"));
        long id = pid(apply(activity, member));
        mvc.perform(get("/api/activities/" + activity + "/participations").header("Authorization", "Bearer " + member)).andExpect(status().isNotFound());
        decide(id, "approve", member).andExpect(status().isNotFound());
        mvc.perform(get("/api/activities/" + activity + "/participations").header("Authorization", "Bearer " + organizer))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].name").value("테*트"))
                .andExpect(jsonPath("$.items[0].email").doesNotExist()).andExpect(jsonPath("$.capacity").value(3));
        assertThat(ParticipationService.mask("홍길동")).isEqualTo("홍*동");
        assertThat(ParticipationService.mask("김철")).isEqualTo("김*");
        mvc.perform(get("/api/me/participations").header("Authorization", "Bearer " + member))
                .andExpect(jsonPath("$[0].activityId").value(activity)).andExpect(jsonPath("$[0].status").value("APPLIED"));
        mvc.perform(get("/api/activities/" + activity + "/my-participation")).andExpect(status().isOk())
                .andExpect(jsonPath("$.participation").doesNotExist()).andExpect(jsonPath("$.pending").value(1));
    }

    @Test
    void notificationsBelongToTheirOwner() throws Exception {
        String organizer = token(member("GENERAL"));
        long activity = createActivity(withCapacity(2), organizer);
        String member = token(member("GENERAL"));
        decide(pid(apply(activity, member)), "approve", organizer);
        String body = mvc.perform(get("/api/me/notifications").param("unread", "true").header("Authorization", "Bearer " + member))
                .andExpect(jsonPath("$.items[0].title").value("참가가 확정되었습니다")).andReturn().getResponse().getContentAsString();
        long id = json.readTree(body).get("items").get(0).get("id").asLong();
        // TIMESTAMP columns are shown in Korean time even though the DB session runs in UTC.
        LocalDateTime shown = LocalDateTime.parse(json.readTree(body).get("items").get(0).get("createdAt").asText().replace(' ', 'T'));
        LocalDateTime korea = LocalDateTime.now(ZoneId.of("Asia/Seoul"));
        assertThat(shown).isBetween(korea.minusMinutes(2), korea.plusMinutes(2));
        mvc.perform(post("/api/notifications/" + id + "/read").header("Authorization", "Bearer " + organizer)).andExpect(status().isNotFound());
        mvc.perform(post("/api/notifications/" + id + "/read").header("Authorization", "Bearer " + member)).andExpect(status().isNoContent());
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + member)).andExpect(jsonPath("$.unread").value(0));
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.items[0].title").value("새 참가 신청"));
        mvc.perform(post("/api/notifications/read-all").header("Authorization", "Bearer " + organizer)).andExpect(status().isNoContent());
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + organizer)).andExpect(jsonPath("$.unread").value(0));
    }

    /** P-02: ten approvals race for the last seat; the activity row lock lets exactly one win. */
    @Test
    void concurrentApprovalsForTheLastSeatConfirmExactlyOne() throws Exception {
        String organizerEmail = member("GENERAL");
        String organizer = token(organizerEmail);
        long organizerId = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, organizerEmail);
        long activity = createActivity(withCapacity(2), organizer);
        participations.approve(organizerId, applyAs(newUser(), activity));
        List<Long> applications = new ArrayList<>();
        for (int i = 0; i < 10; i++) applications.add(applyAs(newUser(), activity));

        List<Object> results = race(applications.stream().<Callable<Object>>map(id -> () -> { participations.approve(organizerId, id); return "ok"; }).toList());
        assertThat(results.stream().filter("ok"::equals)).hasSize(1);
        assertThat(results.stream().filter(r -> r instanceof ApiException e && "CAPACITY_FULL".equals(e.code()))).hasSize(9);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND status = 'CONFIRMED'", Integer.class, activity)).isEqualTo(2);

        // Ten people joining the full activity at once still get distinct, gap-free wait orders.
        List<Long> users = new ArrayList<>();
        for (int i = 0; i < 10; i++) users.add(newUser());
        race(users.stream().<Callable<Object>>map(user -> () -> participations.apply(user, activity)).toList());
        assertThat(jdbc.queryForList("SELECT wait_order FROM participations WHERE activity_id = ? AND status = 'WAITLISTED' ORDER BY wait_order", Integer.class, activity))
                .containsExactly(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    }

    // ---- helpers ----

    private org.springframework.test.web.servlet.ResultActions apply(long activity, String token) throws Exception {
        return perform(post("/api/activities/" + activity + "/participations"), Map.of(), token);
    }

    private org.springframework.test.web.servlet.ResultActions decide(long participation, String action, String token) throws Exception {
        return perform(post("/api/participations/" + participation + "/" + action), Map.of(), token);
    }

    private long pid(org.springframework.test.web.servlet.ResultActions result) throws Exception {
        return json.readTree(result.andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
    }

    private String statusOf(long participation) {
        return jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, participation);
    }

    private static Map<String, Object> withCapacity(int capacity) {
        Map<String, Object> body = activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다.");
        body.put("capacity", capacity);
        return body;
    }

    private long applyAs(long user, long activity) {
        return ((Number) ((Map<?, ?>) participations.apply(user, activity).get("participation")).get("id")).longValue();
    }

    /** A member inserted directly (faster than the signup API for concurrency tests). */
    long newUser() {
        String email = "w5-" + UUID.randomUUID() + "@example.com";
        jdbc.update("INSERT INTO users(email, display_name, password_hash, role, member_type, birth_date) VALUES (?, '동시신청', 'x', 'USER', 'GENERAL', ?)",
                email, LocalDate.of(2000, 1, 1));
        return jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
    }

    private static List<Object> race(List<Callable<Object>> tasks) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Object>> futures = new ArrayList<>();
            for (Callable<Object> task : tasks) futures.add(pool.submit(() -> { start.await(); try { return task.call(); } catch (ApiException e) { return e; } }));
            start.countDown();
            List<Object> results = new ArrayList<>();
            for (Future<Object> future : futures) results.add(future.get());
            return results;
        } finally {
            pool.shutdown();
        }
    }
}
