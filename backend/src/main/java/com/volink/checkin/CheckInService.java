package com.volink.checkin;

import com.volink.common.ApiException;
import com.volink.notification.NotificationService;
import com.volink.place.PlaceService;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Week 6: QR + time + location check-in, manual check-in with a reason, completion records and no-shows (plan 6.2 ③④).
 * The coordinates a participant sends are used for one distance calculation and never stored or logged:
 * only "inside the radius" is kept. Check-in lowers the chance of fake attendance; it is not proof.
 *
 * How an activity runs: nobody presses "start". The scheduler opens check-in 30 minutes before the start (and tells the
 * confirmed people and the organizer), turns the activity IN_PROGRESS at the start time and FINISHED at the end. On site
 * the organizer shows a QR that changes every 30 seconds; each participant scans it with their own phone, which sends
 * the QR value and one position reading. If that fails, the organizer checks the person in by hand with a reason.
 */
@Service
public class CheckInService {
    /**
     * The organizer can open attendance ([출석 시작]) from WINDOW before the start to WINDOW before the end (2026-11-08);
     * QR / code check-in works from that moment until WINDOW before the end.
     */
    public static final Duration WINDOW = Duration.ofMinutes(30);
    /** The organizer's screen shows a new QR this often, so a scanned code always has at least half its 60 seconds left. */
    public static final Duration ROTATE = Duration.ofSeconds(30);
    /** A phone's reported GPS error is forgiven up to this much on top of the radius (never more). */
    public static final int GPS_SLACK_M = 50;
    /** The organizer is reminded of unanswered applications once, this long before the start. */
    public static final Duration PENDING_REMINDER = Duration.ofHours(24);

    private final JdbcTemplate jdbc;
    private final QrService qr;
    private final NotificationService notifications;
    private final Clock clock;

    public CheckInService(JdbcTemplate jdbc, QrService qr, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.qr = qr;
        this.notifications = notifications;
        this.clock = clock;
    }

    record Activity(long id, long organizerId, String title, String status, LocalDateTime startsAt, LocalDateTime endsAt, LocalDateTime openedAt) {
        String link() { return "#/activity/" + id; }
    }

    /** Organizer only. A fresh 60-second QR value; the screen asks again before it runs out. */
    public Map<String, Object> qr(long organizerId, long activityId) {
        Activity activity = load(activityId, false);
        if (activity.organizerId() != organizerId) throw notFound("활동을 찾을 수 없습니다.");
        LocalDateTime now = now();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("opensAt", activity.startsAt().minus(WINDOW).toString());
        result.put("closesAt", activity.endsAt().minus(WINDOW).toString());
        boolean open = inWindow(activity, now);
        result.put("opened", activity.openedAt() != null);
        result.put("openedAt", activity.openedAt() == null ? null : activity.openedAt().toString());
        result.put("canStart", canStart(activity, now));
        result.put("open", open);
        result.put("token", open ? qr.issue(activityId) : null);
        result.put("code", open ? qr.code(activityId, qr.slot()) : null);
        result.put("codeSecondsLeft", qr.codeSecondsLeft());
        result.put("validSeconds", QrService.VALID.getSeconds());
        result.put("rotateSeconds", ROTATE.getSeconds());
        // Live attendance for the organizer's on-site screen.
        Map<String, Object> counts = jdbc.queryForMap("""
                SELECT COALESCE(SUM(status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')), 0) AS expected,
                       COALESCE(SUM(status IN ('CHECKED_IN', 'COMPLETED')), 0) AS checkedIn,
                       COALESCE(SUM(status = 'CHECKED_IN'), 0) AS toComplete
                FROM participations WHERE activity_id = ?""", activityId);
        result.put("expected", ((Number) counts.get("expected")).intValue());
        result.put("checkedIn", ((Number) counts.get("checkedIn")).intValue());
        result.put("toComplete", ((Number) counts.get("toComplete")).intValue());
        result.put("status", activity.status());
        return result;
    }

    public Map<String, Object> checkIn(long userId, long activityId, String token, Double lat, Double lng, Double accuracy) {
        return checkIn(userId, activityId, token, null, lat, lng, accuracy);
    }

