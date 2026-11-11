package com.volink.safety;

import com.volink.common.ApiException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 커뮤니티 사진 · 신고 증빙 (week 7, 2026-11-09). A photo is checked to be a real JPEG/PNG, shrunk to 1600px and written again
 * as JPEG, so the camera's metadata (location, device) never stays. Files live on the server's own disk under
 * {@code volink.upload-dir}; the database keeps only a random key. A post photo is shown by its key (unguessable); a report
 * photo is moved out of reach of that address and only admins can open it.
 */
@Service
public class PhotoService {
    public static final int MAX_BYTES = 5 * 1024 * 1024, MAX_SIDE = 1600, PER_POST = 5, PER_REPORT = 3;
    private final JdbcTemplate jdbc;
    private final Path root;

    public PhotoService(JdbcTemplate jdbc, @Value("${volink.upload-dir:uploads}") String dir) {
        this.jdbc = jdbc;
        this.root = Path.of(dir).toAbsolutePath();
    }

    /** One upload: the person's own, not yet on a post or report. */
    @Transactional
    public Map<String, Object> upload(long userId, MultipartFile file) {
        if (file == null || file.isEmpty()) throw ApiException.validation(Map.of("file", "사진을 골라 주세요."));
        if (file.getSize() > 15L * 1024 * 1024) throw ApiException.validation(Map.of("file", "사진은 15MB 이하만 올릴 수 있어요."));
        int today = jdbc.queryForObject("SELECT COUNT(*) FROM post_photos WHERE owner_id = ? AND created_at > NOW() - INTERVAL 1 DAY", Integer.class, userId);
        if (today >= 60) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_PHOTOS", "사진은 하루에 60장까지 올릴 수 있어요.");
        byte[] clean;
        BufferedImage image;
        try {
            byte[] raw = file.getBytes();
            if (!jpeg(raw) && !png(raw)) throw ApiException.validation(Map.of("file", "JPG·PNG 사진만 올릴 수 있어요."));
            image = ImageIO.read(new ByteArrayInputStream(raw));
            if (image == null) throw ApiException.validation(Map.of("file", "사진을 읽지 못했어요."));
            image = shrink(image);
            clean = encode(image);
        } catch (IOException broken) {
            throw ApiException.validation(Map.of("file", "사진을 읽지 못했어요."));
        }
        if (clean.length > MAX_BYTES) throw ApiException.validation(Map.of("file", "사진이 너무 커요."));
        String key = UUID.randomUUID().toString().replace("-", "") + ".jpg";
        write(key, clean);
        jdbc.update("INSERT INTO post_photos(owner_id, storage_key, width, height, size_bytes) VALUES (?, ?, ?, ?, ?)",
                userId, key, image.getWidth(), image.getHeight(), clean.length);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return Map.of("id", id, "url", "/api/photos/" + key, "width", image.getWidth(), "height", image.getHeight());
    }

    /** The person's own loose uploads (not yet attached), in the order given; at most {@code max}. */
    public List<Map<String, Object>> loose(long userId, List<Long> ids, int max) {
        if (ids == null || ids.isEmpty()) return List.of();
        List<Long> distinct = ids.stream().distinct().toList();
        if (distinct.size() > max) throw ApiException.validation(Map.of("photoIds", "사진은 " + max + "장까지 올릴 수 있어요."));
        return distinct.stream().map(id -> jdbc.queryForList("SELECT id, storage_key AS storageKey, size_bytes AS sizeBytes FROM post_photos WHERE id = ? AND owner_id = ? AND post_id IS NULL", id, userId)
                .stream().findFirst().orElseThrow(() -> ApiException.validation(Map.of("photoIds", "사진을 다시 올려 주세요.")))).toList();
    }

    public void attach(long userId, long postId, List<Long> ids) {
        List<Map<String, Object>> photos = loose(userId, ids, PER_POST);
        for (int i = 0; i < photos.size(); i++)
            jdbc.update("UPDATE post_photos SET post_id = ?, position = ? WHERE id = ?", postId, i, photos.get(i).get("id"));
    }

