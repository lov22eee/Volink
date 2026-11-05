package com.volink.notification;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class NotificationController {
    private final NotificationService notifications;
    private final PushService push;

    public NotificationController(NotificationService notifications, PushService push) {
        this.notifications = notifications;
        this.push = push;
    }

    public record PushToken(String token, String platform) {}

    /** The app sends its Firebase token after the person allows notifications (and again when it changes). */
    @PutMapping("/api/me/push-token")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void pushToken(@AuthenticationPrincipal Jwt jwt, @RequestBody PushToken body) {
        push.register(Long.parseLong(jwt.getSubject()), body.token(), body.platform());
    }

    @PostMapping("/api/me/push-token/remove")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removePushToken(@AuthenticationPrincipal Jwt jwt, @RequestBody PushToken body) {
        push.unregister(Long.parseLong(jwt.getSubject()), body.token());
    }

    @GetMapping("/api/me/notifications")
    public Map<String, Object> mine(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "false") boolean unread) {
        long user = Long.parseLong(jwt.getSubject());
        List<Map<String, Object>> items = notifications.mine(user, unread);
        return Map.of("items", items, "unread", notifications.unread(user));
    }

    /** Notification center (app): pages of 20, a category chip, grouped new applications, unread counts per chip. */
    @GetMapping("/api/me/notification-center")
    public Map<String, Object> center(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String category,
                                      @RequestParam(required = false) Long before, @RequestParam(defaultValue = "20") int size) {
        long user = Long.parseLong(jwt.getSubject());
        NotificationService.Page page = notifications.page(user, category == null || category.isBlank() || "ALL".equals(category) ? null : category, before, size);
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("items", page.items());
        body.put("next", page.next());
        body.put("unread", notifications.unreadCounts(user));
        return body;
    }

    public record ReadMany(List<Long> ids) {}

    /** A grouped row ("새 참가 신청 3건") is read as a whole. */
    @PostMapping("/api/notifications/read")
    public Map<String, Object> readMany(@AuthenticationPrincipal Jwt jwt, @org.springframework.web.bind.annotation.RequestBody ReadMany request) {
        return Map.of("read", notifications.readMany(Long.parseLong(jwt.getSubject()), request.ids()));
    }

    /** Phone notification (push) preferences; the in-app list keeps everything regardless. */
    @GetMapping("/api/me/notification-settings")
    public Map<String, Object> settings(@AuthenticationPrincipal Jwt jwt) {
        return notifications.settings(Long.parseLong(jwt.getSubject()));
    }

    @org.springframework.web.bind.annotation.PutMapping("/api/me/notification-settings")
    public Map<String, Object> saveSettings(@AuthenticationPrincipal Jwt jwt, @org.springframework.web.bind.annotation.RequestBody Map<String, Object> request) {
        return notifications.saveSettings(Long.parseLong(jwt.getSubject()), request);
    }

    @PostMapping("/api/notifications/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        notifications.read(Long.parseLong(jwt.getSubject()), id);
    }

    @PostMapping("/api/notifications/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void readAll(@AuthenticationPrincipal Jwt jwt) {
        notifications.readAll(Long.parseLong(jwt.getSubject()));
    }
}
