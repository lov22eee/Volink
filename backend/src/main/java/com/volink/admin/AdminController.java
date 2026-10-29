package com.volink.admin;

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

/** /api/admin/** is restricted to ROLE_ADMIN in SecurityConfig. */
@RestController
public class AdminController {
    private final AdminService admin;

    public AdminController(AdminService admin) {
        this.admin = admin;
    }

    public record Decision(String reason) {}

    @GetMapping("/api/admin/organizations")
    public List<Map<String, Object>> organizations(@RequestParam(defaultValue = "PENDING") String status) {
        return admin.organizations(status);
    }

    @PostMapping("/api/admin/organizations/{id}/approve")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void approveOrganization(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody(required = false) Decision decision) {
        admin.reviewOrganization(id(jwt), id, true, decision == null ? null : decision.reason());
    }

    @PostMapping("/api/admin/organizations/{id}/reject")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void rejectOrganization(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody(required = false) Decision decision) {
        admin.reviewOrganization(id(jwt), id, false, decision == null ? null : decision.reason());
    }

    /** Dashboard line: applications per day (KST) and current status totals. Admin only, like every /api/admin/** path. */
    @GetMapping("/api/admin/stats/applications")
    public Map<String, Object> applicationStats(@RequestParam(defaultValue = "14") int days) {
        return admin.applicationStats(days);
    }

    @GetMapping("/api/admin/activities")
    public List<Map<String, Object>> activities() {
        return admin.reviewActivities();
    }

    @PostMapping("/api/admin/activities/{id}/approve")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void approveActivity(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody(required = false) Decision decision) {
        admin.reviewActivity(id(jwt), id, true, decision == null ? null : decision.reason());
    }

    @PostMapping("/api/admin/activities/{id}/reject")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void rejectActivity(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody(required = false) Decision decision) {
        admin.reviewActivity(id(jwt), id, false, decision == null ? null : decision.reason());
    }

    private static long id(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
