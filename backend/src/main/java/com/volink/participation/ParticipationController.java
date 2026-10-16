package com.volink.participation;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ParticipationController {
    private final ParticipationService participations;

    public ParticipationController(ParticipationService participations) {
        this.participations = participations;
    }

    public record Decision(String reason) {}

    @PostMapping("/api/activities/{id}/participations")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> apply(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return participations.apply(user(jwt), id);
    }

    /** Organizer only; other people's activities answer 404. */
    @GetMapping("/api/activities/{id}/participations")
    public Map<String, Object> applicants(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return participations.applicants(user(jwt), id);
    }

    @PostMapping("/api/participations/{id}/approve")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void approve(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        participations.approve(user(jwt), id);
    }

    @PostMapping("/api/participations/{id}/reject")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reject(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody(required = false) Decision decision) {
        participations.reject(user(jwt), id, decision == null ? null : decision.reason());
    }

    @PostMapping("/api/participations/{id}/cancel")
    public Map<String, Object> cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return participations.cancel(user(jwt), id);
    }

    @PostMapping("/api/participations/{id}/accept-offer")
    public Map<String, Object> accept(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return participations.acceptOffer(user(jwt), id);
    }

    @PostMapping("/api/participations/{id}/decline-offer")
    public Map<String, Object> decline(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return participations.declineOffer(user(jwt), id);
    }

    @GetMapping("/api/me/participations")
    public List<Map<String, Object>> mine(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String status) {
        return participations.mine(user(jwt), status);
    }

    /** Seat counts for everyone; the viewer's own participation when logged in. */
    @GetMapping("/api/activities/{id}/my-participation")
    public Map<String, Object> viewer(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return participations.viewer(id, jwt == null ? null : user(jwt));
    }

    private static long user(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
