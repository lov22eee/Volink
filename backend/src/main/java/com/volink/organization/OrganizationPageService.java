package com.volink.organization;

import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 기관 공개 페이지 (2026-11-11): an approved institution's name, type, area, a short introduction, what it has run,
 * its open posts and reviews from people who took part. No contact details.
 */
@Service
public class OrganizationPageService {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public OrganizationPageService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public Map<String, Object> page(long id) {
        Map<String, Object> out = new LinkedHashMap<>(jdbc.queryForList("""
                SELECT id, name, org_type AS orgType, address, intro, vms_registered AS vmsRegistered FROM organizations WHERE id = ? AND status = 'APPROVED'""", id)
                .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "기관을 찾을 수 없어요.")));
        LocalDateTime now = LocalDateTime.now(clock.withZone(ZoneId.of("Asia/Seoul")));
        out.put("hosted", count("SELECT COUNT(*) FROM activities WHERE organization_id = ? AND status IN ('RECRUITING', 'IN_PROGRESS', 'FINISHED')", id));
        out.put("people", count("SELECT COUNT(DISTINCT p.user_id) FROM participations p JOIN activities a ON a.id = p.activity_id WHERE a.organization_id = ? AND p.status IN ('CHECKED_IN', 'COMPLETED')", id));
        long here = count("SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id WHERE a.organization_id = ? AND a.status = 'FINISHED' AND p.status IN ('CHECKED_IN', 'COMPLETED')", id);
        long missed = count("SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id WHERE a.organization_id = ? AND a.status = 'FINISHED' AND p.status = 'NO_SHOW' AND p.noshow_cleared = FALSE", id);
        out.put("attendance", here + missed == 0 ? null : Math.round(here * 100.0 / (here + missed)));
        out.put("recruiting", jdbc.queryForList("""
                SELECT a.id, a.title, c.name AS category, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date, DATE_FORMAT(a.starts_at, '%H:%i') AS startTime, a.capacity,
                       (SELECT COUNT(*) FROM participations p WHERE p.activity_id = a.id AND p.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')) AS confirmed
                FROM activities a JOIN categories c ON c.id = a.category_id
                WHERE a.organization_id = ? AND a.status = 'RECRUITING' AND a.starts_at > ? ORDER BY a.starts_at LIMIT 20""", id, now));
        out.put("reviews", jdbc.queryForList(Sql.kst("""
                SELECT p.id, p.title, COALESCE(u.community_nickname, '회원') AS author, a.title AS activityTitle, DATE_FORMAT(KST(p.created_at), '%Y-%m-%d') AS date
                FROM community_posts p JOIN activities a ON a.id = p.activity_id JOIN users u ON u.id = p.author_id
                WHERE a.organization_id = ? AND p.category = 'REVIEW' AND p.deleted_at IS NULL AND p.hidden_at IS NULL ORDER BY p.id DESC LIMIT 6"""), id));
        return out;
    }

    /** The manager edits the introduction (300 letters, no contact details). */
    public Map<String, Object> intro(long userId, String raw) {
        Long id = jdbc.queryForList("SELECT id FROM organizations WHERE manager_user_id = ? AND status = 'APPROVED'", Long.class, userId).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "확인된 기관 담당자만 고칠 수 있어요."));
        String intro = raw == null ? "" : raw.trim();
        if (intro.length() > 300) throw ApiException.validation(Map.of("intro", "소개는 300자 이내로 적어 주세요."));
        if (com.volink.post.PostService.CONTACT.matcher(intro).find()) throw ApiException.validation(Map.of("intro", "소개에는 연락처를 적을 수 없어요."));
        jdbc.update("UPDATE organizations SET intro = ? WHERE id = ?", intro.isEmpty() ? null : intro, id);
        return page(id);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0 : value;
    }
}
