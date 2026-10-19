package com.volink.activity;

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

    /** Week 4: optional radius (lat, lng, radiusKm), date, category and type filters. */
    @GetMapping("/api/activities")
    public List<Map<String, Object>> list(@RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng,
                                          @RequestParam(required = false) Double radiusKm, @RequestParam(required = false) String date,
                                          @RequestParam(required = false) String category, @RequestParam(required = false) String type) {
        return activities.listPublic(new ActivityService.Search(lat, lng, radiusKm, date, category, type));
    }

    /** Member only: interest + distance + time score, with reasons. Must be declared before /{id}. */
    @GetMapping("/api/activities/recommended")
    public List<Map<String, Object>> recommended(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng) {
        if (jwt == null) throw new com.volink.common.ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "로그인이 필요합니다.");
        return activities.recommended(Long.parseLong(jwt.getSubject()), lat, lng);
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
