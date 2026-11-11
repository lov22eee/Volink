package com.volink.organization;

import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrganizationPageController {
    private final OrganizationPageService pages;

    public OrganizationPageController(OrganizationPageService pages) {
        this.pages = pages;
    }

    public record Intro(String intro) {}

    /** Public (no login): only approved institutions. */
    @GetMapping("/api/organizations/{id}")
    public Map<String, Object> page(@PathVariable long id) {
        return pages.page(id);
    }

    @PutMapping("/api/me/organization/intro")
    public Map<String, Object> intro(@AuthenticationPrincipal Jwt jwt, @RequestBody Intro body) {
        return pages.intro(Long.parseLong(jwt.getSubject()), body == null ? null : body.intro());
    }
}
