package com.volink.participation;

import com.volink.auth.AuthService;
import com.volink.auth.AuthUser;
import com.volink.common.ApiException;
import com.volink.common.Sql;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Applications, approval, waitlist and offers (docs/architecture.md, plan 6.5).
 * Every change locks the activity row first (SELECT ... FOR UPDATE), so seat counts are re-read under the lock and
 * two requests for the last seat can never both win. READ COMMITTED matters: under MySQL's default REPEATABLE READ the
 * count after the lock would still see the snapshot taken before it, and every racing approval would win (P-02 caught this). A seat is CONFIRMED or OFFERED (an open offer holds its seat).
 * Every status change is written to activity_logs and the affected person gets an in-app notification.
 */
@Service
public class ParticipationService {
    static final List<String> SEAT = List.of("CONFIRMED", "OFFERED");
    /** The waitlist closes this long before the start; seats freed later stay empty. */
    static final Duration WAITLIST_CLOSE = Duration.ofHours(2);
    private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("M월 d일 HH:mm");

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final NotificationService notifications;
    private final Clock clock;

    public ParticipationService(JdbcTemplate jdbc, AuthService auth, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.notifications = notifications;
        this.clock = clock;
    }

    record Activity(long id, long organizerId, String title, String status, LocalDateTime startsAt, int capacity) {
        LocalDateTime waitlistClosesAt() { return startsAt.minus(WAITLIST_CLOSE); }
        String link() { return "#/activity/" + id; }
    }

