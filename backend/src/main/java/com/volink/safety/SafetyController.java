package com.volink.safety;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Reports, evidence, appeals and sanctions. /api/admin/** is ADMIN only (SecurityConfig). */
@RestController
public class SafetyController {
    private final ReportService reports;
    private final EvidenceService evidences;
    private final AppealService appeals;
    private final SanctionService sanctions;

    public SafetyController(ReportService reports, EvidenceService evidences, AppealService appeals, SanctionService sanctions) {
        this.reports = reports;
        this.evidences = evidences;
        this.appeals = appeals;
        this.sanctions = sanctions;
    }

    public record Reason(String reason) {}
    public record Resolution(String action, String reason) {}

    @PostMapping("/api/reports")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> report(@AuthenticationPrincipal Jwt jwt, @RequestBody ReportService.ReportRequest request) {
        return reports.create(user(jwt), request);
    }

    @PostMapping("/api/reports/{id}/evidences")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> evidence(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestParam("file") MultipartFile file) throws IOException {
        return evidences.upload(user(jwt), id, file.getOriginalFilename(), file.getBytes());
    }

    @GetMapping("/api/me/reports")
    public List<Map<String, Object>> myReports(@AuthenticationPrincipal Jwt jwt) {
        return reports.mine(user(jwt));
    }

    @GetMapping("/api/admin/reports")
    public List<Map<String, Object>> adminReports(@RequestParam(required = false) String status) {
        return reports.list(status);
    }

    @PostMapping("/api/admin/reports/{id}/resolve")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resolve(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Resolution resolution) {
        reports.resolve(user(jwt), id, resolution.action(), resolution.reason());
    }

    @GetMapping("/api/admin/reports/{id}/evidences/{evidenceId}/url")
    public Map<String, Object> evidenceUrl(@PathVariable long id, @PathVariable long evidenceId) {
        return evidences.link(id, evidenceId);
    }

    /** Opened through the 5-minute signed link only (no login cookie is involved). */
    @GetMapping("/api/evidence-files/{id}")
    public ResponseEntity<byte[]> evidenceFile(@PathVariable long id, @RequestParam long exp, @RequestParam String sig) {
        EvidenceService.File file = evidences.open(id, exp, sig);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(file.contentType()))
                .cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", "inline").body(file.bytes());
    }

    @PostMapping("/api/records/{id}/appeals")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> appeal(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Reason reason) {
        return appeals.submit(user(jwt), id, reason.reason());
    }

    @GetMapping("/api/admin/appeals")
    public List<Map<String, Object>> adminAppeals() {
        return appeals.list();
    }

    @PostMapping("/api/admin/appeals/{id}/accept")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void accept(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Reason reason) {
        appeals.decide(user(jwt), id, true, reason.reason());
    }

    @PostMapping("/api/admin/appeals/{id}/reject")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reject(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Reason reason) {
        appeals.decide(user(jwt), id, false, reason.reason());
    }

    @GetMapping("/api/admin/users")
    public List<Map<String, Object>> users(@RequestParam String email) {
        return sanctions.search(email);
    }

    @PostMapping("/api/admin/users/{id}/sanctions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> sanction(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody SanctionService.SanctionRequest request) {
        return sanctions.sanction(user(jwt), id, request);
    }

    @GetMapping("/api/me/sanctions")
    public List<Map<String, Object>> mySanctions(@AuthenticationPrincipal Jwt jwt) {
        return sanctions.mine(user(jwt));
    }

    private static long user(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
