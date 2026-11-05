package com.volink.activity;

import com.volink.common.ApiException;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Week 6 (2026-11-04): the organizer cancels the whole activity or moves its date/time once.
 * Everyone still holding or waiting for a place is told in the app. Rules (docs/rules.md):
 * cancel = before the start, reason required; reschedule = once, while RECRUITING, at least 24 h before the current start,
 * the new time follows the create rules (24 h ~ 60 days ahead, 06:00 ~ 22:00, 30 ~ 180 min) and must not end after sunset.
 * Confirmed people keep their place after a reschedule; they can cancel without asking if the new time does not suit them.
 */
@Service
public class ActivityChangeService {
    static final List<String> ACTIVE = List.of("APPLIED", "CONFIRMED", "WAITLISTED", "OFFERED");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("M월 d일 HH:mm");
    private final JdbcTemplate jdbc;
    private final NotificationService notifications;
    private final ActivityService activities;
    private final RiskClassifier risk;
    private final Clock clock;

    public ActivityChangeService(JdbcTemplate jdbc, NotificationService notifications, ActivityService activities, RiskClassifier risk, Clock clock) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.activities = activities;
        this.risk = risk;
        this.clock = clock;
    }

    /** Reason codes for an organizer's cancellation, with the words participants see. */
    public static final Map<String, String> REASONS = new java.util.LinkedHashMap<>(Map.of(
            "PERSONAL", "모집자의 개인 사정", "WEATHER", "기상 악화 및 안전 문제", "PLACE", "장소·시설 이용 불가", "STAFF", "운영 인력 부족", "OTHER", "기타 사유"));

    public record Cancel(String reasonCode, String message, String reason) {}

    /**
     * Cancels before the start (one record, all-or-nothing). The activity row is locked like every application change,
     * so an application, an approval or a seat offer racing with it either finishes first (and is counted here) or
     * sees CANCELLED and is refused. Started activities, check-ins already made, and a second cancel are refused;
     * participants are told once each (dedupe key per cancellation) in the same transaction.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> cancel(long organizerId, long id, Cancel request) {
        Map<String, Object> row = own(organizerId, id);
        String code = request.reasonCode() == null || request.reasonCode().isBlank() ? (request.reason() != null ? "OTHER" : "") : request.reasonCode().trim();
        String message = ActivityRules.trim(request.message() != null ? request.message() : request.reason());
        if ("CANCELLED".equals(row.get("status")))
            throw new ApiException(HttpStatus.CONFLICT, "ALREADY_CANCELLED", "이미 취소된 활동이에요.");
        if (!List.of("DRAFT", "RECRUITING").contains(row.get("status")) || !start(row).isAfter(now()))
            throw new ApiException(HttpStatus.CONFLICT, "STARTED", "활동이 시작된 뒤에는 취소할 수 없어요. 진행 중 중단·조기 종료는 아직 준비 중이에요.");
        int checkedIn = jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND status IN ('CHECKED_IN', 'COMPLETED')", Integer.class, id);
        if (checkedIn > 0) throw new ApiException(HttpStatus.CONFLICT, "CHECKED_IN", "이미 출석한 참가자가 있어 취소할 수 없어요. 출석 기록은 그대로 보존돼요.");
        Map<String, String> errors = new java.util.LinkedHashMap<>();
        if (!REASONS.containsKey(code)) errors.put("reasonCode", "취소 사유를 골라 주세요.");
        if (message.length() < 5 || message.length() > 300) errors.put("message", "참가자에게 전할 안내를 5~300자로 적어 주세요.");
        else if (com.volink.post.PostService.CONTACT.matcher(message).find()) errors.put("message", "전화번호·이메일·링크는 적을 수 없어요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);

        List<Map<String, Object>> affected = jdbc.queryForList("SELECT id, user_id, status FROM participations WHERE activity_id = ? AND status IN ('APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED') FOR UPDATE", id);
        long confirmed = affected.stream().filter(p -> "CONFIRMED".equals(p.get("status"))).count();
        long waiting = affected.stream().filter(p -> List.of("WAITLISTED", "OFFERED").contains(p.get("status"))).count();
        long applied = affected.stream().filter(p -> "APPLIED".equals(p.get("status"))).count();
        LocalDateTime now = now();
        jdbc.update("UPDATE activities SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = ? WHERE id = ?", message, now, id);
        jdbc.update("""
                INSERT INTO activity_cancellations(activity_id, cancelled_by, reason_code, message, status_before, confirmed_count, waiting_count, applied_count, cancelled_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", id, organizerId, code, message, row.get("status"), confirmed, waiting, applied, now);
        long cancellation = jdbc.queryForObject("SELECT id FROM activity_cancellations WHERE activity_id = ?", Long.class, id);
        activities.log(id, organizerId, (String) row.get("status"), "CANCELLED", "모집자 취소 · " + REASONS.get(code) + " · " + message);
        String label = REASONS.get(code);
        for (Map<String, Object> p : affected) {
            long pid = ((Number) p.get("id")).longValue();
            // Not the person's own cancellation: cancel_count stays; the log keeps the status they had.
            jdbc.update("UPDATE participations SET status = 'CANCELLED', wait_order = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?", now, pid);
            jdbc.update("INSERT INTO activity_logs(activity_id, participation_id, actor_id, from_status, to_status, reason) VALUES (?, ?, ?, ?, 'CANCELLED', '활동 취소')",
                    id, pid, organizerId, p.get("status"));
            notifications.send(((Number) p.get("user_id")).longValue(), "ACTIVITY_CANCELLED", "봉사활동이 취소되었어요",
                    row.get("title") + " 활동이 " + label + "(으)로 취소되었습니다. 자세한 내용을 확인해 주세요.", "#/activity/" + id, id, "CANCELLED:" + cancellation);
        }
        return activities.detail(id, organizerId);
    }

    public record Reschedule(String date, String time, Integer durationMinutes, String reason) {}

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Map<String, Object> reschedule(long organizerId, long id, Reschedule request) {
        Map<String, Object> row = own(organizerId, id);
        LocalDateTime now = now(), from = start(row);
        if (!"RECRUITING".equals(row.get("status")) || !from.isAfter(now))
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "모집 중인 활동만 일정을 바꿀 수 있습니다.");
        if (((Number) row.get("reschedule_count")).intValue() >= 1)
            throw new ApiException(HttpStatus.CONFLICT, "RESCHEDULE_USED", "일정은 활동마다 한 번만 바꿀 수 있습니다.");
        if (from.isBefore(now.plusHours(24)))
            throw new ApiException(HttpStatus.CONFLICT, "RESCHEDULE_TOO_LATE", "시작 24시간 전부터는 일정을 바꿀 수 없습니다. 필요하면 활동을 취소해 주세요.");
        Map<String, String> errors = new LinkedHashMap<>();
        LocalDate date = parse(() -> LocalDate.parse(request.date()));
        LocalTime time = parse(() -> LocalTime.parse(request.time()));
        Integer duration = request.durationMinutes();
        String reason = ActivityRules.trim(request.reason());
        if (date == null) errors.put("date", "활동 날짜를 선택해 주세요.");
        if (time == null) errors.put("time", "시작 시간을 입력해 주세요.");
        if (duration == null || duration < 30 || duration > 180) errors.put("duration", "활동 시간은 30~180분입니다.");
        if (reason.length() < 2 || reason.length() > 200) errors.put("reason", "바꾸는 이유를 2~200자로 적어 주세요.");
        LocalDateTime startsAt = null, endsAt = null;
        if (date != null && time != null && duration != null) {
            startsAt = LocalDateTime.of(date, time);
            endsAt = startsAt.plus(Duration.ofMinutes(duration));
            if (startsAt.isBefore(now.plusHours(24))) errors.put("date", "활동은 지금부터 24시간 이후로 정해 주세요.");
            else if (startsAt.isAfter(now.plusDays(60))) errors.put("date", "활동은 60일 이내로 정해 주세요.");
            if (time.isBefore(ActivityRules.EARLIEST_START)) errors.put("time", "시작 시간은 06:00 이후로 정해 주세요.");
            else if (endsAt.toLocalTime().isAfter(ActivityRules.LATEST_END) || !endsAt.toLocalDate().equals(date)) errors.put("time", "활동은 22:00 전에 끝나야 합니다.");
            else if (startsAt.equals(from) && Duration.between(from, (LocalDateTime) row.get("ends_at")).toMinutes() == duration)
                errors.put("date", "지금 일정과 같아요. 바꿀 날짜나 시간을 골라 주세요.");
        }
        if (errors.isEmpty() && "LOW".equals(row.get("risk_level"))
                && risk.classify("", "", "", endsAt, null).reasons().stream().anyMatch(text -> text.contains("해가 진 뒤")))
            errors.put("time", "해가 진 뒤 끝나는 시간으로는 바꿀 수 없어요. 더 일찍 끝나게 정해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);

        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ?, reschedule_count = reschedule_count + 1 WHERE id = ?", startsAt, endsAt, id);
        // RESCHEDULED also resets the one-off reminders (they are sent again for the new time).
        activities.log(id, organizerId, "RECRUITING", "RESCHEDULED", WHEN.format(from) + " → " + WHEN.format(startsAt) + " · " + reason);
        for (Map<String, Object> p : jdbc.queryForList("SELECT user_id, status FROM participations WHERE activity_id = ? AND status IN ('APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED')", id))
            notifications.send(((Number) p.get("user_id")).longValue(), "RESCHEDULED", "활동 일정이 바뀌었어요",
                    row.get("title") + " · " + WHEN.format(from) + " → " + WHEN.format(startsAt) + " (" + reason + ")"
                            + ("CONFIRMED".equals(p.get("status")) ? " · 참가 확정은 그대로예요. 시간이 안 맞으면 취소해 주세요." : ""), "#/activity/" + id);
        return activities.detail(id, organizerId);
    }

    private Map<String, Object> own(long organizerId, long id) {
        Map<String, Object> row = jdbc.queryForList("SELECT id, organizer_id, title, status, risk_level, starts_at, ends_at, reschedule_count FROM activities WHERE id = ? FOR UPDATE", id)
                .stream().findFirst().orElseThrow(ActivityService::notFound);
        if (((Number) row.get("organizer_id")).longValue() != organizerId || "DELETED".equals(row.get("status"))) throw ActivityService.notFound();
        return row;
    }

    private static LocalDateTime start(Map<String, Object> row) {
        return (LocalDateTime) row.get("starts_at");
    }

    private interface Parse<T> { T get(); }

    private static <T> T parse(Parse<T> parser) {
        try {
            return parser.get();
        } catch (DateTimeParseException | NullPointerException error) {
            return null;
        }
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }
}