    // ---- participant ----

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> apply(long userId, long activityId) {
        AuthUser user = auth.findById(userId);
        if (user.admin()) throw forbidden("FORBIDDEN", "관리자 계정은 활동에 신청할 수 없습니다.");
        if (!user.canWrite()) throw forbidden("ACCOUNT_RESTRICTED", "이용이 제한된 계정은 신청할 수 없습니다.");
        Activity activity = lock(activityId);
        if (!"RECRUITING".equals(activity.status())) {
            if ("DRAFT".equals(activity.status())) throw activityNotFound();
            throw conflict("INVALID_STATE", "모집 중인 활동에만 신청할 수 있습니다.");
        }
        if (activity.organizerId() == userId) throw forbidden("FORBIDDEN", "내가 만든 활동에는 신청할 수 없습니다.");
        LocalDateTime now = now();
        if (!now.isBefore(activity.startsAt())) throw conflict("INVALID_STATE", "이미 시작한 활동입니다.");

        Map<String, Object> existing = jdbc.queryForList("SELECT id, status, cancel_count FROM participations WHERE activity_id = ? AND user_id = ? FOR UPDATE",
                activityId, userId).stream().findFirst().orElse(null);
        if (existing != null) {
            String status = (String) existing.get("status");
            int cancels = ((Number) existing.get("cancel_count")).intValue();
            boolean again = "EXPIRED".equals(status) || "CANCELLED".equals(status) && cancels < 2;
            if (!again) throw conflict("DUPLICATE_APPLICATION", "CANCELLED".equals(status)
                    ? "두 번 취소한 활동에는 다시 신청할 수 없습니다." : "REJECTED".equals(status)
                    ? "모집자가 거절한 활동에는 다시 신청할 수 없습니다." : "이미 신청한 활동입니다.");
        }

        boolean full = seatsTaken(activityId) >= activity.capacity();
        if (full && !now.isBefore(activity.waitlistClosesAt()))
            throw conflict("WAITLIST_CLOSED", "정원이 찼고 대기 신청도 마감되었습니다(시작 2시간 전 마감).");
        String to = full ? "WAITLISTED" : "APPLIED";
        Integer order = full ? nextWaitOrder(activityId) : null;
        long id;
        String from = null;
        if (existing == null) {
            jdbc.update("INSERT INTO participations(activity_id, user_id, status, wait_order, updated_at) VALUES (?, ?, ?, ?, ?)",
                    activityId, userId, to, order, now);
            id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        } else {
            id = ((Number) existing.get("id")).longValue();
            from = (String) existing.get("status");
            jdbc.update("UPDATE participations SET status = ?, wait_order = ?, offer_expires_at = NULL, updated_at = ? WHERE id = ?", to, order, now, id);
        }
        log(activityId, id, userId, from, to, from == null ? "신청" : "다시 신청");
        notifications.send(activity.organizerId(), "ACTIVITY_CHANGED", "새 참가 신청", activity.title() + (full ? " · 대기 " + order + "번으로 신청이 들어왔습니다." : " · 승인을 기다리는 신청이 있습니다."), activity.link());
        if (full) notifications.send(userId, "APPLICATION_RESULT", "대기 " + order + "번으로 신청했습니다",
                activity.title() + " · 빈자리가 생기면 순서대로 자리를 제안합니다.", activity.link());
        return viewer(activityId, userId);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> cancel(long userId, long participationId) {
        Map<String, Object> row = own(userId, participationId);
        Activity activity = lock(((Number) row.get("activity_id")).longValue());
        String from = status(participationId);
        if (!List.of("APPLIED", "WAITLISTED", "OFFERED", "CONFIRMED").contains(from))
            throw conflict("INVALID_STATE", "취소할 수 있는 신청이 아닙니다.");
        if (!now().isBefore(activity.startsAt())) throw conflict("INVALID_STATE", "시작한 활동은 취소할 수 없습니다.");
        jdbc.update("UPDATE participations SET status = 'CANCELLED', wait_order = NULL, offer_expires_at = NULL, cancel_count = cancel_count + 1, updated_at = ? WHERE id = ?",
                now(), participationId);
        log(activity.id(), participationId, userId, from, "CANCELLED", "본인 취소");
        if ("CONFIRMED".equals(from)) notifications.send(activity.organizerId(), "ACTIVITY_CHANGED", "참가 취소",
                activity.title() + " · 확정된 참가자 한 명이 취소했습니다.", activity.link());
        if (SEAT.contains(from)) offerNext(activity, userId);
        return viewer(activity.id(), userId);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> acceptOffer(long userId, long participationId) {
        Map<String, Object> row = own(userId, participationId);
        Activity activity = lock(((Number) row.get("activity_id")).longValue());
        if (!"OFFERED".equals(status(participationId))) throw conflict("INVALID_STATE", "수락할 자리 제안이 없습니다.");
        LocalDateTime expires = jdbc.queryForObject("SELECT offer_expires_at FROM participations WHERE id = ?", LocalDateTime.class, participationId);
        if (!now().isBefore(expires))
            throw new ApiException(HttpStatus.GONE, "OFFER_EXPIRED", "응답 시간이 지나 자리 제안이 만료되었습니다.");
        jdbc.update("UPDATE participations SET status = 'CONFIRMED', wait_order = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?", now(), participationId);
        log(activity.id(), participationId, userId, "OFFERED", "CONFIRMED", "자리 제안 수락");
        notifications.send(activity.organizerId(), "ACTIVITY_CHANGED", "대기자 참가 확정", activity.title() + " · 대기자가 자리 제안을 수락했습니다.", activity.link());
        return viewer(activity.id(), userId);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> declineOffer(long userId, long participationId) {
        Map<String, Object> row = own(userId, participationId);
        Activity activity = lock(((Number) row.get("activity_id")).longValue());
        if (!"OFFERED".equals(status(participationId))) throw conflict("INVALID_STATE", "거절할 자리 제안이 없습니다.");
        jdbc.update("UPDATE participations SET status = 'EXPIRED', wait_order = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?", now(), participationId);
        log(activity.id(), participationId, userId, "OFFERED", "EXPIRED", "자리 제안 거절");
        offerNext(activity, userId);
        return viewer(activity.id(), userId);
    }

    public List<Map<String, Object>> mine(long userId, String status) {
        return jdbc.queryForList("""
                SELECT p.id, p.activity_id AS activityId, a.title, pl.name AS placeName,
                       DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date, DATE_FORMAT(a.starts_at, '%H:%i') AS startTime,
                       p.status, p.wait_order AS waitOrder, DATE_FORMAT(p.offer_expires_at, '%Y-%m-%dT%H:%i') AS offerExpiresAt
                FROM participations p JOIN activities a ON a.id = p.activity_id LEFT JOIN demo_places pl ON pl.id = a.place_id
                WHERE p.user_id = ?""" + (status == null || status.isBlank() ? "" : " AND p.status = ?") + " ORDER BY a.starts_at DESC, p.id DESC",
                status == null || status.isBlank() ? new Object[]{userId} : new Object[]{userId, status.trim()});
    }

    /** The viewer's own participation for the detail screen, plus live seat counts (null participation = not applied). */
    public Map<String, Object> viewer(long activityId, Long userId) {
        Map<String, Object> result = new LinkedHashMap<>(seats(activityId));
        Map<String, Object> mine = userId == null ? null : jdbc.queryForList("""
                SELECT id, status, wait_order AS waitOrder, DATE_FORMAT(offer_expires_at, '%Y-%m-%dT%H:%i') AS offerExpiresAt, cancel_count AS cancelCount
                FROM participations WHERE activity_id = ? AND user_id = ?""", activityId, userId).stream().findFirst().orElse(null);
        result.put("participation", mine);
        return result;
    }

    public Map<String, Object> seats(long activityId) {
        return jdbc.queryForMap("""
                SELECT COALESCE(SUM(status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')), 0) AS confirmed,
                       COALESCE(SUM(status = 'OFFERED'), 0) AS offered, COALESCE(SUM(status = 'WAITLISTED'), 0) AS waiting,
                       COALESCE(SUM(status = 'APPLIED'), 0) AS pending
                FROM participations WHERE activity_id = ?""", activityId);
    }

    // ---- organizer ----

    /** Applicants of the organizer's own activity: names partly hidden, no e-mail or contact. Anyone else gets 404. */
    public Map<String, Object> applicants(long organizerId, long activityId) {
        Map<String, Object> activity = jdbc.queryForList("SELECT organizer_id, capacity FROM activities WHERE id = ?", activityId)
                .stream().findFirst().orElseThrow(ParticipationService::activityNotFound);
        if (((Number) activity.get("organizer_id")).longValue() != organizerId) throw activityNotFound();
        List<Map<String, Object>> rows = jdbc.queryForList(Sql.kst("""
                SELECT p.id, u.display_name AS name, p.status, p.wait_order AS waitOrder,
                       DATE_FORMAT(p.offer_expires_at, '%Y-%m-%dT%H:%i') AS offerExpiresAt, DATE_FORMAT(KST(p.created_at), '%m-%d %H:%i') AS appliedAt
                FROM participations p JOIN users u ON u.id = p.user_id WHERE p.activity_id = ?
                ORDER BY FIELD(p.status, 'APPLIED', 'CONFIRMED', 'OFFERED', 'WAITLISTED') = 0, FIELD(p.status, 'APPLIED', 'CONFIRMED', 'OFFERED', 'WAITLISTED'), p.wait_order, p.id
                """), activityId);
        rows.forEach(row -> row.put("name", mask((String) row.get("name"))));
        Map<String, Object> result = new LinkedHashMap<>(seats(activityId));
        result.put("capacity", activity.get("capacity"));
        result.put("items", rows);
        return result;
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void approve(long organizerId, long participationId) {
        Activity activity = organizerLock(organizerId, participationId);
        if (!"APPLIED".equals(status(participationId))) throw conflict("INVALID_STATE", "승인을 기다리는 신청만 승인할 수 있습니다.");
        if (!now().isBefore(activity.startsAt())) throw conflict("INVALID_STATE", "이미 시작한 활동입니다.");
        // Seats are counted again under the activity lock; the screen's numbers are never trusted.
        if (seatsTaken(activity.id()) >= activity.capacity()) throw conflict("CAPACITY_FULL", "정원이 모두 찼습니다. 취소가 생기면 대기자에게 먼저 자리가 제안됩니다.");
        jdbc.update("UPDATE participations SET status = 'CONFIRMED', updated_at = ? WHERE id = ?", now(), participationId);
        log(activity.id(), participationId, organizerId, "APPLIED", "CONFIRMED", "모집자 승인");
        notifications.send(applicant(participationId), "APPLICATION_RESULT", "참가가 확정되었습니다", activity.title() + " · " + SHORT.format(activity.startsAt()) + " 시작", activity.link());
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void reject(long organizerId, long participationId, String rawReason) {
        Activity activity = organizerLock(organizerId, participationId);
        String from = status(participationId);
        if (!List.of("APPLIED", "WAITLISTED").contains(from)) throw conflict("INVALID_STATE", "승인 전이거나 대기 중인 신청만 거절할 수 있습니다.");
        String reason = rawReason == null || rawReason.isBlank() ? "모집자 판단" : rawReason.trim();
        if (reason.length() > 500) throw ApiException.validation(Map.of("reason", "사유는 500자 이내로 입력해 주세요."));
        jdbc.update("UPDATE participations SET status = 'REJECTED', wait_order = NULL, updated_at = ? WHERE id = ?", now(), participationId);
        log(activity.id(), participationId, organizerId, from, "REJECTED", reason);
        notifications.send(applicant(participationId), "APPLICATION_RESULT", "참가 신청이 거절되었습니다", activity.title() + " · " + reason, activity.link());
    }

    // ---- scheduler ----

    /**
     * Runs every minute: expires offers whose answer time has passed (and offers the seat to the next person),
     * and closes the waitlist two hours before the start. Returns how many participations changed.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public int expireDue() {
        LocalDateTime now = now();
        int changed = 0;
        List<Long> due = jdbc.queryForList("""
                SELECT DISTINCT p.activity_id FROM participations p JOIN activities a ON a.id = p.activity_id
                WHERE (p.status = 'OFFERED' AND p.offer_expires_at <= ?) OR (p.status = 'WAITLISTED' AND a.starts_at <= ?)
                ORDER BY p.activity_id""", Long.class, now, now.plus(WAITLIST_CLOSE));
        for (long activityId : due) {
            Activity activity = lock(activityId);
            for (Map<String, Object> offer : jdbc.queryForList("SELECT id, user_id FROM participations WHERE activity_id = ? AND status = 'OFFERED' AND offer_expires_at <= ? FOR UPDATE", activityId, now)) {
                long id = ((Number) offer.get("id")).longValue();
                jdbc.update("UPDATE participations SET status = 'EXPIRED', wait_order = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?", now, id);
                log(activityId, id, activity.organizerId(), "OFFERED", "EXPIRED", "응답 시간 초과");
                notifications.send(((Number) offer.get("user_id")).longValue(), "WAITLIST_OFFER", "자리 제안이 만료되었습니다", activity.title() + " · 응답 시간이 지나 다음 대기자에게 넘어갔습니다.", activity.link());
                changed++;
            }
            changed += offerNext(activity, activity.organizerId());
            if (!now.isBefore(activity.waitlistClosesAt())) {
                for (Map<String, Object> waiting : jdbc.queryForList("SELECT id, user_id FROM participations WHERE activity_id = ? AND status = 'WAITLISTED' FOR UPDATE", activityId)) {
                    long id = ((Number) waiting.get("id")).longValue();
                    jdbc.update("UPDATE participations SET status = 'EXPIRED', wait_order = NULL, updated_at = ? WHERE id = ?", now, id);
                    log(activityId, id, activity.organizerId(), "WAITLISTED", "EXPIRED", "대기 마감(시작 2시간 전)");
                    notifications.send(((Number) waiting.get("user_id")).longValue(), "WAITLIST_OFFER", "대기가 마감되었습니다", activity.title() + " · 시작 2시간 전이라 대기 신청이 마감되었습니다.", activity.link());
                    changed++;
                }
            }
        }
        return changed;
    }

    // ---- internals ----

    /** Offers free seats to the waitlist in order. Answer time: 6 h if the start is 24 h+ away, else 1 h, never past the waitlist close. */
    private int offerNext(Activity activity, long actorId) {
        LocalDateTime now = now();
        if (!now.isBefore(activity.waitlistClosesAt())) return 0;
        int offered = 0;
        while (seatsTaken(activity.id()) < activity.capacity()) {
            Map<String, Object> next = jdbc.queryForList("SELECT id, user_id, wait_order FROM participations WHERE activity_id = ? AND status = 'WAITLISTED' ORDER BY wait_order, id LIMIT 1 FOR UPDATE",
                    activity.id()).stream().findFirst().orElse(null);
            if (next == null) break;
            Duration answer = Duration.between(now, activity.startsAt()).compareTo(Duration.ofHours(24)) >= 0 ? Duration.ofHours(6) : Duration.ofHours(1);
            LocalDateTime expires = now.plus(answer);
            if (expires.isAfter(activity.waitlistClosesAt())) expires = activity.waitlistClosesAt();
            long id = ((Number) next.get("id")).longValue();
            jdbc.update("UPDATE participations SET status = 'OFFERED', offer_expires_at = ?, updated_at = ? WHERE id = ?", expires, now, id);
            log(activity.id(), id, actorId, "WAITLISTED", "OFFERED", "빈자리 제안 · " + SHORT.format(expires) + "까지");
            notifications.send(((Number) next.get("user_id")).longValue(), "WAITLIST_OFFER", "빈자리가 생겼어요",
                    activity.title() + " · " + SHORT.format(expires) + "까지 수락하면 참가가 확정됩니다.", activity.link());
            offered++;
        }
        return offered;
    }

    private Activity lock(long activityId) {
        return jdbc.queryForList("SELECT id, organizer_id, title, status, starts_at, capacity FROM activities WHERE id = ? FOR UPDATE", activityId)
                .stream().findFirst().map(row -> new Activity(((Number) row.get("id")).longValue(), ((Number) row.get("organizer_id")).longValue(),
                        (String) row.get("title"), (String) row.get("status"), time(row.get("starts_at")), ((Number) row.get("capacity")).intValue()))
                .orElseThrow(ParticipationService::activityNotFound);
    }

    private Activity organizerLock(long organizerId, long participationId) {
        Map<String, Object> row = jdbc.queryForList("SELECT p.activity_id, a.organizer_id FROM participations p JOIN activities a ON a.id = p.activity_id WHERE p.id = ?", participationId)
                .stream().findFirst().orElseThrow(ParticipationService::participationNotFound);
        if (((Number) row.get("organizer_id")).longValue() != organizerId) throw participationNotFound();
        return lock(((Number) row.get("activity_id")).longValue());
    }

    private Map<String, Object> own(long userId, long participationId) {
        Map<String, Object> row = jdbc.queryForList("SELECT activity_id, user_id FROM participations WHERE id = ?", participationId)
                .stream().findFirst().orElseThrow(ParticipationService::participationNotFound);
        if (((Number) row.get("user_id")).longValue() != userId) throw participationNotFound();
        return row;
    }

    private String status(long participationId) {
        return jdbc.queryForObject("SELECT status FROM participations WHERE id = ? FOR UPDATE", String.class, participationId);
    }

    private long applicant(long participationId) {
        return jdbc.queryForObject("SELECT user_id FROM participations WHERE id = ?", Long.class, participationId);
    }

    private int seatsTaken(long activityId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND status IN ('CONFIRMED', 'OFFERED')", Integer.class, activityId);
    }

    private int nextWaitOrder(long activityId) {
        return jdbc.queryForObject("SELECT COALESCE(MAX(wait_order), 0) + 1 FROM participations WHERE activity_id = ?", Integer.class, activityId);
    }

    private void log(long activityId, long participationId, long actorId, String from, String to, String reason) {
        jdbc.update("INSERT INTO activity_logs(activity_id, participation_id, actor_id, from_status, to_status, reason) VALUES (?, ?, ?, ?, ?, ?)",
                activityId, participationId, actorId, from, to, reason);
    }

    /** DATETIME values are Korean local time; Connector/J returns LocalDateTime for them (no time-zone shift). */
    private static LocalDateTime time(Object value) {
        if (value instanceof LocalDateTime local) return local;
        throw new IllegalStateException("Expected LocalDateTime but got " + (value == null ? "null" : value.getClass()));
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    /** "홍길동" → "홍*동", "김철" → "김*". Other applicants' full names and contacts are never returned. */
    static String mask(String name) {
        if (name == null || name.isEmpty()) return "*";
        if (name.length() == 1) return "*";
        if (name.length() == 2) return name.charAt(0) + "*";
        return name.charAt(0) + "*".repeat(name.length() - 2) + name.charAt(name.length() - 1);
    }

    private static ApiException conflict(String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, code, message);
    }

    private static ApiException forbidden(String code, String message) {
        return new ApiException(HttpStatus.FORBIDDEN, code, message);
    }

    private static ApiException activityNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "활동을 찾을 수 없습니다.");
    }

    private static ApiException participationNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "신청을 찾을 수 없습니다.");
    }
}
