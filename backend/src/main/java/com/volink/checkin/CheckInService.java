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
    /** Check-in is open from 30 minutes before to 30 minutes after the start. */
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

    record Activity(long id, long organizerId, String title, String status, LocalDateTime startsAt, LocalDateTime endsAt) {
        String link() { return "#/activity/" + id; }
    }

    /** Organizer only. A fresh 60-second QR value; the screen asks again before it runs out. */
    public Map<String, Object> qr(long organizerId, long activityId) {
        Activity activity = load(activityId, false);
        if (activity.organizerId() != organizerId) throw notFound("활동을 찾을 수 없습니다.");
        LocalDateTime now = now();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("opensAt", activity.startsAt().minus(WINDOW).toString());
        result.put("closesAt", activity.startsAt().plus(WINDOW).toString());
        boolean open = inWindow(activity, now);
        result.put("open", open);
        result.put("token", open ? qr.issue(activityId) : null);
        result.put("validSeconds", QrService.VALID.getSeconds());
        result.put("rotateSeconds", ROTATE.getSeconds());
        // Live attendance for the organizer's on-site screen.
        Map<String, Object> counts = jdbc.queryForMap("""
                SELECT COALESCE(SUM(status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW')), 0) AS expected,
                       COALESCE(SUM(status IN ('CHECKED_IN', 'COMPLETED')), 0) AS checkedIn
                FROM participations WHERE activity_id = ?""", activityId);
        result.put("expected", ((Number) counts.get("expected")).intValue());
        result.put("checkedIn", ((Number) counts.get("checkedIn")).intValue());
        result.put("status", activity.status());
        return result;
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> checkIn(long userId, long activityId, String token, Double lat, Double lng, Double accuracy) {
        Activity activity = load(activityId, true);
        Map<String, Object> participation = jdbc.queryForList("SELECT id, status FROM participations WHERE activity_id = ? AND user_id = ? FOR UPDATE", activityId, userId)
                .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "참가가 확정된 사람만 체크인할 수 있습니다."));
        String status = (String) participation.get("status");
        if ("CHECKED_IN".equals(status) || "COMPLETED".equals(status)) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "이미 체크인했습니다.");
        if (!"CONFIRMED".equals(status)) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "참가가 확정된 사람만 체크인할 수 있습니다.");
        LocalDateTime now = now();
        if (!inWindow(activity, now))
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CHECKIN_OUT_OF_TIME", "체크인은 시작 30분 전부터 시작 후 30분까지 할 수 있습니다.");
        switch (qr.check(token, activityId)) {
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

        long id = ((Number) participation.get("id")).longValue();
        jdbc.update("INSERT INTO check_ins(participation_id, method, within_radius, checked_by, checked_at) VALUES (?, 'QR', TRUE, ?, ?)", id, userId, now);
        jdbc.update("UPDATE participations SET status = 'CHECKED_IN', updated_at = ? WHERE id = ?", now, id);
        log(activityId, id, userId, "CONFIRMED", "CHECKED_IN", "QR·시간·위치 확인");
        return Map.of("participationId", id, "status", "CHECKED_IN", "method", "QR", "checkedInAt", now.toString().substring(0, 16));
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
        notifications.send(user, "RECORD_CONFIRMED", "활동 기록이 만들어졌습니다", activity.title() + " · 내 활동 > 활동 기록에서 볼 수 있고 7일 안에 이의를 신청할 수 있습니다.", "#/mine");
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
        // Once, 24 h before: the organizer still has applications to answer.
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT a.id, a.organizer_id, a.title, COUNT(p.id) AS pending FROM activities a JOIN participations p ON p.activity_id = a.id AND p.status = 'APPLIED'
                WHERE a.status = 'RECRUITING' AND a.starts_at > ? AND a.starts_at <= ?
                  AND NOT EXISTS (SELECT 1 FROM activity_logs l WHERE l.activity_id = a.id AND l.to_status = 'PENDING_REMINDED')
                GROUP BY a.id, a.organizer_id, a.title""", now, now.plus(PENDING_REMINDER))) {
            long id = ((Number) row.get("id")).longValue(), organizer = ((Number) row.get("organizer_id")).longValue();
            notifications.send(organizer, "ACTIVITY_REMINDER", "승인을 기다리는 신청이 " + row.get("pending") + "건 있어요",
                    row.get("title") + " · 시작 전까지 승인하지 않으면 신청이 자동으로 마감됩니다.", "#/activity/" + id);
            log(id, null, organizer, null, "PENDING_REMINDED", "시작 24시간 전 승인 대기 안내");
        }
        // Once, when check-in opens (30 min before): the confirmed people and the organizer.
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT a.id, a.organizer_id, a.title FROM activities a
                WHERE a.status = 'RECRUITING' AND a.starts_at > ? AND a.starts_at <= ?
                  AND NOT EXISTS (SELECT 1 FROM activity_logs l WHERE l.activity_id = a.id AND l.to_status = 'CHECKIN_OPENED')""", now, now.plus(WINDOW))) {
            long id = ((Number) row.get("id")).longValue(), organizer = ((Number) row.get("organizer_id")).longValue();
            String link = "#/activity/" + id;
            for (long user : jdbc.queryForList("SELECT user_id FROM participations WHERE activity_id = ? AND status = 'CONFIRMED'", Long.class, id))
                notifications.send(user, "ACTIVITY_REMINDER", "체크인이 열렸어요", row.get("title") + " · 현장에서 모집자가 보여 주는 QR을 휴대폰 카메라로 찍어 주세요.", link);
            notifications.send(organizer, "ACTIVITY_REMINDER", "출석 QR을 띄울 시간이에요", row.get("title") + " · 활동 상세에서 '출석 체크'를 열어 참가자에게 QR을 보여 주세요.", link);
            log(id, null, organizer, null, "CHECKIN_OPENED", "체크인 시작 안내");
        }
        for (long id : jdbc.queryForList("SELECT id FROM activities WHERE status = 'RECRUITING' AND starts_at <= ? ORDER BY id", Long.class, now)) {
            Activity activity = load(id, true);
            if (!"RECRUITING".equals(activity.status())) continue;
            jdbc.update("UPDATE activities SET status = 'IN_PROGRESS' WHERE id = ?", id);
            log(id, null, activity.organizerId(), "RECRUITING", "IN_PROGRESS", "시작 시각");
            for (Map<String, Object> row : jdbc.queryForList("SELECT id, status FROM participations WHERE activity_id = ? AND status IN ('APPLIED', 'WAITLISTED', 'OFFERED') ORDER BY id FOR UPDATE", id)) {
                long pid = ((Number) row.get("id")).longValue();
                jdbc.update("UPDATE participations SET status = 'EXPIRED', wait_order = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?", now, pid);
                log(id, pid, activity.organizerId(), (String) row.get("status"), "EXPIRED", "활동 시작으로 신청 마감");
                long user = jdbc.queryForObject("SELECT user_id FROM participations WHERE id = ?", Long.class, pid);
                notifications.send(user, "APPLICATION_RESULT", "APPLIED".equals(row.get("status")) ? "승인 전에 활동이 시작됐어요" : "자리가 나지 않아 대기가 끝났어요",
                        activity.title() + " · 이번 활동에는 함께하지 못해요. 다른 활동을 찾아보세요.", "#/explore");
            }
            changed++;
        }
        for (long id : jdbc.queryForList("SELECT id FROM activities WHERE status IN ('RECRUITING', 'IN_PROGRESS') AND ends_at <= ? ORDER BY id", Long.class, now)) {
            Activity activity = load(id, true);
            jdbc.update("UPDATE activities SET status = 'FINISHED' WHERE id = ?", id);
            log(id, null, activity.organizerId(), activity.status(), "FINISHED", "종료 시각");
            for (long pid : jdbc.queryForList("SELECT id FROM participations WHERE activity_id = ? AND status = 'CONFIRMED' FOR UPDATE", Long.class, id)) {
                jdbc.update("UPDATE participations SET status = 'NO_SHOW', updated_at = ? WHERE id = ?", now, pid);
                log(id, pid, activity.organizerId(), "CONFIRMED", "NO_SHOW", "체크인 없이 종료");
            }
            notifications.send(activity.organizerId(), "ACTIVITY_CHANGED", "활동이 끝났습니다", activity.title() + " · 체크인한 참가자의 완료를 확인해 주세요.", activity.link());
            changed++;
        }
        return changed;
    }

    // ---- internals ----

    private static boolean inWindow(Activity activity, LocalDateTime now) {
        return !now.isBefore(activity.startsAt().minus(WINDOW)) && !now.isAfter(activity.startsAt().plus(WINDOW))
                && List.of("RECRUITING", "IN_PROGRESS").contains(activity.status());
    }

    private Activity load(long activityId, boolean lock) {
        return jdbc.queryForList("SELECT id, organizer_id, title, status, starts_at, ends_at FROM activities WHERE id = ?" + (lock ? " FOR UPDATE" : ""), activityId)
                .stream().findFirst().map(row -> new Activity(((Number) row.get("id")).longValue(), ((Number) row.get("organizer_id")).longValue(),
                        (String) row.get("title"), (String) row.get("status"), (LocalDateTime) row.get("starts_at"), (LocalDateTime) row.get("ends_at")))
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
