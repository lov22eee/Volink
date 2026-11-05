package com.volink.activity;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 저장한 봉사 (week 6 app): bookmarks of public activities, visible only to their owner. */
@RestController
public class SavedController {
    private final JdbcTemplate jdbc;
    private final ActivityService activities;

    public SavedController(JdbcTemplate jdbc, ActivityService activities) {
        this.jdbc = jdbc;
        this.activities = activities;
    }

    /** Saved activities that are still visible (not deleted, cancelled or hidden), newest first. */
    @GetMapping("/api/me/saved")
    public List<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt) {
        return jdbc.queryForList(ActivityService.SELECT + " JOIN saved_activities s ON s.activity_id = a.id WHERE s.user_id = ? AND a.status IN ('RECRUITING', 'IN_PROGRESS', 'FINISHED') ORDER BY s.created_at DESC",
                Long.parseLong(jwt.getSubject()));
    }

    @PutMapping("/api/me/saved/{activityId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void save(@AuthenticationPrincipal Jwt jwt, @PathVariable long activityId) {
        long userId = Long.parseLong(jwt.getSubject());
        activities.detail(activityId, userId); // 404 when the person cannot see it
        jdbc.update("INSERT IGNORE INTO saved_activities(user_id, activity_id) VALUES (?, ?)", userId, activityId);
    }

    @DeleteMapping("/api/me/saved/{activityId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@AuthenticationPrincipal Jwt jwt, @PathVariable long activityId) {
        jdbc.update("DELETE FROM saved_activities WHERE user_id = ? AND activity_id = ?", Long.parseLong(jwt.getSubject()), activityId);
    }
}
