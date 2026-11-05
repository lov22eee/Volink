package com.volink.post;

import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 커뮤니티 (members only; the app shows it as a bottom tab). */
@RestController
public class CommunityController {
    private final CommunityService community;

    public CommunityController(CommunityService community) {
        this.community = community;
    }

    private static long user(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }

    @GetMapping("/api/community/posts")
    public List<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String category, @RequestParam(required = false) String sort) {
        return community.list(user(jwt), category, sort);
    }

    @GetMapping("/api/community/posts/{id}")
    public Map<String, Object> detail(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return community.detail(user(jwt), id);
    }

    @GetMapping("/api/community/reviewable")
    public List<Map<String, Object>> reviewable(@AuthenticationPrincipal Jwt jwt) {
        return community.reviewable(user(jwt));
    }

    @PostMapping("/api/community/posts")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@AuthenticationPrincipal Jwt jwt, @RequestBody CommunityService.PostRequest request) {
        return community.create(user(jwt), request);
    }

    @DeleteMapping("/api/community/posts/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        community.delete(user(jwt), id);
    }

    @PutMapping("/api/community/posts/{id}/like")
    public Map<String, Object> like(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return community.like(user(jwt), id, true);
    }

    @DeleteMapping("/api/community/posts/{id}/like")
    public Map<String, Object> unlike(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return community.like(user(jwt), id, false);
    }

    @PostMapping("/api/community/posts/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> comment(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody CommunityService.CommentRequest request) {
        return community.comment(user(jwt), id, request);
    }

    @DeleteMapping("/api/community/comments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteComment(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        community.deleteComment(user(jwt), id);
    }
}
