package com.volink.safety;

import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** Week 7: 신고 · 사진 · 이의신청 · 이용 상태, and the admin's 신고함 / 이의함. */
@RestController
public class SafetyController {
    private final PhotoService photos;
    private final ReportService reports;
    private final AppealService appeals;
    private final PenaltyService penalties;

    public SafetyController(PhotoService photos, ReportService reports, AppealService appeals, PenaltyService penalties) {
        this.photos = photos;
        this.reports = reports;
        this.appeals = appeals;
        this.penalties = penalties;
    }

    private static long user(Jwt jwt) { return Long.parseLong(jwt.getSubject()); }

    @PostMapping(value = "/api/photos", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> upload(@AuthenticationPrincipal Jwt jwt, @RequestParam("file") MultipartFile file) {
        return photos.upload(user(jwt), file);
    }

    /** A community photo by its random key (no login: an image tag cannot send the token; the key cannot be guessed). */
    @GetMapping("/api/photos/{key}")
    public ResponseEntity<byte[]> photo(@PathVariable String key) {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).cacheControl(CacheControl.noStore()).body(photos.read(key));
    }

    @PostMapping("/api/reports")
    public Map<String, Object> report(@AuthenticationPrincipal Jwt jwt, @RequestBody ReportService.ReportRequest request) {
        return reports.create(user(jwt), request);
    }

    @GetMapping("/api/me/reports")
    public List<Map<String, Object>> myReports(@AuthenticationPrincipal Jwt jwt) {
        return reports.mine(user(jwt));
    }

    @GetMapping("/api/me/status")
    public Map<String, Object> status(@AuthenticationPrincipal Jwt jwt) {
        return penalties.status(user(jwt));
    }

    /** 경고 시트 (V38): the newest warning not yet confirmed, or {} when there is none. */
    @GetMapping("/api/me/safety-notice")
    public Map<String, Object> safetyNotice(@AuthenticationPrincipal Jwt jwt) {
        Map<String, Object> notice = penalties.pendingNotice(user(jwt));
        return notice == null ? Map.of() : notice;
    }

    @PostMapping("/api/me/safety-notice/{id}/ack")
    public Map<String, Object> ackSafetyNotice(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        penalties.ackNotice(user(jwt), id);
        return Map.of("ok", true);
    }

    @PostMapping("/api/appeals")
    public Map<String, Object> appeal(@AuthenticationPrincipal Jwt jwt, @RequestBody AppealService.AppealRequest request) {
        return appeals.create(user(jwt), request);
    }

    @GetMapping("/api/activities/{id}/appeals")
    public List<Map<String, Object>> activityAppeals(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return appeals.forActivity(user(jwt), id);
    }

    @PostMapping("/api/appeals/{id}/answer")
    public Map<String, Object> answer(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody AppealService.HostAnswer answer) {
        return appeals.hostAnswer(user(jwt), id, answer);
    }

    // ---- admin (/api/admin/** is ADMIN only) ----

    @GetMapping("/api/admin/reports")
    public List<Map<String, Object>> reportQueue(@RequestParam(required = false) String status) {
        return reports.queue(status);
    }

    @PostMapping("/api/admin/reports/{id}/decision")
    public Map<String, Object> decideReport(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody ReportService.Decision decision) {
        return reports.decide(user(jwt), id, decision);
    }

    @GetMapping("/api/admin/evidences/{id}")
    public ResponseEntity<byte[]> evidence(@PathVariable long id) {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).cacheControl(CacheControl.noStore()).body(photos.evidence(id));
    }

    @GetMapping("/api/admin/appeals")
    public List<Map<String, Object>> appealQueue(@RequestParam(required = false) String status) {
        return appeals.queue(status);
    }

    @PostMapping("/api/admin/appeals/{id}/decision")
    public Map<String, Object> decideAppeal(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody AppealService.Decision decision) {
        return appeals.decide(user(jwt), id, decision);
    }
}
