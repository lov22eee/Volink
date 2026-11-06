package com.volink.notification;

import com.volink.ApiTestSupport;
import com.volink.FakeExternal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Phone push (V20): token registration, push after a saved notification, settings respected, gone tokens removed. */
class PushIntegrationTest extends ApiTestSupport {
    @Autowired FakeExternal.Push push;

    /** A copy taken under the list's lock: pushes arrive from another thread while a test reads. */
    private List<String> sent() {
        synchronized (push.sent) { return new java.util.ArrayList<>(push.sent); }
    }

    private List<String> sentTo(String token) throws InterruptedException {
        for (int i = 0; i < 40; i++) {
            List<String> mine = sent().stream().filter(s -> s.startsWith(token + "|")).toList();
            if (!mine.isEmpty()) return mine;
            Thread.sleep(50);
        }
        return List.of();
    }

    @Test
    void anApplicationPushesToTheOrganizersPhoneAfterItIsSaved() throws Exception {
        String host = token(member("GENERAL"));
        String phone = "fcm-host-" + System.nanoTime();
        perform(put("/api/me/push-token"), Map.of("token", phone, "platform", "ANDROID"), host).andExpect(status().isNoContent());
        perform(put("/api/me/push-token"), Map.of("token", " "), host).andExpect(status().isBadRequest());
        // Quiet hours are on by default (22:00-08:00); off here so the test does not depend on the time it runs.
        perform(put("/api/me/notification-settings"), Map.of("quiet", false), host).andExpect(status().isOk());
        long activity = createActivity(activity("푸시 확인 활동", "신청이 오면 모집자 휴대폰으로 알림이 가는지 보는 활동이에요."), host);

        perform(post("/api/activities/" + activity + "/participations"), Map.of(), token(member("GENERAL"))).andExpect(status().isCreated());
        List<String> sent = sentTo(phone);
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0)).contains("새 참가 신청").endsWith("/" + activity);
    }

    @Test
    void settingsQuietHoursAndGoneTokens() throws Exception {
        String email = member("GENERAL");
        String me = token(email);
        long id = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
        String phone = "fcm-me-" + System.nanoTime();
        perform(put("/api/me/push-token"), Map.of("token", phone), me).andExpect(status().isNoContent());
        // The same token signed in by someone else moves to them.
        String other = token(member("GENERAL"));
        perform(put("/api/me/push-token"), Map.of("token", phone), other).andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("SELECT user_id FROM push_tokens WHERE token = ?", Long.class, phone)).isNotEqualTo(id);
        perform(put("/api/me/push-token"), Map.of("token", phone), me).andExpect(status().isNoContent());

        PushService service = push();
        // All push off: nothing.
        perform(put("/api/me/notification-settings"), Map.of("push", false), me).andExpect(status().isOk());
        service.deliver(id, "APPLY", "테스트", "끈 상태", "#/notifications");
        assertThat(push.sent.stream().anyMatch(s -> s.startsWith(phone + "|"))).isFalse();
        // On again: sent.
        perform(put("/api/me/notification-settings"), Map.of("push", true, "quiet", false), me).andExpect(status().isOk());
        service.deliver(id, "APPLY", "테스트", "켠 상태", "#/notifications");
        assertThat(push.sent.stream().filter(s -> s.startsWith(phone + "|"))).hasSize(1);
        // Firebase says the app is gone: the token is deleted.
        push.gone.add(phone);
        service.deliver(id, "APPLY", "테스트", "없는 앱", "#/notifications");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_tokens WHERE token = ?", Integer.class, phone)).isZero();
        // Sign-out removes this phone's token.
        String second = "fcm-out-" + System.nanoTime();
        perform(put("/api/me/push-token"), Map.of("token", second), me).andExpect(status().isNoContent());
        perform(post("/api/me/push-token/remove"), Map.of("token", second), me).andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM push_tokens WHERE token = ?", Integer.class, second)).isZero();
    }

    @Autowired PushService pushService;
    private PushService push() { return pushService; }

    @Autowired NotificationService notifications;

    @Test
    void aRepeatedDedupeKeyIsPushedOnce() throws Exception {
        String email = member("GENERAL");
        String me = token(email);
        long id = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
        String phone = "fcm-once-" + System.nanoTime();
        perform(put("/api/me/push-token"), Map.of("token", phone), me).andExpect(status().isNoContent());
        perform(put("/api/me/notification-settings"), Map.of("push", true, "quiet", false), me).andExpect(status().isOk());
        // The scheduler runs every minute: the same monthly reminder must reach the phone once, not every minute.
        for (int i = 0; i < 3; i++) notifications.send(id, "EXT_REFRESH", "이번 달 1365 실적을 맞춰 볼까요?", "본문", "#/lab1365", null, "EXT_MONTH:" + id + ":2026-11");
        assertThat(sentTo(phone)).hasSize(1);
        Thread.sleep(600);
        assertThat(sent().stream().filter(s -> s.startsWith(phone + "|"))).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'EXT_REFRESH'", Integer.class, id)).isEqualTo(1);
    }
}
