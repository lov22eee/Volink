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

    /** Week 3: open activities only. Radius/date/category search arrives in week 4. */
    @GetMapping("/api/activities")
    public List<Map<String, Object>> list() {
        return activities.listPublic();
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
