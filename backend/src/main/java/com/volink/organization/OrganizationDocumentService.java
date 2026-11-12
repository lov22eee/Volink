package com.volink.organization;

import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 기관 확인 서류 (2026-11-12, 선택): PDF·JPG·PNG, 10MB each, 3 per organization. Only the organization's manager adds them
 * (while the check is waiting or was rejected) and only that manager and admins open them. The file type is checked from
 * its first bytes, not its name; files sit under {@code volink.upload-dir} with a random name.
 */
@Service
public class OrganizationDocumentService {
    public static final int MAX_BYTES = 10 * 1024 * 1024, PER_ORG = 3;
    private final JdbcTemplate jdbc;
    private final Path root;

    public OrganizationDocumentService(JdbcTemplate jdbc, @Value("${volink.upload-dir:uploads}") String dir) {
        this.jdbc = jdbc;
        this.root = Path.of(dir).toAbsolutePath();
    }

    private Map<String, Object> ownOrganization(long userId) {
        return jdbc.queryForList("SELECT id, status FROM organizations WHERE manager_user_id = ?", userId).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "NOT_ORGANIZATION", "기관 담당자만 서류를 올릴 수 있어요."));
    }

    public List<Map<String, Object>> list(long organizationId) {
        return jdbc.queryForList(Sql.kst("""
                SELECT id, original_name AS name, content_type AS type, size_bytes AS size, DATE_FORMAT(KST(created_at), '%Y-%m-%d %H:%i') AS at
                FROM organization_documents WHERE organization_id = ? ORDER BY id
                """), organizationId);
    }

    public List<Map<String, Object>> mine(long userId) {
        return list(((Number) ownOrganization(userId).get("id")).longValue());
    }

    @Transactional
    public Map<String, Object> upload(long userId, MultipartFile file) {
        Map<String, Object> org = ownOrganization(userId);
        long orgId = ((Number) org.get("id")).longValue();
        String status = (String) org.get("status");
        if (!"PENDING".equals(status) && !"REJECTED".equals(status))
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "확인이 끝난 기관은 서류를 더 올리지 않아도 돼요.");
        jdbc.queryForList("SELECT id FROM organizations WHERE id = ? FOR UPDATE", orgId);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM organization_documents WHERE organization_id = ?", Integer.class, orgId);
        if (count != null && count >= PER_ORG) throw ApiException.validation(Map.of("file", "서류는 " + PER_ORG + "개까지 올릴 수 있어요."));
        if (file == null || file.isEmpty()) throw ApiException.validation(Map.of("file", "파일을 골라 주세요."));
        if (file.getSize() > MAX_BYTES) throw ApiException.validation(Map.of("file", "파일은 10MB 이하만 올릴 수 있어요."));
        byte[] raw;
        try { raw = file.getBytes(); } catch (IOException e) { throw ApiException.validation(Map.of("file", "파일을 읽지 못했어요.")); }
        String type = typeOf(raw);
        if (type == null) throw ApiException.validation(Map.of("file", "PDF·JPG·PNG 파일만 올릴 수 있어요."));
        String key = "d-" + UUID.randomUUID().toString().replace("-", "") + (type.endsWith("pdf") ? ".pdf" : type.endsWith("png") ? ".png" : ".jpg");
        try {
            Files.createDirectories(root);
            Files.write(root.resolve(key), raw);
        } catch (IOException e) {
            throw new IllegalStateException("could not save the document", e);
        }
        jdbc.update("INSERT INTO organization_documents(organization_id, storage_key, original_name, content_type, size_bytes) VALUES (?, ?, ?, ?, ?)",
                orgId, key, name(file.getOriginalFilename(), type), type, raw.length);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return list(orgId).stream().filter(d -> ((Number) d.get("id")).longValue() == id).findFirst().orElseThrow();
    }

    @Transactional
    public void delete(long userId, long documentId) {
        long orgId = ((Number) ownOrganization(userId).get("id")).longValue();
        String key = jdbc.queryForList("SELECT storage_key FROM organization_documents WHERE id = ? AND organization_id = ?", String.class, documentId, orgId)
                .stream().findFirst().orElseThrow(OrganizationDocumentService::notFound);
        jdbc.update("DELETE FROM organization_documents WHERE id = ?", documentId);
        try { Files.deleteIfExists(root.resolve(key)); } catch (IOException ignored) { /* the row is gone either way */ }
    }

    public record File(String name, String type, byte[] bytes) {}

    /** Opens a document: its organization's manager, or an admin. Anyone else gets "not found". */
    public File open(long userId, boolean admin, long documentId) {
        Map<String, Object> row = jdbc.queryForList("""
                SELECT d.storage_key AS k, d.original_name AS n, d.content_type AS t, o.manager_user_id AS m
                FROM organization_documents d JOIN organizations o ON o.id = d.organization_id WHERE d.id = ?
                """, documentId).stream().findFirst().orElseThrow(OrganizationDocumentService::notFound);
        if (!admin && ((Number) row.get("m")).longValue() != userId) throw notFound();
        try {
            return new File((String) row.get("n"), (String) row.get("t"), Files.readAllBytes(root.resolve((String) row.get("k"))));
        } catch (IOException e) {
            throw notFound();
        }
    }

    static String typeOf(byte[] b) {
        if (b.length > 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F') return "application/pdf";
        if (b.length > 3 && (b[0] & 0xff) == 0xFF && (b[1] & 0xff) == 0xD8 && (b[2] & 0xff) == 0xFF) return "image/jpeg";
        if (b.length > 8 && (b[0] & 0xff) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "image/png";
        return null;
    }

    /** The name the person gave, without folders or odd characters, at most 100 letters, with the right ending. */
    static String name(String given, String type) {
        String ext = type.endsWith("pdf") ? ".pdf" : type.endsWith("png") ? ".png" : ".jpg";
        String n = given == null ? "" : given.replaceAll(".*[/\\\\]", "").replaceAll("[\\p{Cntrl}<>:\"|?*]", "").trim();
        if (n.isEmpty()) n = "기관 서류" + ext;
        if (n.length() > 100) n = n.substring(0, 100);
        return n;
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "서류를 찾을 수 없어요.");
    }
}
