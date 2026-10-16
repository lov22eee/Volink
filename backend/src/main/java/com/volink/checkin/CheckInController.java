package com.volink.checkin;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class CheckInController {
    private final CheckInService checkIns;

    public CheckInController(CheckInService checkIns) {
        this.checkIns = checkIns;
    }

    public record CheckInRequest(String qrToken, Double lat, Double lng) {}
    public record Reason(String reason) {}

    @GetMapping("/api/activities/{id}/qr")
    public Map<String, Object> qr(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return checkIns.qr(user(jwt), id);
    }

    @PostMapping("/api/activities/{id}/check-ins")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> checkIn(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody CheckInRequest request) {
        return checkIns.checkIn(user(jwt), id, request.qrToken(), request.lat(), request.lng());
    }

    @PostMapping("/api/participations/{id}/manual-check-in")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void manual(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody(required = false) Reason reason) {
        checkIns.manual(user(jwt), id, reason == null ? null : reason.reason());
    }

    @PostMapping("/api/participations/{id}/complete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void complete(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        checkIns.complete(user(jwt), id);
    }

    @GetMapping("/api/me/records")
    public List<Map<String, Object>> records(@AuthenticationPrincipal Jwt jwt) {
        return checkIns.records(user(jwt));
    }

    private static long user(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
