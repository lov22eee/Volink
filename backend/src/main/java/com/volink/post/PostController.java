package com.volink.post;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 활동 소식: notices and Q&A of one activity (organizer + confirmed participants). */
@RestController
public class PostController {
    private final PostService posts;

    public PostController(PostService posts) {
        this.posts = posts;
    }

    public record Body(String body, Boolean privately) {}

    @GetMapping("/api/activities/{id}/posts")
    public Map<String, Object> list(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return posts.list(user(jwt), id);
    }

    @PostMapping("/api/activities/{id}/notices")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> notice(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Body body) {
        return posts.notice(user(jwt), id, body.body());
    }

    @PostMapping("/api/activities/{id}/questions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> ask(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Body body) {
        return posts.ask(user(jwt), id, body.body(), Boolean.TRUE.equals(body.privately()));
    }

    @PostMapping("/api/activities/{id}/posts/seen")
    @org.springframework.web.bind.annotation.ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void seen(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        posts.seen(Long.parseLong(jwt.getSubject()), id);
    }

    @PostMapping("/api/activity-posts/{id}/answer")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> answer(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Body body) {
        return posts.answer(user(jwt), id, body.body());
    }

    @DeleteMapping("/api/activity-posts/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        posts.delete(user(jwt), id);
    }

    private static long user(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
