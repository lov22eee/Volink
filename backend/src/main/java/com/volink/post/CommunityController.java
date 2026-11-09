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

    @GetMapping("/api/community/me")
    public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
        return community.profile(user(jwt));
    }

    /** First visit: nickname + rules; later: nickname change (once in 30 days). */
    @PutMapping("/api/community/me")
    public Map<String, Object> setMe(@AuthenticationPrincipal Jwt jwt, @RequestBody CommunityService.ProfileRequest request) {
        return community.setProfile(user(jwt), request);
    }

    @GetMapping("/api/community/posts")
    public List<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(required = false) String category, @RequestParam(required = false) String sort,
                                          @RequestParam(required = false) String q, @RequestParam(required = false) Long activity) {
        return community.list(user(jwt), category, sort, q, activity);
    }

    @GetMapping("/api/community/posts/{id}")
    public Map<String, Object> detail(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return community.detail(user(jwt), id);
    }

    /** 봉사 홍보 (week 7): my recruiting activities and whether each already has its introduction post. */
    @GetMapping("/api/community/promotable")
    public List<Map<String, Object>> promotable(@AuthenticationPrincipal Jwt jwt) {
        return community.promotable(user(jwt));
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

    @PutMapping("/api/community/posts/{id}")
    public Map<String, Object> edit(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody CommunityService.EditRequest request) {
        return community.edit(user(jwt), id, request);
    }

    @PutMapping("/api/community/comments/{id}")
    public Map<String, Object> editComment(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody CommunityService.CommentRequest request) {
        return community.editComment(user(jwt), id, request);
    }

    @DeleteMapping("/api/community/comments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteComment(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        community.deleteComment(user(jwt), id);
    }
}
