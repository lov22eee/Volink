package com.volink.admin;

import com.volink.common.ApiException;
import com.volink.common.Sql;
import com.volink.notification.PushSender;
import com.volink.participation.ParticipationScheduler;
import com.volink.volunteer.DataGoKrVolunteerApi;
import java.io.File;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * PC 관리자 콘솔 (2026-11-11): the action log, the overview numbers, the server status and member lookup.
 * Read only; every change still goes through the existing admin services, which write admin_actions.
 */
@Service
public class OpsService {
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final ObjectProvider<DataGoKrVolunteerApi> volunteer;
    private final ObjectProvider<PushSender> push;
    private final String uploadDir;
    private final String version;

    public OpsService(JdbcTemplate jdbc, Clock clock, ObjectProvider<DataGoKrVolunteerApi> volunteer, ObjectProvider<PushSender> push,
                      @Value("${volink.upload-dir:uploads}") String uploadDir, @Value("${VOLINK_VERSION:}") String version) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.volunteer = volunteer;
        this.push = push;
        this.uploadDir = uploadDir;
        this.version = version;
    }

    private LocalDateTime now() { return LocalDateTime.now(clock.withZone(ZoneId.of("Asia/Seoul"))); }

    /** 처리 기록: newest first, with the admin's name and a short label of what was handled. */
    public List<Map<String, Object>> actions(String type, int limit, boolean today) {
        String filter = type == null || type.isBlank() ? "" : " AND a.target_type = ?";
        String day = today ? " AND KST(a.created_at) >= ?" : "";
        List<Object> args = new ArrayList<>();
        if (!filter.isEmpty()) args.add(type.trim());
        if (today) args.add(now().toLocalDate().atStartOfDay());
        args.add(Math.max(1, Math.min(limit, 200)));
        return jdbc.queryForList(Sql.kst("""
                SELECT a.id, DATE_FORMAT(KST(a.created_at), '%Y-%m-%d %H:%i') AS at, u.display_name AS admin, a.target_type AS targetType,
                       a.target_id AS targetId, a.action, a.from_status AS fromStatus, a.to_status AS toStatus, a.reason,
                       CASE a.target_type
                         WHEN 'ORGANIZATION' THEN (SELECT o.name FROM organizations o WHERE o.id = a.target_id)
                         WHEN 'ACTIVITY' THEN (SELECT x.title FROM activities x WHERE x.id = a.target_id)
                         WHEN 'USER' THEN (SELECT COALESCE(x.community_nickname, x.display_name) FROM users x WHERE x.id = a.target_id)
                         WHEN 'PLACE' THEN (SELECT p.name FROM demo_places p WHERE p.id = a.target_id)
                         WHEN 'REPORT' THEN (SELECT CONCAT(r.target_type, ':', r.reason_type) FROM reports r WHERE r.id = a.target_id)
                         WHEN 'APPEAL' THEN (SELECT x.kind FROM appeals x WHERE x.id = a.target_id)
                         ELSE NULL END AS targetName
                FROM admin_actions a JOIN users u ON u.id = a.admin_id
                WHERE 1 = 1""" + filter + day + " ORDER BY a.id DESC LIMIT ?"), args.toArray());
    }

    /** 현황: members, open posts, weekly applications (12 weeks), attendance, institutions, processing speed, report reasons. */
    public Map<String, Object> overview() {
        LocalDateTime now = now();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("members", count("SELECT COUNT(*) FROM users WHERE role = 'USER' AND status <> 'WITHDRAWN'"));
        out.put("newMembers", count(Sql.kst("SELECT COUNT(*) FROM users WHERE role = 'USER' AND status <> 'WITHDRAWN' AND KST(created_at) >= ?"), now.minusDays(7)));
        out.put("recruiting", count("SELECT COUNT(*) FROM activities WHERE status = 'RECRUITING' AND starts_at > ?", now));
        out.put("recruitingInstitution", count("SELECT COUNT(*) FROM activities WHERE status = 'RECRUITING' AND starts_at > ? AND activity_type = 'INSTITUTION'", now));
        LocalDateTime monday = now.toLocalDate().minusDays(now.getDayOfWeek().getValue() - 1L).atStartOfDay();
        List<Map<String, Object>> weeks = new ArrayList<>();
        for (int i = 11; i >= 0; i--) {
            LocalDateTime from = monday.minusWeeks(i), to = from.plusWeeks(1);
            Map<String, Object> week = new LinkedHashMap<>();
            week.put("from", from.toLocalDate().toString());
            week.put("applications", count(Sql.kst("SELECT COUNT(*) FROM participations WHERE KST(created_at) >= ? AND KST(created_at) < ?"), from, to));
            weeks.add(week);
        }
        out.put("weeks", weeks);
        long here = count("SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id WHERE a.ends_at BETWEEN ? AND ? AND p.status IN ('CHECKED_IN', 'COMPLETED')", now.minusDays(30), now);
        long missed = count("SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id WHERE a.ends_at BETWEEN ? AND ? AND p.status = 'NO_SHOW' AND p.noshow_cleared = FALSE", now.minusDays(30), now);
        out.put("attended", here);
        out.put("noShows", missed);
        out.put("institutions", count("SELECT COUNT(*) FROM organizations WHERE status = 'APPROVED'"));
        out.put("institutionsPending", count("SELECT COUNT(*) FROM organizations WHERE status = 'PENDING'"));
        LocalDateTime month = now.minusDays(30);
        out.put("speed", List.of(
                speed("신고", Sql.kst("SELECT TIMESTAMPDIFF(MINUTE, KST(created_at), handled_at) FROM reports WHERE handled_at >= ?"), month),
                speed("이의", "SELECT TIMESTAMPDIFF(MINUTE, submitted_at, handled_at) FROM appeals WHERE handled_at >= ?", month),
                speed("활동 검토", Sql.kst("""
                        SELECT TIMESTAMPDIFF(MINUTE, x.created_at, MIN(a.created_at)) FROM admin_actions a JOIN activities x ON x.id = a.target_id
                        WHERE a.target_type = 'ACTIVITY' AND a.action IN ('APPROVE', 'REJECT') AND KST(a.created_at) >= ? GROUP BY x.id, x.created_at"""), month),
                speed("기관 확인", Sql.kst("SELECT TIMESTAMPDIFF(MINUTE, KST(created_at), reviewed_at) FROM organizations WHERE reviewed_at >= ?"), month)));
        out.put("reasons", jdbc.queryForList(Sql.kst("""
                SELECT reason_type AS reason, COUNT(*) AS total, COALESCE(SUM(status = 'ACTION_TAKEN'), 0) AS accepted
                FROM reports WHERE KST(created_at) >= ? GROUP BY reason_type ORDER BY total DESC LIMIT 6"""), month));
        return out;
    }

    private Map<String, Object> speed(String kind, String sql, Object arg) {
        List<Long> minutes = jdbc.queryForList(sql, Long.class, arg).stream().filter(m -> m != null && m >= 0).toList();
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("kind", kind);
        row.put("count", minutes.size());
        row.put("averageMinutes", minutes.isEmpty() ? null : Math.round(minutes.stream().mapToLong(Long::longValue).average().orElse(0)));
        row.put("longestMinutes", minutes.stream().mapToLong(Long::longValue).max().stream().boxed().findFirst().orElse(null));
        return row;
    }

    /** 서버 상태: database, scheduler, 1365 calls today, phone push, disk, memory, uptime and the deployed version. */
    public Map<String, Object> system() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("checkedAt", now().toString().substring(0, 19));
        out.put("version", version.isBlank() ? null : version.trim());
        out.put("startedAt", LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(ManagementFactory.getRuntimeMXBean().getStartTime()), ZoneId.of("Asia/Seoul")).toString().substring(0, 16));
        out.put("uptimeMinutes", ManagementFactory.getRuntimeMXBean().getUptime() / 60_000);
        Map<String, Object> db = new LinkedHashMap<>();
        try {
            long started = System.nanoTime();
            jdbc.queryForObject("SELECT 1", Integer.class);
            db.put("ok", true);
            db.put("millis", (System.nanoTime() - started) / 1_000_000);
            db.put("schema", jdbc.queryForList("SELECT version FROM flyway_schema_history WHERE success = TRUE ORDER BY installed_rank DESC LIMIT 1", String.class).stream().findFirst().orElse(null));
        } catch (RuntimeException failed) { db.put("ok", false); }
        out.put("database", db);
        LocalDateTime last = ParticipationScheduler.lastRun();
        Map<String, Object> scheduler = new LinkedHashMap<>();
        scheduler.put("lastRun", last == null ? null : last.toString().substring(0, 19));
        scheduler.put("secondsAgo", last == null ? null : Duration.between(last, now()).toSeconds());
        out.put("scheduler", scheduler);
        DataGoKrVolunteerApi api = volunteer.getIfAvailable();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("limit", 900);
        v.put("used", api == null ? null : api.usage().values().stream().mapToInt(Integer::intValue).max().orElse(0));
        out.put("volunteer1365", v);
        PushSender sender = push.getIfAvailable();
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("enabled", sender != null && sender.enabled());
        p.put("tokens", count("SELECT COUNT(*) FROM push_tokens"));
        out.put("push", p);
        File root = new File(uploadDir).getAbsoluteFile();
        File probe = root.exists() ? root : new File(".").getAbsoluteFile();
        Map<String, Object> disk = new LinkedHashMap<>();
        disk.put("totalBytes", probe.getTotalSpace());
        disk.put("freeBytes", probe.getUsableSpace());
        disk.put("photoBytes", size(root.toPath()));
        out.put("disk", disk);
        Runtime runtime = Runtime.getRuntime();
        out.put("memory", Map.of("usedBytes", runtime.totalMemory() - runtime.freeMemory(), "maxBytes", runtime.maxMemory()));
        return out;
    }

    private static long size(Path dir) {
        if (!Files.isDirectory(dir)) return 0;
        try (Stream<Path> files = Files.walk(dir)) {
            return files.filter(Files::isRegularFile).mapToLong(file -> { try { return Files.size(file); } catch (IOException e) { return 0; } }).sum();
        } catch (IOException e) { return 0; }
    }

    /** 회원 찾기: by e-mail, name or community nickname (at least 2 letters), newest first, 30 at most. */
    public List<Map<String, Object>> members(String q) {
        String words = q == null ? "" : q.trim();
        if (words.length() < 2) return List.of();
        String like = "%" + words.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        return jdbc.queryForList(Sql.kst("""
                SELECT u.id, u.display_name AS name, u.community_nickname AS nickname, u.email, u.member_type AS memberType, u.role, u.status,
                       DATE_FORMAT(KST(u.created_at), '%Y-%m-%d') AS joinedAt
                FROM users u WHERE u.status <> 'WITHDRAWN' AND (u.email LIKE ? OR u.display_name LIKE ? OR u.community_nickname LIKE ?)
                ORDER BY u.id DESC LIMIT 30"""), like, like, like);
    }

    /** One member: counts, sanctions, recent applications and the reports about them. */
    public Map<String, Object> member(long id) {
        Map<String, Object> out = new LinkedHashMap<>(jdbc.queryForList(Sql.kst("""
                SELECT u.id, u.display_name AS name, u.community_nickname AS nickname, u.email, u.member_type AS memberType, u.role, u.status,
                       DATE_FORMAT(KST(u.created_at), '%Y-%m-%d') AS joinedAt, o.name AS organizationName, o.status AS organizationStatus
                FROM users u LEFT JOIN organizations o ON o.manager_user_id = u.id WHERE u.id = ?"""), id).stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "회원을 찾을 수 없습니다.")));
        LocalDateTime now = now();
        out.put("completed", count("SELECT COUNT(*) FROM participations WHERE user_id = ? AND status IN ('CHECKED_IN', 'COMPLETED')", id));
        out.put("noShows90", count("SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id WHERE p.user_id = ? AND p.status = 'NO_SHOW' AND p.noshow_cleared = FALSE AND a.ends_at >= ?", id, now.minusDays(90)));
        out.put("hosted", count("SELECT COUNT(*) FROM activities WHERE organizer_id = ? AND status <> 'DELETED'", id));
        out.put("reportsAccepted", count("SELECT COUNT(*) FROM reports WHERE target_user_id = ? AND status = 'ACTION_TAKEN'", id));
        out.put("sanctions", jdbc.queryForList(Sql.kst("""
                SELECT id, type, scope, source, reason, DATE_FORMAT(starts_at, '%Y-%m-%d') AS startsAt, DATE_FORMAT(ends_at, '%Y-%m-%d') AS endsAt,
                       revoked_at IS NOT NULL AS revoked, (ends_at IS NULL OR ends_at > ?) AND revoked_at IS NULL AS active
                FROM sanctions WHERE user_id = ? ORDER BY id DESC LIMIT 20"""), now, id));
        out.put("participations", jdbc.queryForList("""
                SELECT p.id, a.title, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date, p.status
                FROM participations p JOIN activities a ON a.id = p.activity_id WHERE p.user_id = ? ORDER BY a.starts_at DESC LIMIT 10""", id));
        out.put("reports", jdbc.queryForList(Sql.kst("""
                SELECT id, target_type AS targetType, reason_type AS reason, status, DATE_FORMAT(KST(created_at), '%Y-%m-%d') AS at
                FROM reports WHERE target_user_id = ? ORDER BY id DESC LIMIT 10"""), id));
        return out;
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0 : value;
    }
}
