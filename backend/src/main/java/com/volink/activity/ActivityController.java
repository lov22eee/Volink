package com.volink.activity;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ActivityController {
    private final ActivityService activities;

    public ActivityController(ActivityService activities) {
        this.activities = activities;
    }

    @PostMapping("/api/activities")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@AuthenticationPrincipal Jwt jwt, @RequestBody ActivityRequest request) {
        return activities.create(Long.parseLong(jwt.getSubject()), request);
    }

    /** Organizer only (others 404): full edit while nobody has applied and before the start. */
    @PutMapping("/api/activities/{id}")
    public Map<String, Object> update(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody ActivityRequest request) {
        return activities.update(Long.parseLong(jwt.getSubject()), id, request);
    }

    public record NotesRequest(String description, String meetingPoint) {}

    /** Organizer only: description and meeting point, allowed after people applied. */
    @PatchMapping("/api/activities/{id}/notes")
    public Map<String, Object> updateNotes(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody NotesRequest request) {
        return activities.updateNotes(Long.parseLong(jwt.getSubject()), id, request.description(), request.meetingPoint());
    }

    @DeleteMapping("/api/activities/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        activities.delete(Long.parseLong(jwt.getSubject()), id);
    }

    /** Week 4: optional radius (lat, lng, radiusKm up to 20), date or from/to, category, type, q (words) and part (AM/PM). */
    @GetMapping("/api/activities")
    public List<Map<String, Object>> list(@RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng,
                                          @RequestParam(required = false) Double radiusKm, @RequestParam(required = false) String date,
                                          @RequestParam(required = false) String category, @RequestParam(required = false) String type,
                                          @RequestParam(required = false) String q, @RequestParam(required = false) String from,
                                          @RequestParam(required = false) String to, @RequestParam(required = false) String part) {
        return activities.listPublic(new ActivityService.Search(lat, lng, radiusKm, date, category, type, q, from, to, part));
    }

    @GetMapping("/api/activities/{id}")
    public Map<String, Object> detail(@PathVariable long id, @AuthenticationPrincipal Jwt jwt) {
        return activities.detail(id, jwt == null ? null : Long.parseLong(jwt.getSubject()));
    }

    @GetMapping("/api/me/activities")
    public List<Map<String, Object>> mine(@AuthenticationPrincipal Jwt jwt) {
        return activities.listMine(Long.parseLong(jwt.getSubject()));
    }
}