    /** Report evidence: moved from the shown photos into the report (no public address any more). */
    public void toEvidence(long userId, long reportId, List<Long> ids) {
        for (Map<String, Object> photo : loose(userId, ids, PER_REPORT)) {
            String key = (String) photo.get("storageKey");
            String hidden = "e-" + key;
            try { Files.move(root.resolve(key), root.resolve(hidden)); } catch (IOException e) { throw new IllegalStateException(e); }
            jdbc.update("INSERT INTO report_evidences(report_id, storage_key, content_type, size_bytes) VALUES (?, ?, 'image/jpeg', ?)", reportId, hidden, photo.get("sizeBytes"));
            jdbc.update("DELETE FROM post_photos WHERE id = ?", photo.get("id"));
        }
    }

    public List<Map<String, Object>> ofPost(long postId) {
        return jdbc.queryForList("SELECT id, CONCAT('/api/photos/', storage_key) AS url, width, height FROM post_photos WHERE post_id = ? AND hidden = FALSE ORDER BY position, id", postId);
    }

    /** A shown photo by its key (post photos only, not hidden). */
    public byte[] read(String key) {
        if (key == null || !key.matches("[0-9a-f]{32}\\.jpg")) throw notFound();
        Integer shown = jdbc.queryForObject("SELECT COUNT(*) FROM post_photos WHERE storage_key = ? AND hidden = FALSE", Integer.class, key);
        if (shown == 0) throw notFound();
        return bytes(key);
    }

    /** A report photo, for admins only (checked by the caller's route). */
    public byte[] evidence(long id) {
        String key = jdbc.queryForList("SELECT storage_key FROM report_evidences WHERE id = ?", String.class, id).stream().findFirst().orElseThrow(PhotoService::notFound);
        return bytes(key);
    }

    /** A post's photos go with it (post deleted or the member withdrew). */
    public void deleteOfPost(long postId) {
        for (String key : jdbc.queryForList("SELECT storage_key FROM post_photos WHERE post_id = ?", String.class, postId)) {
            try { Files.deleteIfExists(root.resolve(key)); } catch (IOException ignored) { /* the row goes anyway */ }
        }
        jdbc.update("DELETE FROM post_photos WHERE post_id = ?", postId);
    }

    private byte[] bytes(String key) {
        try { return Files.readAllBytes(root.resolve(key)); } catch (IOException e) { throw notFound(); }
    }

    private void write(String key, byte[] data) {
        try {
            Files.createDirectories(root);
            Files.write(root.resolve(key), data);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "UPLOAD_FAILED", "사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        }
    }

    private static boolean jpeg(byte[] b) { return b.length > 3 && (b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8 && (b[2] & 0xff) == 0xff; }
    private static boolean png(byte[] b) { return b.length > 8 && (b[0] & 0xff) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'; }

    private static BufferedImage shrink(BufferedImage in) {
        int w = in.getWidth(), h = in.getHeight();
        double scale = Math.min(1.0, (double) MAX_SIDE / Math.max(w, h));
        int nw = Math.max(1, (int) Math.round(w * scale)), nh = Math.max(1, (int) Math.round(h * scale));
        BufferedImage out = new BufferedImage(nw, nh, BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = out.createGraphics();
        g.setColor(java.awt.Color.WHITE);
        g.fillRect(0, 0, nw, nh);
        g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(in, 0, 0, nw, nh, null);
        g.dispose();
        return out;
    }

    /** A fresh JPEG: pixels only, so no EXIF (GPS, camera) is written. */
    private static byte[] encode(BufferedImage image) throws IOException {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ImageWriteParam param = writer.getDefaultWriteParam();
        param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
        param.setCompressionQuality(0.85f);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (var stream = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(stream);
            writer.write(null, new IIOImage(image, null, null), param);
        } finally {
            writer.dispose();
        }
        return out.toByteArray();
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "사진을 찾을 수 없어요.");
    }
}
