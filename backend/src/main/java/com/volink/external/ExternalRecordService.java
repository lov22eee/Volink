package com.volink.external;

import com.volink.common.ApiException;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 1365 activities in my own records (V27). Volink never sees 1365 itself: the person marks an application (SELF), or picks
 * rows read from their own 1365 page in the app lab (LAB). Times are Korean time like the rest of the server.
 * Trust shown to others: 본인 기록 (SELF/LAB), 실적확인서 있음 (certificate values entered) — never "verified by Volink".
 */
@Service
public class ExternalRecordService {
    static final int IMPORT_MAX = 20;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final NotificationService notifications;

    public ExternalRecordService(JdbcTemplate jdbc, Clock clock, NotificationService notifications) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.notifications = notifications;
    }

    public record RecordRequest(String programNo, String title, String organization, String place, String date, String startTime, String endTime, String labStatus) {}
    public record ImportRequest(List<RecordRequest> items) {}
    public record CertificateRequest(String title, String organization, String date, Integer minutes) {}
    public record Field(String name, Integer minutes) {}
    public record SummaryRequest(Integer totalMinutes, Integer count, List<Field> fields) {}

    private LocalDateTime now() { return LocalDateTime.now(clock); }

    private static String text(String value, int max) {
        String v = value == null ? "" : value.strip().replaceAll("\\s+", " ");
        return v.length() > max ? v.substring(0, max) : v;
    }

    private static LocalDate date(String value) {
        try { return value == null ? null : LocalDate.parse(value.strip()); } catch (DateTimeParseException e) { return null; }
    }

    private static LocalTime time(String value) {
        try { return value == null || value.isBlank() ? null : LocalTime.parse(value.strip()); } catch (DateTimeParseException e) { return null; }
    }

    /** "1365에서 신청했어요": one record. Same 1365 program on the same day twice is refused. */
    @Transactional
    public Map<String, Object> create(long userId, RecordRequest request) {
        long id = insert(userId, request, "SELF", true);
        return one(userId, id);
    }

    /** Lab: rows the person picked from their own 1365 page. Rows already in the list (same title and day) are skipped. */
    @Transactional
    public Map<String, Object> importRows(long userId, ImportRequest request) {
        List<RecordRequest> items = request == null || request.items() == null ? List.of() : request.items();
        if (items.isEmpty() || items.size() > IMPORT_MAX) throw ApiException.validation(Map.of("items", "가져올 활동을 1~" + IMPORT_MAX + "개 골라 주세요."));
        int added = 0;
        for (RecordRequest item : items) if (insert(userId, item, "LAB", false) > 0) added++;
        return Map.of("added", added, "items", list(userId));
    }

    private long insert(long userId, RecordRequest r, String source, boolean strict) {
        Map<String, String> errors = new LinkedHashMap<>();
        String title = text(r.title(), 255);
        if (title.length() < 2) errors.put("title", "활동 이름을 2자 이상 적어 주세요.");
        LocalDate day = date(r.date());
        LocalDate today = now().toLocalDate();
        // 2026-11-07: a certificate can be for an activity years ago (10 years back at most); planned ones up to a year ahead.
        if (day == null || day.isBefore(today.minusYears(10)) || day.isAfter(today.plusYears(1))) errors.put("date", "날짜를 확인해 주세요.");
        LocalTime start = time(r.startTime()), end = time(r.endTime());
        boolean timeKnown = start != null;
        if (start == null) start = LocalTime.of(9, 0);
        if (end == null || !end.isAfter(start)) end = start.plusHours(2).isAfter(start) ? start.plusHours(2) : LocalTime.of(23, 59);
        String program = text(r.programNo(), 20);
        if (!program.isEmpty() && !program.matches("[0-9A-Za-z-]+")) errors.put("programNo", "1365 활동 번호를 확인해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        LocalDateTime startsAt = day.atTime(start), endsAt = day.atTime(end);
        boolean exists = jdbc.queryForObject("""
                SELECT COUNT(*) FROM external_records WHERE user_id = ? AND DATE(starts_at) = ? AND (title = ? OR (program_no IS NOT NULL AND program_no = ?))""",
                Integer.class, userId, day, title, program) > 0;
        if (exists) {
            if (strict) throw new ApiException(HttpStatus.CONFLICT, "EXTERNAL_EXISTS", "이미 내 활동에 넣은 1365 활동이에요.");
            return 0;
        }
        jdbc.update("""
                INSERT INTO external_records(user_id, program_no, title, organization, place, starts_at, ends_at, time_known, status, source, lab_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", userId, program.isEmpty() ? null : program, title, emptyNull(text(r.organization(), 255)),
                emptyNull(text(r.place(), 255)), startsAt, endsAt, timeKnown, endsAt.isBefore(now()) && "LAB".equals(source) ? "ATTENDED" : "PLANNED", source,
                emptyNull(text(r.labStatus(), 40)));
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    private static String emptyNull(String value) { return value == null || value.isEmpty() ? null : value; }

    private static final String COLUMNS = """
            SELECT e.id, e.program_no AS programNo, e.title, e.organization, e.place, DATE_FORMAT(e.starts_at, '%Y-%m-%d') AS date,
                   DATE_FORMAT(e.starts_at, '%H:%i') AS startTime, DATE_FORMAT(e.ends_at, '%H:%i') AS endTime, e.status, e.source, e.lab_status AS labStatus,
                   e.cert_title AS certTitle, e.cert_org AS certOrganization, DATE_FORMAT(e.cert_date, '%Y-%m-%d') AS certDate, e.cert_minutes AS certMinutes,
                   e.cert_at IS NOT NULL AS certified, e.reflected_at IS NOT NULL AS reflected, e.time_known AS timeKnown, e.starts_at <= ? AS started,
                   (SELECT p.id FROM community_posts p WHERE p.external_id = e.id AND p.deleted_at IS NULL ORDER BY p.id DESC LIMIT 1) AS reviewId
            FROM external_records e""";

    public List<Map<String, Object>> list(long userId) {
        List<Map<String, Object>> rows = jdbc.queryForList(COLUMNS + " WHERE e.user_id = ? ORDER BY e.starts_at DESC, e.id DESC LIMIT 200", now(), userId);
        rows.forEach(ExternalRecordService::shape);
        return rows;
    }

    public Map<String, Object> one(long userId, long id) {
        Map<String, Object> row = jdbc.queryForList(COLUMNS + " WHERE e.user_id = ? AND e.id = ?", now(), userId, id).stream().findFirst().orElseThrow(ExternalRecordService::notFound);
        shape(row);
        return row;
    }

    private static void shape(Map<String, Object> row) {
        row.put("certified", truthy(row.get("certified")));
        row.put("started", truthy(row.get("started")));
        row.put("reflected", truthy(row.get("reflected")));
        row.put("timeKnown", truthy(row.get("timeKnown")));
    }

    private static boolean truthy(Object v) { return v instanceof Boolean b ? b : v instanceof Number n && n.intValue() != 0; }

    private static ApiException notFound() { return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "기록을 찾을 수 없습니다."); }

    private Map<String, Object> own(long userId, long id) {
        return jdbc.queryForList("SELECT id, starts_at, status FROM external_records WHERE id = ? AND user_id = ? FOR UPDATE", id, userId)
                .stream().findFirst().orElseThrow(ExternalRecordService::notFound);
    }

    /** 다녀왔어요 / 못 갔어요 (after it started), or back to 예정. */
    @Transactional
    public Map<String, Object> status(long userId, long id, String status) {
        Map<String, Object> row = own(userId, id);
        if (!List.of("PLANNED", "ATTENDED", "MISSED").contains(status)) throw ApiException.validation(Map.of("status", "상태를 골라 주세요."));
        if (!"PLANNED".equals(status) && ((LocalDateTime) row.get("starts_at")).isAfter(now()))
            throw new ApiException(HttpStatus.CONFLICT, "NOT_STARTED", "활동 날짜가 지나면 표시할 수 있어요.");
        jdbc.update("UPDATE external_records SET status = ? WHERE id = ?", status, id);
        return one(userId, id);
    }

    /** Values read from the 1365 certificate (the file itself never reaches the server). Marks the record as attended. */
    @Transactional
    public Map<String, Object> certificate(long userId, long id, CertificateRequest request) {
        own(userId, id);
        Map<String, String> errors = new LinkedHashMap<>();
        String title = text(request.title(), 255);
        if (title.length() < 2) errors.put("title", "활동 이름을 확인해 주세요.");
        LocalDate day = date(request.date());
        if (day == null || day.isAfter(now().toLocalDate())) errors.put("date", "실적 날짜를 확인해 주세요.");
        Integer minutes = request.minutes();
        // V31: a 확인서 may total a whole period (46 hours …), not one day.
        if (minutes == null || minutes < 1 || minutes > 99999) errors.put("minutes", "인정 시간을 확인해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        jdbc.update("UPDATE external_records SET cert_title = ?, cert_org = ?, cert_date = ?, cert_minutes = ?, cert_at = ?, status = 'ATTENDED' WHERE id = ?",
                title, emptyNull(text(request.organization(), 255)), day, minutes, now(), id);
        return one(userId, id);
    }

    @Transactional
    public void delete(long userId, long id) {
        own(userId, id);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM community_posts WHERE external_id = ?", Integer.class, id) > 0)
            throw new ApiException(HttpStatus.CONFLICT, "HAS_REVIEW", "후기가 연결된 기록은 지울 수 없어요.");
        jdbc.update("DELETE FROM external_records WHERE id = ?", id);
    }

    /** V29: how the person keeps 1365 activities — IMPORT (가져오기), MANUAL (직접 남기기) or null (not chosen yet). */
    public Map<String, Object> mode(long userId) {
        String mode = jdbc.queryForObject("SELECT ext_mode FROM users WHERE id = ?", String.class, userId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("mode", mode);
        return out;
    }

    @Transactional
    public Map<String, Object> setMode(long userId, String mode) {
        if (!List.of("IMPORT", "MANUAL").contains(String.valueOf(mode))) throw ApiException.validation(Map.of("mode", "방식을 골라 주세요."));
        jdbc.update("UPDATE users SET ext_mode = ? WHERE id = ?", mode, userId);
        return mode(userId);
    }

    /** Lab (V28): the person's 1365 total as read from their own 실적 page; replaces the previous one. */
    @Transactional
    public Map<String, Object> saveSummary(long userId, SummaryRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        Integer total = request == null ? null : request.totalMinutes();
        if (total == null || total < 0 || total > 600_000) errors.put("totalMinutes", "봉사 시간을 확인해 주세요.");
        Integer count = request == null ? null : request.count();
        if (count != null && (count < 0 || count > 100_000)) errors.put("count", "봉사 건수를 확인해 주세요.");
        List<Field> fields = request == null || request.fields() == null ? List.of() : request.fields();
        if (fields.size() > 20) errors.put("fields", "분야는 20개까지예요.");
        List<Map<String, Object>> clean = new java.util.ArrayList<>();
        for (Field f : fields) {
            String name = text(f.name(), 20);
            if (name.isEmpty() || f.minutes() == null || f.minutes() < 0 || f.minutes() > 600_000) { errors.put("fields", "분야별 시간을 확인해 주세요."); break; }
            clean.add(Map.of("name", name, "minutes", f.minutes()));
        }
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        List<Integer> last = jdbc.queryForList("SELECT activity_count FROM external_summaries WHERE user_id = ? FOR UPDATE", Integer.class, userId);
        Integer before = last.isEmpty() ? null : last.get(0);
        String json;
        try { json = JSON.writeValueAsString(clean); } catch (Exception e) { throw new IllegalStateException(e); }
        jdbc.update("INSERT INTO external_summaries(user_id, total_minutes, activity_count, fields, fetched_at) VALUES (?, ?, ?, ?, ?) "
                + "ON DUPLICATE KEY UPDATE total_minutes = VALUES(total_minutes), activity_count = VALUES(activity_count), fields = VALUES(fields), fetched_at = VALUES(fetched_at)",
                userId, total, count, json, now());
        // More activities than last time: that many past 1365 records still waiting (oldest first) become "실적 반영됨(추정)".
        int reflected = 0;
        if (before != null && count != null && count > before)
            reflected = jdbc.update("""
                    UPDATE external_records SET reflected_at = ?, status = 'ATTENDED'
                    WHERE user_id = ? AND ends_at <= ? AND reflected_at IS NULL AND cert_at IS NULL AND status = 'PLANNED'
                    ORDER BY starts_at, id LIMIT ?""", now(), userId, now(), count - before);
        Map<String, Object> out = new LinkedHashMap<>(summary(userId));
        out.put("before", before);
        out.put("reflected", reflected);
        return out;
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    /** The saved 1365 total, or {} when there is none. */
    public Map<String, Object> summary(long userId) {
        return jdbc.queryForList("SELECT total_minutes AS totalMinutes, activity_count AS count, CAST(fields AS CHAR) AS fields, "
                + "DATE_FORMAT(fetched_at, '%Y-%m-%d %H:%i') AS fetchedAt FROM external_summaries WHERE user_id = ?", userId).stream().findFirst().map(row -> {
            Map<String, Object> out = new LinkedHashMap<>(row);
            try { out.put("fields", JSON.readValue(String.valueOf(row.get("fields")), List.class)); } catch (Exception e) { out.put("fields", List.of()); }
            return out;
        }).orElse(Map.of());
    }

    @Transactional
    public void deleteSummary(long userId) {
        jdbc.update("DELETE FROM external_summaries WHERE user_id = ?", userId);
    }

    /**
     * Every minute (with the activity scheduler): within 24 hours before the start "1365 봉사가 곧 있어요", and from 2 hours
     * after the end (for a week) "다녀왔어요?". Each once per record (dedupe key).
     */
    public int remind() {
        LocalDateTime now = now();
        int sent = 0;
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT id, user_id, title, DATE_FORMAT(starts_at, '%H:%i') AS t FROM external_records
                WHERE status = 'PLANNED' AND starts_at > ? AND starts_at <= ?""", now, now.plusHours(24))) {
            long id = ((Number) row.get("id")).longValue();
            notifications.send(((Number) row.get("user_id")).longValue(), "EXT_DAY_BEFORE", "1365 봉사가 곧 있어요", row.get("title") + " · " + row.get("t")
                    + " 시작 · 신청 상태는 1365에서 확인해 주세요.", "#/record/" + id, null, "EXT_DAY_BEFORE:" + id);
            sent++;
        }
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT e.id, e.user_id, e.title FROM external_records e JOIN users u ON u.id = e.user_id
                WHERE e.status = 'PLANNED' AND e.ends_at <= ? AND e.ends_at > ? AND (u.ext_mode IS NULL OR u.ext_mode <> 'IMPORT')""", now.minusHours(2), now.minusDays(7))) {
            long id = ((Number) row.get("id")).longValue();
            notifications.send(((Number) row.get("user_id")).longValue(), "EXT_CHECK", "1365 봉사 다녀왔어요?", row.get("title")
                    + " · 다녀왔다고 남기면 내 발자취에 쌓이고 후기를 쓸 수 있어요.", "#/record/" + id, null, "EXT_CHECK:" + id);
            sent++;
        }
        // IMPORT (V29): 3 days after the activity, "1365 실적 새로고침해 볼까요?" (1365 needs a few days to show it), once per record.
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT e.id, e.user_id, e.title FROM external_records e JOIN users u ON u.id = e.user_id
                WHERE u.ext_mode = 'IMPORT' AND e.status = 'PLANNED' AND e.reflected_at IS NULL AND e.cert_at IS NULL
                  AND e.ends_at <= ? AND e.ends_at > ?""", now.minusDays(3), now.minusDays(10))) {
            long id = ((Number) row.get("id")).longValue();
            notifications.send(((Number) row.get("user_id")).longValue(), "EXT_REFRESH", "1365 실적 새로고침해 볼까요?", row.get("title")
                    + " · 1365에 실적이 올라왔는지 가져와서 맞춰 봐요.", "#/lab1365", null, "EXT_REFRESH:" + id);
            sent++;
        }
        // IMPORT: once a month (daytime) when the last import is over 30 days old (not before the first import), for activities done outside Volink.
        if (now.getHour() >= 10 && now.getHour() < 20) {
            String month = now.toLocalDate().toString().substring(0, 7);
            for (Map<String, Object> row : jdbc.queryForList("""
                    SELECT u.id FROM users u JOIN external_summaries s ON s.user_id = u.id
                    WHERE u.ext_mode = 'IMPORT' AND s.fetched_at <= ?""", now.minusDays(30))) {
                long user = ((Number) row.get("id")).longValue();
                notifications.send(user, "EXT_REFRESH", "이번 달 1365 실적을 맞춰 볼까요?", "1365에서 한 봉사가 있다면 가져와서 함께한 시간에 더해요.",
                        "#/lab1365", null, "EXT_MONTH:" + user + ":" + month);
                sent++;
            }
        }
        return sent;
    }

}
