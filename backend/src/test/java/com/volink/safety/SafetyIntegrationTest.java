package com.volink.safety;

import com.volink.ApiTestSupport;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Week 7: reports, evidence, appeals, sanctions, recommendations (docs/test-cases.md M-01..M-05). */
class SafetyIntegrationTest extends ApiTestSupport {
    @Autowired EvidenceService evidences;
    @Autowired EvidenceStorage storage;
    @Autowired SanctionService sanctions;

    @Test
    void onlyPeopleWhoTookPartCanReportAndTheRateIsLimited() throws Exception {
        Flow flow = completedFlow();
        String stranger = token(member("GENERAL"));
        report(stranger, flow.activity, null, "개설자가 안전 수칙을 지키지 않았습니다.").andExpect(status().isForbidden());
        report(flow.member, flow.activity, null, "짧음").andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("description"));
        report(flow.member, flow.activity, flow.memberId, "자기 자신을 신고하는 요청입니다.").andExpect(status().isBadRequest());
        report(flow.organizer, flow.activity, flow.memberId, "참가자가 다른 사람에게 거친 말을 했습니다.").andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("RECEIVED"));
        for (int i = 0; i < 9; i++) report(flow.organizer, flow.activity, null, "같은 내용 반복 신고 시험입니다 " + i).andExpect(status().isCreated());
        report(flow.organizer, flow.activity, null, "열한 번째 신고는 막혀야 합니다.").andExpect(status().isTooManyRequests());
        mvc.perform(get("/api/me/reports").header("Authorization", "Bearer " + flow.organizer)).andExpect(jsonPath("$.length()").value(10));
    }

    /** M-02: type from the bytes, at most 3 files, 10 MB, EXIF removed, private file opened only by a 5-minute signed link. */
    @Test
    void evidenceIsCheckedCleanedAndOpenedOnlyThroughASignedLink() throws Exception {
        Flow flow = completedFlow();
        long report = reportId(report(flow.member, flow.activity, null, "활동 중 위험한 장비를 사용했습니다."));
        byte[] jpeg = jpegWithExif();
        assertThat(new String(jpeg, StandardCharsets.ISO_8859_1)).contains("Exif").contains("GPS-SECRET-SPOT");

        long evidence = json.readTree(upload(flow.member, report, "photo.JPG", jpeg).andExpect(status().isCreated())
                .andExpect(jsonPath("$.contentType").value("image/jpeg")).andReturn().getResponse().getContentAsString()).get("id").asLong();
        String key = jdbc.queryForObject("SELECT storage_key FROM report_evidences WHERE id = ?", String.class, evidence);
        String stored = new String(storage.read(key), StandardCharsets.ISO_8859_1);
        assertThat(stored).doesNotContain("Exif").doesNotContain("GPS-SECRET-SPOT");

        upload(flow.member, report, "virus.jpg", "MZ fake executable".getBytes()).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].message").value("jpg·png·pdf 파일만 올릴 수 있습니다."));
        upload(flow.member, report, "photo.pdf", jpeg).andExpect(status().isBadRequest());
        upload(flow.member, report, "big.pdf", bigPdf()).andExpect(status().isBadRequest());
        upload(flow.organizer, report, "photo.jpg", jpeg).andExpect(status().isNotFound());
        upload(flow.member, report, "doc.pdf", "%PDF-1.4 test document".getBytes()).andExpect(status().isCreated());
        upload(flow.member, report, "photo2.jpeg", jpeg).andExpect(status().isCreated());
        upload(flow.member, report, "photo3.jpg", jpeg).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].message").value(org.hamcrest.Matchers.containsString("최대 3개")));

        String admin = token(admin());
        mvc.perform(get("/api/admin/reports").header("Authorization", "Bearer " + admin)).andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + report + ")].evidences.length()").value(org.hamcrest.Matchers.contains(3)));
        mvc.perform(get("/api/admin/reports").param("status", "DISMISSED").header("Authorization", "Bearer " + admin)).andExpect(status().isOk());
        mvc.perform(get("/api/admin/reports/" + report + "/evidences/" + evidence + "/url").header("Authorization", "Bearer " + flow.member)).andExpect(status().isForbidden());
        String url = json.readTree(mvc.perform(get("/api/admin/reports/" + report + "/evidences/" + evidence + "/url").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get("url").asText();
        mvc.perform(get(url)).andExpect(status().isOk()).andExpect(content().contentType("image/jpeg")).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(get(url.replace("sig=", "sig=x"))).andExpect(status().isForbidden());
        mvc.perform(get(evidences.signedPath(evidence, Instant.now().minusSeconds(1).getEpochSecond()))).andExpect(status().isGone());
    }

    /** M-03: every admin decision needs a reason; HOLD then DISMISS restores, INVALIDATE voids the record. */
    @Test
    void adminHoldsDismissesOrInvalidatesWithAReason() throws Exception {
        Flow flow = completedFlow();
        String admin = token(admin());
        long report = reportId(report(flow.organizer, flow.activity, flow.memberId, "체크인만 하고 바로 돌아갔습니다."));
        resolve(admin, report, "HOLD", " ").andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("reason"));
        resolve(flow.member, report, "HOLD", "확인 중").andExpect(status().isForbidden());
        resolve(admin, report, "HOLD", "사실 확인 중").andExpect(status().isNoContent());
        assertThat(participationStatus(flow)).isEqualTo("HELD");
        assertThat(recordStatus(flow)).isEqualTo("HELD");
        resolve(admin, report, "DISMISS", "현장 사진으로 참여를 확인함").andExpect(status().isNoContent());
        assertThat(participationStatus(flow)).isEqualTo("COMPLETED");
        assertThat(recordStatus(flow)).isEqualTo("VALID");
        resolve(admin, report, "DISMISS", "다시").andExpect(status().isConflict());

        long second = reportId(report(flow.organizer, flow.activity, flow.memberId, "다른 사람이 대신 체크인했습니다."));
        resolve(admin, second, "INVALIDATE", "본인이 아닌 사람이 체크인한 것을 확인함").andExpect(status().isNoContent());
        assertThat(participationStatus(flow)).isEqualTo("INVALIDATED");
        assertThat(recordStatus(flow)).isEqualTo("INVALIDATED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM admin_actions WHERE target_type = 'REPORT' AND target_id IN (?, ?)", Integer.class, report, second)).isEqualTo(3);
        mvc.perform(get("/api/me/notifications").header("Authorization", "Bearer " + flow.organizer))
                .andExpect(jsonPath("$.items[0].type").value("REPORT_RESULT"));
    }

    /** M-01: appeals within 7 days of the completion only; the record is held until an admin decides. */
    @Test
    void appealsAreAcceptedWithinSevenDaysAndHoldTheRecord() throws Exception {
        Flow flow = completedFlow();
        String admin = token(admin());
        appeal(token(member("GENERAL")), flow.record, "관계없는 사람의 이의 신청입니다.").andExpect(status().isNotFound());
        appeal(flow.member, flow.record, "짧음").andExpect(status().isBadRequest());
        long first = json.readTree(appeal(flow.member, flow.record, "활동 시간이 실제와 다르게 기록되었습니다.").andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asLong();
        appeal(flow.member, flow.record, "같은 기록에 두 번째 이의 신청입니다.").andExpect(status().isConflict());
        assertThat(recordStatus(flow)).isEqualTo("HELD");
        perform(post("/api/admin/appeals/" + first + "/reject"), Map.of("reason", ""), admin).andExpect(status().isBadRequest());
        perform(post("/api/admin/appeals/" + first + "/reject"), Map.of("reason", "모집자 확인 시각과 일치함"), admin).andExpect(status().isNoContent());
        assertThat(recordStatus(flow)).isEqualTo("VALID");
        assertThat(participationStatus(flow)).isEqualTo("COMPLETED");

        long second = json.readTree(appeal(flow.organizer, flow.record, "이 참가자는 실제로 오지 않았습니다.").andReturn().getResponse().getContentAsString()).get("id").asLong();
        mvc.perform(get("/api/admin/appeals").header("Authorization", "Bearer " + admin)).andExpect(jsonPath("$[?(@.id == " + second + ")].title").exists());
        perform(post("/api/admin/appeals/" + second + "/accept"), Map.of("reason", "참가자 본인도 불참을 인정함"), admin).andExpect(status().isNoContent());
        assertThat(recordStatus(flow)).isEqualTo("INVALIDATED");

        Flow late = completedFlow();
        jdbc.update("UPDATE activity_records SET confirmed_at = ? WHERE id = ?", LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusDays(8), late.record);
        appeal(late.member, late.record, "여드레 지난 기록에 대한 이의 신청입니다.").andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("APPEAL_PERIOD_OVER"));
    }

    /** M-03/M-04: sanctions need a reason; restriction blocks applying; three no-shows restrict automatically; expiry lifts it. */
    @Test
    void sanctionsAndNoShowRestriction() throws Exception {
        String admin = token(admin());
        String email = member("GENERAL");
        String user = token(email);
        long userId = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
        sanction(admin, userId, Map.of("type", "RESTRICTION", "days", 7)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("reason"));
        sanction(user, userId, Map.of("type", "WARNING", "reason", "시험")).andExpect(status().isForbidden());
        long adminId = jdbc.queryForObject("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id DESC LIMIT 1", Long.class);
        sanction(admin, adminId, Map.of("type", "WARNING", "reason", "관리자 제재 시험")).andExpect(status().isForbidden());
        sanction(admin, userId, Map.of("type", "RESTRICTION", "days", 7, "reason", "반복된 무단 불참")).andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("RESTRICTED"));
        long activity = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), token(member("GENERAL")));
        perform(post("/api/activities/" + activity + "/participations"), Map.of(), user).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_RESTRICTED"));
        mvc.perform(get("/api/me/sanctions").header("Authorization", "Bearer " + user)).andExpect(jsonPath("$[0].type").value("RESTRICTION"));
        jdbc.update("UPDATE sanctions SET starts_at = ?, ends_at = ? WHERE user_id = ?", LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusDays(8), LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusMinutes(1), userId);
        sanctions.liftExpired();
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id = ?", String.class, userId)).isEqualTo("ACTIVE");
        mvc.perform(get("/api/admin/users").param("email", email.substring(0, 12)).header("Authorization", "Bearer " + admin))
                .andExpect(jsonPath("$[0].sanctions.length()").value(1));

        // M-04: three no-shows in 90 days → automatic 14-day restriction with no admin.
        for (int i = 0; i < 3; i++) noShow(userId);
        sanctions.afterNoShow(userId);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id = ?", String.class, userId)).isEqualTo("RESTRICTED");
        Map<String, Object> auto = jdbc.queryForMap("SELECT created_by, type, ends_at FROM sanctions WHERE user_id = ? ORDER BY id DESC LIMIT 1", userId);
        assertThat(auto.get("created_by")).isNull();
        assertThat((LocalDateTime) auto.get("ends_at")).isAfter(LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusDays(13));
    }

    /** M-05: interest + distance + time; your own and already-applied activities are left out. */
    @Test
    void recommendationsRankByInterestDistanceAndTime() throws Exception {
        double lat = 34.2, lng = 126.6;
        perform(put("/api/admin/places/3"), Map.of("latitude", lat, "longitude", lng), token(admin())).andExpect(status().isOk());
        String organizer = token(member("GENERAL"));
        Map<String, Object> interesting = activity("관심 분야 활동 추천 시험", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다.");
        interesting.put("placeId", 3);
        long liked = createActivity(interesting, organizer);
        Map<String, Object> other = activity("다른 분야 활동 추천 시험", "이웃과 함께 생활에 필요한 물건을 나누고 정리합니다.");
        other.put("placeId", 3);
        other.put("category", "생활 지원");
        other.put("date", TODAY.plusDays(2).toString());
        long unliked = createActivity(other, organizer);
        String member = token(member("GENERAL"));

        String body = mvc.perform(get("/api/activities/recommended").param("lat", "" + lat).param("lng", "" + lng).header("Authorization", "Bearer " + member))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<Long> ids = json.readTree(body).findValues("id").stream().map(node -> node.asLong()).toList();
        assertThat(ids).contains(liked, unliked);
        assertThat(ids.indexOf(liked)).isLessThan(ids.indexOf(unliked));
        assertThat(json.readTree(body).get(ids.indexOf(liked)).get("reasons").toString()).contains("관심 분야");
        mvc.perform(get("/api/activities/recommended").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$[?(@.id == " + liked + ")]").isEmpty());
        perform(post("/api/activities/" + liked + "/participations"), Map.of(), member).andExpect(status().isCreated());
        mvc.perform(get("/api/activities/recommended").header("Authorization", "Bearer " + member))
                .andExpect(jsonPath("$[?(@.id == " + liked + ")]").isEmpty());
        mvc.perform(get("/api/activities/recommended")).andExpect(status().isUnauthorized());
    }

    // ---- helpers ----

    record Flow(String organizer, String member, long memberId, long activity, long participation, long record) {}

    /** Organizer + member with a completed participation and its record (check-in written directly, the end moved to the past). */
    private Flow completedFlow() throws Exception {
        String organizer = token(member("GENERAL"));
        String email = member("GENERAL");
        String member = token(email);
        long memberId = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
        long activity = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), organizer);
        long participation = json.readTree(perform(post("/api/activities/" + activity + "/participations"), Map.of(), member)
                .andReturn().getResponse().getContentAsString()).get("participation").get("id").asLong();
        perform(post("/api/participations/" + participation + "/approve"), Map.of(), organizer).andExpect(status().isNoContent());
        LocalDateTime start = LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusMinutes(90);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", start, start.plusMinutes(60), activity);
        jdbc.update("INSERT INTO check_ins(participation_id, method, within_radius, checked_by, checked_at) VALUES (?, 'QR', TRUE, ?, ?)", participation, memberId, start.plusMinutes(5));
        jdbc.update("UPDATE participations SET status = 'CHECKED_IN' WHERE id = ?", participation);
        perform(post("/api/participations/" + participation + "/complete"), Map.of(), organizer).andExpect(status().isNoContent());
        long record = jdbc.queryForObject("SELECT id FROM activity_records WHERE participation_id = ?", Long.class, participation);
        return new Flow(organizer, member, memberId, activity, participation, record);
    }

    private void noShow(long userId) throws Exception {
        long activity = createActivity(activity("공원 산책로 함께 정리하기", "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다."), token(member("GENERAL")));
        LocalDateTime start = LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusDays(2);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ?, status = 'FINISHED' WHERE id = ?", start, start.plusMinutes(60), activity);
        jdbc.update("INSERT INTO participations(activity_id, user_id, status) VALUES (?, ?, 'NO_SHOW')", activity, userId);
    }

    private ResultActions report(String token, long activity, Long target, String description) throws Exception {
        Map<String, Object> body = new java.util.HashMap<>(Map.of("activityId", activity, "reasonType", "SAFETY", "description", description));
        if (target != null) body.put("targetUserId", target);
        return perform(post("/api/reports"), body, token);
    }

    private long reportId(ResultActions result) throws Exception {
        return json.readTree(result.andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asLong();
    }

    private ResultActions resolve(String token, long report, String action, String reason) throws Exception {
        return perform(post("/api/admin/reports/" + report + "/resolve"), Map.of("action", action, "reason", reason), token);
    }

    private ResultActions appeal(String token, long record, String reason) throws Exception {
        return perform(post("/api/records/" + record + "/appeals"), Map.of("reason", reason), token);
    }

    private ResultActions sanction(String token, long user, Map<String, Object> body) throws Exception {
        return perform(post("/api/admin/users/" + user + "/sanctions"), body, token);
    }

    private ResultActions upload(String token, long report, String name, byte[] bytes) throws Exception {
        return mvc.perform(multipart("/api/reports/" + report + "/evidences").file(new MockMultipartFile("file", name, "image/jpeg", bytes))
                .header("Authorization", "Bearer " + token));
    }

    private String participationStatus(Flow flow) {
        return jdbc.queryForObject("SELECT status FROM participations WHERE id = ?", String.class, flow.participation);
    }

    private String recordStatus(Flow flow) {
        return jdbc.queryForObject("SELECT status FROM activity_records WHERE id = ?", String.class, flow.record);
    }

    /** A real JPEG with an APP1 "Exif" segment carrying a fake GPS marker right after the start marker. */
    private static byte[] jpegWithExif() throws Exception {
        BufferedImage image = new BufferedImage(40, 30, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream plain = new ByteArrayOutputStream();
        ImageIO.write(image, "jpg", plain);
        byte[] jpeg = plain.toByteArray();
        byte[] payload = "Exif\0\0GPS-SECRET-SPOT 37.81 127.09".getBytes(StandardCharsets.ISO_8859_1);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(jpeg, 0, 2);
        out.write(0xFF); out.write(0xE1);
        int length = payload.length + 2;
        out.write(length >> 8); out.write(length & 0xFF);
        out.write(payload);
        out.write(jpeg, 2, jpeg.length - 2);
        return out.toByteArray();
    }

    private static byte[] bigPdf() {
        byte[] bytes = new byte[EvidenceService.MAX_BYTES + 1];
        System.arraycopy("%PDF-1.4".getBytes(StandardCharsets.US_ASCII), 0, bytes, 0, 8);
        return bytes;
    }
}
