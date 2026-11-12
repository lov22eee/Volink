package com.volink.organization;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** 기관 확인 서류: the manager's own list, upload and delete; opening one (manager or admin). */
@RestController
public class OrganizationDocumentController {
    private final OrganizationDocumentService documents;

    public OrganizationDocumentController(OrganizationDocumentService documents) {
        this.documents = documents;
    }

    @GetMapping("/api/me/organization/documents")
    public List<Map<String, Object>> mine(@AuthenticationPrincipal Jwt jwt) {
        return documents.mine(id(jwt));
    }

    @PostMapping(value = "/api/me/organization/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> upload(@AuthenticationPrincipal Jwt jwt, @RequestParam("file") MultipartFile file) {
        return documents.upload(id(jwt), file);
    }

    @DeleteMapping("/api/me/organization/documents/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        documents.delete(id(jwt), id);
    }

    @GetMapping("/api/org-documents/{id}")
    public ResponseEntity<byte[]> open(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        boolean admin = "ADMIN".equals(jwt.getClaimAsString("role"));
        OrganizationDocumentService.File file = documents.open(id(jwt), admin, id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.type()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(file.name(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .cacheControl(CacheControl.noStore())
                .body(file.bytes());
    }

    private static long id(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
