package com.volink.notification;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class NotificationController {
    private final NotificationService notifications;

    public NotificationController(NotificationService notifications) {
        this.notifications = notifications;
    }

    @GetMapping("/api/me/notifications")
    public Map<String, Object> mine(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "false") boolean unread) {
        long user = Long.parseLong(jwt.getSubject());
        List<Map<String, Object>> items = notifications.mine(user, unread);
        return Map.of("items", items, "unread", notifications.unread(user));
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