    /** Wrong attendance codes allowed per person in CODE_WINDOW before code entry is blocked. */
    public static final int CODE_TRIES = 5;
    public static final Duration CODE_WINDOW = Duration.ofMinutes(10);

    /**
     * QR value or 4-digit code (one of the two). A wrong code is logged even though the request fails
     * (noRollbackFor), so guessing is limited; nothing else is written before the checks pass.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED, noRollbackFor = ApiException.class)
    public Map<String, Object> checkIn(long userId, long activityId, String token, String code, Double lat, Double lng, Double accuracy) {
        Activity activity = load(activityId, true);
        Map<String, Object> participation = jdbc.queryForList("SELECT id, status FROM participations WHERE activity_id = ? AND user_id = ? FOR UPDATE", activityId, userId)
                .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "참가가 확정된 사람만 체크인할 수 있습니다."));
        String status = (String) participation.get("status");
        if ("CHECKED_IN".equals(status) || "COMPLETED".equals(status)) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "이미 체크인했습니다.");
        if (!"CONFIRMED".equals(status)) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "참가가 확정된 사람만 체크인할 수 있습니다.");
        LocalDateTime now = now();
        if (activity.openedAt() == null && List.of("RECRUITING", "IN_PROGRESS").contains(activity.status()) && !now.isAfter(activity.endsAt().minus(WINDOW)))
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_NOT_STARTED", "모집자가 아직 출석을 시작하지 않았어요. 시작하면 알림으로 알려 드려요.");
        if (!inWindow(activity, now))
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_OUT_OF_TIME", "체크인은 모집자가 출석을 시작한 뒤 종료 30분 전까지 할 수 있습니다.");
        long participationId = ((Number) participation.get("id")).longValue();
        boolean byCode = (token == null || token.isBlank()) && code != null;
        if (byCode) {
            int wrong = jdbc.queryForObject("SELECT COUNT(*) FROM activity_logs WHERE participation_id = ? AND to_status = 'CODE_WRONG' AND created_at > NOW() - INTERVAL 10 MINUTE",
                    Integer.class, participationId);
            if (wrong >= CODE_TRIES)
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "CODE_LOCKED", "출석 코드를 여러 번 틀렸어요. 잠시 뒤 다시 하거나 QR을 찍어 주세요. 모집자에게 수동 확인을 요청할 수도 있어요.");
            if (!qr.checkCode(code, activityId)) {
                log(activityId, participationId, userId, "CONFIRMED", "CODE_WRONG", "출석 코드 틀림");
                throw new ApiException(HttpStatus.BAD_REQUEST, "CODE_INVALID", "출석 코드가 맞지 않아요. 모집자 화면의 지금 숫자를 입력해 주세요. (" + (CODE_TRIES - wrong - 1) + "번 더 할 수 있어요)");
            }
        } else switch (qr.check(token, activityId)) {
            case EXPIRED -> throw new ApiException(HttpStatus.GONE, "QR_EXPIRED", "QR이 만료되었습니다. 모집자 화면의 새 QR을 다시 찍어 주세요.");
            case INVALID -> throw new ApiException(HttpStatus.BAD_REQUEST, "QR_INVALID", "이 활동의 QR이 아닙니다.");
            case VALID -> { }
        }
        if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180)
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_OUT_OF_RANGE", "위치를 확인할 수 없습니다. 위치 권한을 허용하거나 모집자에게 수동 확인을 요청하세요.");
        Map<String, Object> distance = jdbc.queryForList("SELECT ST_Distance_Sphere(location, " + PlaceService.POINT + ") AS meters, checkin_radius_m AS radius FROM activity_locations WHERE activity_id = ?",
                PlaceService.wkt(lat, lng), activityId).stream().findFirst().orElse(null);
        if (distance == null)
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_OUT_OF_RANGE", "활동 장소 좌표가 없어 위치를 확인할 수 없습니다. 모집자에게 수동 확인을 요청하세요.");
        double meters = ((Number) distance.get("meters")).doubleValue();
        int radius = ((Number) distance.get("radius")).intValue();
        // Phones report how far off their reading may be; forgive that much, but never more than GPS_SLACK_M.
        double slack = accuracy == null || accuracy.isNaN() || accuracy < 0 ? 0 : Math.min(accuracy, GPS_SLACK_M);
        if (meters > radius + slack)
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_OUT_OF_RANGE", "활동 장소에서 약 " + Math.round(meters / 10) * 10 + "m 떨어져 있어요. "
                    + radius + "m 안에서 체크인할 수 있습니다. 장소에 도착한 뒤 다시 시도하거나 모집자에게 수동 확인을 요청하세요.");

        long id = participationId;
        String method = byCode ? "CODE" : "QR";
        jdbc.update("INSERT INTO check_ins(participation_id, method, within_radius, checked_by, checked_at) VALUES (?, ?, TRUE, ?, ?)", id, method, userId, now);
        jdbc.update("UPDATE participations SET status = 'CHECKED_IN', updated_at = ? WHERE id = ?", now, id);
        log(activityId, id, userId, "CONFIRMED", "CHECKED_IN", (byCode ? "출석 코드" : "QR") + "·시간·위치 확인");
        return Map.of("participationId", id, "status", "CHECKED_IN", "method", method, "checkedInAt", now.toString().substring(0, 16));
    }

    /**
     * Organizer, on site: [출석 시작]. Opens QR / code check-in and tells every confirmed participant once ("출석이 시작됐어요",
     * the link opens the camera). Pressing it again changes nothing.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> start(long organizerId, long activityId) {
        Activity activity = load(activityId, true);
        if (activity.organizerId() != organizerId) throw notFound("활동을 찾을 수 없습니다.");
        LocalDateTime now = now();
        if (activity.openedAt() != null) return Map.of("opened", true, "openedAt", activity.openedAt().toString(), "notified", 0);
        if (!canStart(activity, now))
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_OUT_OF_TIME", "출석은 시작 30분 전부터 종료 30분 전까지 시작할 수 있습니다.");
        jdbc.update("UPDATE activities SET checkin_opened_at = ? WHERE id = ?", now, activityId);
        log(activityId, null, organizerId, null, "CHECKIN_STARTED", "모집자가 출석 시작");
        List<Long> people = jdbc.queryForList("SELECT user_id FROM participations WHERE activity_id = ? AND status = 'CONFIRMED'", Long.class, activityId);
        for (long user : people)
            notifications.send(user, "CHECKIN_OPEN", "출석이 시작됐어요", activity.title() + " · 모집자 화면의 QR을 찍어 주세요. 누르면 카메라가 바로 열려요.",
                    "#/activity/" + activityId + "?scan=1", activityId, "CHECKIN_OPEN:" + activityId);
        return Map.of("opened", true, "openedAt", now.toString(), "notified", people.size());
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void manual(long organizerId, long participationId, String rawReason) {
        String reason = rawReason == null ? "" : rawReason.trim();
        if (reason.isEmpty()) throw ApiException.validation(Map.of("reason", "수동 확인 사유를 입력해 주세요. 예: 위치 권한 거부로 현장에서 얼굴 확인"));
        if (reason.length() > 500) throw ApiException.validation(Map.of("reason", "사유는 500자 이내로 입력해 주세요."));
        Activity activity = organizerActivity(organizerId, participationId);
        if (!"CONFIRMED".equals(status(participationId))) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "참가 확정 상태인 사람만 수동으로 확인할 수 있습니다.");
        LocalDateTime now = now();
        if (now.isBefore(activity.startsAt().minus(WINDOW)) || now.isAfter(activity.endsAt()))
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_OUT_OF_TIME", "수동 확인은 시작 30분 전부터 활동이 끝날 때까지 할 수 있습니다.");
        jdbc.update("INSERT INTO check_ins(participation_id, method, within_radius, reason, checked_by, checked_at) VALUES (?, 'MANUAL', NULL, ?, ?, ?)", participationId, reason, organizerId, now);
        jdbc.update("UPDATE participations SET status = 'CHECKED_IN', updated_at = ? WHERE id = ?", now, participationId);
        log(activity.id(), participationId, organizerId, "CONFIRMED", "CHECKED_IN", "수동 확인: " + reason);
        // The organizer checked them in by hand, so the participant is told (a QR check-in is their own action).
        long user = jdbc.queryForObject("SELECT user_id FROM participations WHERE id = ?", Long.class, participationId);
        notifications.send(user, "CHECKED_IN", "출석이 확인됐어요", activity.title() + " · 모집자가 현장에서 출석을 확인했어요.", "#/activity/" + activity.id(), activity.id(), "CHECKED_IN:" + participationId);
    }

    /** Several people at once with one reason (출석부 "여러 명 선택"). All or nothing. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> manualMany(long organizerId, long activityId, List<Long> participationIds, String reason) {
        if (participationIds == null || participationIds.isEmpty() || participationIds.size() > 10)
            throw ApiException.validation(Map.of("participationIds", "출석 처리할 사람을 1~10명 골라 주세요."));
        for (long id : participationIds) {
            Long activity = jdbc.queryForList("SELECT activity_id FROM participations WHERE id = ?", Long.class, id).stream().findFirst().orElse(null);
            if (activity == null || activity != activityId) throw notFound("신청을 찾을 수 없습니다.");
            manual(organizerId, id, reason);
        }
        return Map.of("checkedIn", participationIds.size());
    }

    /** After the end, only checked-in participants can be completed; this creates their activity record. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void complete(long organizerId, long participationId) {
        Activity activity = organizerActivity(organizerId, participationId);
        LocalDateTime now = now();
        if (now.isBefore(activity.endsAt())) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "활동이 끝난 뒤에 완료를 확인할 수 있습니다.");
        if (!"CHECKED_IN".equals(status(participationId))) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "체크인한 참가자만 완료할 수 있습니다.");
        completeOne(activity, organizerId, participationId, now);
    }

    /** After the end: every checked-in participant at once (the organizer's "모두 완료"). Returns how many were completed. */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> completeAll(long organizerId, long activityId) {
        Activity activity = load(activityId, true);
        if (activity.organizerId() != organizerId) throw notFound("활동을 찾을 수 없습니다.");
        LocalDateTime now = now();
        if (now.isBefore(activity.endsAt())) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "활동이 끝난 뒤에 완료를 확인할 수 있습니다.");
        List<Long> ids = jdbc.queryForList("SELECT id FROM participations WHERE activity_id = ? AND status = 'CHECKED_IN' ORDER BY id FOR UPDATE", Long.class, activityId);
        for (long id : ids) completeOne(activity, organizerId, id, now);
        return Map.of("completed", ids.size());
    }

    private void completeOne(Activity activity, long organizerId, long participationId, LocalDateTime now) {
        long checkIn = jdbc.queryForObject("SELECT id FROM check_ins WHERE participation_id = ?", Long.class, participationId);
        jdbc.update("INSERT INTO activity_records(participation_id, check_in_id, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?)", participationId, checkIn, organizerId, now);
        jdbc.update("UPDATE participations SET status = 'COMPLETED', updated_at = ? WHERE id = ?", now, participationId);
        log(activity.id(), participationId, organizerId, "CHECKED_IN", "COMPLETED", "모집자 완료 확인");
        long user = jdbc.queryForObject("SELECT user_id FROM participations WHERE id = ?", Long.class, participationId);
        notifications.send(user, "RECORD_CONFIRMED", "활동 기록이 만들어졌습니다", activity.title() + " · 내 활동 > 활동 기록에서 볼 수 있고 7일 안에 이의를 신청할 수 있습니다.", "#/mine", activity.id(), "RECORD:" + participationId);
        notifications.send(user, "REVIEW_INVITE", "활동 후기를 남겨 보세요", activity.title() + " · 커뮤니티 봉사후기에 경험을 나눠 주세요.", "#/activity/" + activity.id(), activity.id(), "REVIEW:" + participationId);
    }

    public List<Map<String, Object>> records(long userId) {
        return jdbc.queryForList("""
                SELECT r.id, a.id AS activityId, a.title, pl.name AS placeName, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date,
                       DATE_FORMAT(a.starts_at, '%H:%i') AS startTime, TIMESTAMPDIFF(MINUTE, a.starts_at, a.ends_at) AS durationMinutes,
                       c.method AS checkInMethod, DATE_FORMAT(r.confirmed_at, '%Y-%m-%dT%H:%i') AS confirmedAt,
                       DATE_FORMAT(DATE_ADD(r.confirmed_at, INTERVAL 7 DAY), '%Y-%m-%dT%H:%i') AS appealDeadline, r.status
                FROM activity_records r JOIN participations p ON p.id = r.participation_id JOIN activities a ON a.id = p.activity_id
                JOIN check_ins c ON c.id = r.check_in_id LEFT JOIN demo_places pl ON pl.id = a.place_id
                WHERE p.user_id = ? ORDER BY r.confirmed_at DESC, r.id DESC
                """, userId);
    }

    /**
     * Runs every minute. At the start: RECRUITING → IN_PROGRESS and unanswered applications/offers/waitlist → EXPIRED.
     * At the end: → FINISHED and confirmed people who never checked in → NO_SHOW.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public int advance() {
        LocalDateTime now = now();
        int changed = 0;
        // Reminder markers count only after the last RESCHEDULED log, so a moved activity gets its reminders again.
        // Once, 24 h before: the organizer still has applications to answer.
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT a.id, a.organizer_id, a.title, COUNT(p.id) AS pending FROM activities a JOIN participations p ON p.activity_id = a.id AND p.status = 'APPLIED'
                WHERE a.status = 'RECRUITING' AND a.starts_at > ? AND a.starts_at <= ?
                  AND NOT EXISTS (SELECT 1 FROM activity_logs l WHERE l.activity_id = a.id AND l.to_status = 'PENDING_REMINDED' AND l.id > COALESCE((SELECT MAX(r.id) FROM activity_logs r WHERE r.activity_id = a.id AND r.to_status = 'RESCHEDULED'), 0))
                GROUP BY a.id, a.organizer_id, a.title""", now, now.plus(PENDING_REMINDER))) {
            long id = ((Number) row.get("id")).longValue(), organizer = ((Number) row.get("organizer_id")).longValue();
            notifications.send(organizer, "PENDING_REMINDER", "승인을 기다리는 신청이 " + row.get("pending") + "건 있어요",
                    row.get("title") + " · 시작 전까지 승인하지 않으면 신청이 자동으로 마감됩니다.", "#/activity/" + id);
            log(id, null, organizer, null, "PENDING_REMINDED", "시작 24시간 전 승인 대기 안내");
        }
        // Once, the day before (24 h): confirmed people get the time, the meeting point and what to bring.
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT a.id, a.title, DATE_FORMAT(a.starts_at, '%H:%i') AS startTime, COALESCE(a.meeting_point, p.name, '') AS place FROM activities a
                LEFT JOIN demo_places p ON p.id = a.place_id
                WHERE a.status = 'RECRUITING' AND a.starts_at > ? AND a.starts_at <= ?
                  AND NOT EXISTS (SELECT 1 FROM activity_logs l WHERE l.activity_id = a.id AND l.to_status = 'DAY_BEFORE' AND l.id > COALESCE((SELECT MAX(r.id) FROM activity_logs r WHERE r.activity_id = a.id AND r.to_status = 'RESCHEDULED'), 0))""", now.plus(WINDOW), now.plus(PENDING_REMINDER))) {
            long id = ((Number) row.get("id")).longValue();
            Activity activity = load(id, false);
            for (long user : jdbc.queryForList("SELECT user_id FROM participations WHERE activity_id = ? AND status = 'CONFIRMED'", Long.class, id))
                notifications.send(user, "DAY_BEFORE", "내일 함께해요", row.get("title") + " · " + row.get("startTime") + " · " + row.get("place")
                        + ". 준비물을 확인하고, 못 오게 되면 미리 알려 주세요.", "#/activity/" + id);
            log(id, null, activity.organizerId(), null, "DAY_BEFORE", "하루 전 안내");
        }
        // Once, on the morning of the day (from 07:00, while check-in is not open yet): "오늘이에요" with time and place.
        LocalDateTime morning = now.toLocalDate().atTime(7, 0);
        if (!now.isBefore(morning)) for (Map<String, Object> row : jdbc.queryForList("""
                SELECT a.id, a.title, DATE_FORMAT(a.starts_at, '%H:%i') AS startTime, COALESCE(a.meeting_point, p.name, '') AS place FROM activities a
                LEFT JOIN demo_places p ON p.id = a.place_id
                WHERE a.status = 'RECRUITING' AND a.starts_at > ? AND a.starts_at < ?
                  AND NOT EXISTS (SELECT 1 FROM activity_logs l WHERE l.activity_id = a.id AND l.to_status = 'DAY_OF' AND l.id > COALESCE((SELECT MAX(r.id) FROM activity_logs r WHERE r.activity_id = a.id AND r.to_status = 'RESCHEDULED'), 0))""",
                now.plus(WINDOW), now.toLocalDate().plusDays(1).atStartOfDay())) {
            long id = ((Number) row.get("id")).longValue();
            Activity activity = load(id, false);
            for (long user : jdbc.queryForList("SELECT user_id FROM participations WHERE activity_id = ? AND status = 'CONFIRMED'", Long.class, id))
                notifications.send(user, "DAY_OF", "오늘 " + row.get("startTime") + " 봉사가 있어요", row.get("title") + " · " + row.get("place")
                        + ". 출발 전에 준비물을 한 번 더 확인해 주세요.", "#/activity/" + id);
            log(id, null, activity.organizerId(), null, "DAY_OF", "당일 아침 안내");
        }
        // Once, 30 min before the start: only the organizer ("출석을 시작할 수 있어요"); participants hear when it is opened (start()).
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT a.id, a.organizer_id, a.title FROM activities a
                WHERE a.status = 'RECRUITING' AND a.starts_at > ? AND a.starts_at <= ? AND a.checkin_opened_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM activity_logs l WHERE l.activity_id = a.id AND l.to_status = 'CHECKIN_OPENED' AND l.id > COALESCE((SELECT MAX(r.id) FROM activity_logs r WHERE r.activity_id = a.id AND r.to_status = 'RESCHEDULED'), 0))""", now, now.plus(WINDOW))) {
            long id = ((Number) row.get("id")).longValue(), organizer = ((Number) row.get("organizer_id")).longValue();
            notifications.send(organizer, "QR_TIME", "출석을 시작할 수 있어요", row.get("title")
                    + " · 현장에 도착하면 모집 관리 › 출석에서 [출석 시작]을 눌러 주세요. 종료 30분 전까지 열 수 있어요.", "#/manage/" + id + "?tab=attendance");
            log(id, null, organizer, null, "CHECKIN_OPENED", "출석 시작 안내(모집자)");
        }
        for (long id : jdbc.queryForList("SELECT id FROM activities WHERE status = 'RECRUITING' AND starts_at <= ? ORDER BY id", Long.class, now)) {
            Activity activity = load(id, true);
            if (!"RECRUITING".equals(activity.status())) continue;
            jdbc.update("UPDATE activities SET status = 'IN_PROGRESS' WHERE id = ?", id);
            log(id, null, activity.organizerId(), "RECRUITING", "IN_PROGRESS", "시작 시각");
            // Not opened yet at the start: remind the organizer once (attendance is not opened by itself).
            if (activity.openedAt() == null && jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND status = 'CONFIRMED'", Integer.class, id) > 0)
                notifications.send(activity.organizerId(), "QR_TIME", "아직 출석을 시작하지 않았어요", activity.title()
                        + " · [출석 시작]을 눌러야 참가자가 체크인할 수 있어요. 종료 30분 전까지 열 수 있어요.", "#/manage/" + id + "?tab=attendance", id, "QR_REMIND:" + id);
            for (Map<String, Object> row : jdbc.queryForList("SELECT id, status FROM participations WHERE activity_id = ? AND status IN ('APPLIED', 'WAITLISTED', 'OFFERED') ORDER BY id FOR UPDATE", id)) {
                long pid = ((Number) row.get("id")).longValue();
                jdbc.update("UPDATE participations SET status = 'EXPIRED', wait_order = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?", now, pid);
                log(id, pid, activity.organizerId(), (String) row.get("status"), "EXPIRED", "활동 시작으로 신청 마감");
                long user = jdbc.queryForObject("SELECT user_id FROM participations WHERE id = ?", Long.class, pid);
                notifications.send(user, "START_EXPIRED", "APPLIED".equals(row.get("status")) ? "승인 전에 활동이 시작됐어요" : "자리가 나지 않아 대기가 끝났어요",
                        activity.title() + " · 이번 활동에는 함께하지 못해요. 다른 활동을 찾아보세요.", "#/explore", activity.id(), null);
            }
            changed++;
        }
        for (long id : jdbc.queryForList("SELECT id FROM activities WHERE status IN ('RECRUITING', 'IN_PROGRESS') AND ends_at <= ? ORDER BY id", Long.class, now)) {
            Activity activity = load(id, true);
            jdbc.update("UPDATE activities SET status = 'FINISHED' WHERE id = ?", id);
            log(id, null, activity.organizerId(), activity.status(), "FINISHED", "종료 시각");
            // NO_SHOW only when attendance was opened; never opened → they stay confirmed ('출석 미확인'), not the participant's fault.
            int unchecked = 0;
            for (long pid : jdbc.queryForList("SELECT id FROM participations WHERE activity_id = ? AND status = 'CONFIRMED' FOR UPDATE", Long.class, id)) {
                if (activity.openedAt() == null) { unchecked++; log(id, pid, activity.organizerId(), "CONFIRMED", "UNCHECKED", "출석을 열지 않고 종료(불참 처리 안 함)"); continue; }
                jdbc.update("UPDATE participations SET status = 'NO_SHOW', updated_at = ? WHERE id = ?", now, pid);
                log(id, pid, activity.organizerId(), "CONFIRMED", "NO_SHOW", "체크인 없이 종료");
            }
            notifications.send(activity.organizerId(), "FINISHED", "활동이 끝났습니다", activity.title() + (unchecked > 0
                    ? " · 출석을 열지 않아 " + unchecked + "명은 출석 미확인으로 남았어요. 체크인한 참가자의 완료를 확인해 주세요."
                    : " · 체크인한 참가자의 완료를 확인해 주세요."), activity.link());
            changed++;
        }
        return changed;
    }

    // ---- internals ----

    /** QR / code check-in: opened by the organizer, and not later than WINDOW before the end. */
    private static boolean inWindow(Activity activity, LocalDateTime now) {
        return activity.openedAt() != null && !now.isAfter(activity.endsAt().minus(WINDOW))
                && List.of("RECRUITING", "IN_PROGRESS").contains(activity.status());
    }

    /** [출석 시작]: from WINDOW before the start to WINDOW before the end, once. */
    private static boolean canStart(Activity activity, LocalDateTime now) {
        return activity.openedAt() == null && !now.isBefore(activity.startsAt().minus(WINDOW)) && !now.isAfter(activity.endsAt().minus(WINDOW))
                && List.of("RECRUITING", "IN_PROGRESS").contains(activity.status());
    }

    private Activity load(long activityId, boolean lock) {
        return jdbc.queryForList("SELECT id, organizer_id, title, status, starts_at, ends_at, checkin_opened_at FROM activities WHERE id = ?" + (lock ? " FOR UPDATE" : ""), activityId)
                .stream().findFirst().map(row -> new Activity(((Number) row.get("id")).longValue(), ((Number) row.get("organizer_id")).longValue(),
                        (String) row.get("title"), (String) row.get("status"), (LocalDateTime) row.get("starts_at"), (LocalDateTime) row.get("ends_at"),
                        (LocalDateTime) row.get("checkin_opened_at")))
                .orElseThrow(() -> notFound("활동을 찾을 수 없습니다."));
    }

    private Activity organizerActivity(long organizerId, long participationId) {
        Map<String, Object> row = jdbc.queryForList("SELECT p.activity_id, a.organizer_id FROM participations p JOIN activities a ON a.id = p.activity_id WHERE p.id = ?", participationId)
                .stream().findFirst().orElseThrow(() -> notFound("신청을 찾을 수 없습니다."));
        if (((Number) row.get("organizer_id")).longValue() != organizerId) throw notFound("신청을 찾을 수 없습니다.");
        return load(((Number) row.get("activity_id")).longValue(), true);
    }

    private String status(long participationId) {
        return jdbc.queryForObject("SELECT status FROM participations WHERE id = ? FOR UPDATE", String.class, participationId);
    }

    // to_status also records one-off events (CHECKIN_OPENED, PENDING_REMINDED) so each reminder goes out once.
    private void log(long activityId, Long participationId, long actorId, String from, String to, String reason) {
        jdbc.update("INSERT INTO activity_logs(activity_id, participation_id, actor_id, from_status, to_status, reason) VALUES (?, ?, ?, ?, ?, ?)",
                activityId, participationId, actorId, from, to, reason);
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    private static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
    }
}
