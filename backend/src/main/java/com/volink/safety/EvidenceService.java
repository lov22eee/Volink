package com.volink.safety;

import com.volink.auth.TokenService;
import com.volink.common.ApiException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.imageio.ImageIO;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Report evidence: jpeg/png/pdf only, 10 MB, at most 3 per report. The real type is read from the file's first bytes
 * (the name and the browser's content type are not trusted). Images are re-encoded, which drops EXIF/GPS and other
 * metadata. Files are private; an admin opens one through a signed link that works for 5 minutes.
 */
@Service
public class EvidenceService {
    public static final int MAX_FILES = 3;
    public static final int MAX_BYTES = 10 * 1024 * 1024;
    public static final Duration LINK = Duration.ofMinutes(5);

    private final JdbcTemplate jdbc;
    private final EvidenceStorage storage;
    private final SecretKey key;
    private final Clock clock;

    public EvidenceService(JdbcTemplate jdbc, EvidenceStorage storage, TokenService tokens, Clock clock) {
        this.jdbc = jdbc;
        this.storage = storage;
        this.key = tokens.derive("evidence");
        this.clock = clock;
    }

    @Transactional
    public Map<String, Object> upload(long userId, long reportId, String filename, byte[] bytes) {
        Long reporter = jdbc.queryForList("SELECT reporter_id FROM reports WHERE id = ? FOR UPDATE", Long.class, reportId).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "신고를 찾을 수 없습니다."));
        if (reporter != userId) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "신고를 찾을 수 없습니다.");
        if (jdbc.queryForObject("SELECT COUNT(*) FROM report_evidences WHERE report_id = ?", Integer.class, reportId) >= MAX_FILES)
            throw ApiException.validation(Map.of("file", "증빙은 신고 1건에 최대 " + MAX_FILES + "개까지 올릴 수 있습니다."));
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES)
            throw ApiException.validation(Map.of("file", "파일은 10MB 이하여야 합니다."));
        String type = sniff(bytes);
        String extension = extension(filename);
        if (type == null || !matches(type, extension))
            throw ApiException.validation(Map.of("file", "jpg·png·pdf 파일만 올릴 수 있습니다."));
        byte[] clean = "application/pdf".equals(type) ? bytes : reencode(bytes, "image/png".equals(type) ? "png" : "jpg");
        String storageKey = storage.save(clean, "application/pdf".equals(type) ? "pdf" : "image/png".equals(type) ? "png" : "jpg");
        jdbc.update("INSERT INTO report_evidences(report_id, uploaded_by, storage_key, content_type, size_bytes) VALUES (?, ?, ?, ?, ?)",
                reportId, userId, storageKey, type, clean.length);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return Map.of("id", id, "contentType", type, "sizeBytes", clean.length);
    }

    /** Admin only (checked by the /api/admin path). A link to the file that stops working after 5 minutes. */
    public Map<String, Object> link(long reportId, long evidenceId) {
        if (jdbc.queryForObject("SELECT COUNT(*) FROM report_evidences WHERE id = ? AND report_id = ?", Integer.class, evidenceId, reportId) == 0)
            throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "증빙을 찾을 수 없습니다.");
        long expires = clock.instant().plus(LINK).getEpochSecond();
        return Map.of("url", signedPath(evidenceId, expires), "expiresAt", expires);
    }

    public String signedPath(long evidenceId, long expiresEpochSecond) {
        return "/api/evidence-files/" + evidenceId + "?exp=" + expiresEpochSecond + "&sig=" + sign(evidenceId + "." + expiresEpochSecond);
    }

    public record File(String contentType, byte[] bytes) {}

    public File open(long evidenceId, long expires, String signature) {
        boolean valid = signature != null && MessageDigest.isEqual(sign(evidenceId + "." + expires).getBytes(StandardCharsets.US_ASCII), signature.getBytes(StandardCharsets.US_ASCII));
        if (!valid) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "열람 링크가 올바르지 않습니다.");
        if (clock.instant().getEpochSecond() > expires) throw new ApiException(HttpStatus.GONE, "LINK_EXPIRED", "열람 링크가 만료되었습니다. 관리 화면에서 다시 열어 주세요.");
        Map<String, Object> row = jdbc.queryForList("SELECT storage_key, content_type FROM report_evidences WHERE id = ?", evidenceId).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "증빙을 찾을 수 없습니다."));
        return new File((String) row.get("content_type"), storage.read((String) row.get("storage_key")));
    }

    static String sniff(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return "image/jpeg";
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return "image/png";
        if (b.length >= 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-') return "application/pdf";
        return null;
    }

    private static String extension(String filename) {
        if (filename == null || filename.lastIndexOf('.') < 0) return "";
        return filename.substring(filename.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
    }

    private static boolean matches(String type, String extension) {
        return switch (type) {
            case "image/jpeg" -> extension.equals("jpg") || extension.equals("jpeg");
            case "image/png" -> extension.equals("png");
            case "application/pdf" -> extension.equals("pdf");
            default -> false;
        };
    }

    /** Decoding and encoding again keeps only the pixels: EXIF (GPS position, camera, time) and text chunks are gone. */
    static byte[] reencode(byte[] bytes, String format) {
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
            if (image == null) throw ApiException.validation(Map.of("file", "이미지를 읽을 수 없습니다."));
            if ("jpg".equals(format) && image.getColorModel().hasAlpha()) {
                BufferedImage rgb = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_RGB);
                rgb.createGraphics().drawImage(image, 0, 0, java.awt.Color.WHITE, null);
                image = rgb;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(image, format, out)) throw ApiException.validation(Map.of("file", "이미지를 저장할 수 없습니다."));
            return out.toByteArray();
        } catch (IOException e) {
            throw ApiException.validation(Map.of("file", "이미지를 읽을 수 없습니다."));
        }
    }

    private String sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
