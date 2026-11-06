package com.volink.external;

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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 1365 activities in my records (V27): only the person's own rows; someone else's id is "not found". */
@RestController
public class ExternalRecordController {
    private final ExternalRecordService records;

    public ExternalRecordController(ExternalRecordService records) { this.records = records; }

    private static long user(Jwt jwt) { return Long.parseLong(jwt.getSubject()); }

    @GetMapping("/api/me/external")
    public List<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt) { return records.list(user(jwt)); }

    @GetMapping("/api/me/external/{id}")
    public Map<String, Object> one(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) { return records.one(user(jwt), id); }

    @PostMapping("/api/me/external")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@AuthenticationPrincipal Jwt jwt, @RequestBody ExternalRecordService.RecordRequest request) { return records.create(user(jwt), request); }

    /** Lab (실험실): rows picked from the person's own 1365 page. */
    @PostMapping("/api/me/external/import")
    public Map<String, Object> importRows(@AuthenticationPrincipal Jwt jwt, @RequestBody ExternalRecordService.ImportRequest request) { return records.importRows(user(jwt), request); }

    public record StatusRequest(String status) {}

    @PutMapping("/api/me/external/{id}/status")
    public Map<String, Object> status(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody StatusRequest request) { return records.status(user(jwt), id, request.status()); }

    @PutMapping("/api/me/external/{id}/certificate")
    public Map<String, Object> certificate(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody ExternalRecordService.CertificateRequest request) {
        return records.certificate(user(jwt), id, request);
    }

    @DeleteMapping("/api/me/external/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) { records.delete(user(jwt), id); }
}
