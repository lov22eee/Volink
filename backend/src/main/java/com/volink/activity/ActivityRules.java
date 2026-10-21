package com.volink.activity;

import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Server copy of frontend/src/rules.ts activityRules; field keys and messages match the form. */
@Component
public class ActivityRules {
    static final LocalTime EARLIEST_START = LocalTime.of(6, 0);
    static final LocalTime LATEST_END = LocalTime.of(22, 0);
    private final Clock clock;

    public ActivityRules(Clock clock) {
        this.clock = clock;
    }

    public record Checked(LocalDateTime startsAt, LocalDateTime endsAt) {}

    public Map<String, String> validate(ActivityRequest request, Checked[] out) {
        Map<String, String> errors = new LinkedHashMap<>();
        String title = trim(request.title());
        if (title.length() < 5 || title.length() > 100) errors.put("title", "활동 이름은 5~100자로 입력해 주세요.");
        if (request.placeId() == null && request.place() == null) errors.put("place", "장소를 선택해 주세요.");
        if (trim(request.meetingPoint()).length() > 100) errors.put("meetingPoint", "만나는 곳은 100자 이내로 적어 주세요.");
        LocalDate date = parse(request.date(), LocalDate::parse);
        LocalTime time = parse(request.time(), LocalTime::parse);
        Integer duration = request.durationMinutes();
        if (date == null) errors.put("date", "활동 날짜를 선택해 주세요.");
        if (time == null) errors.put("time", "시작 시간을 입력해 주세요.");
        if (date != null && time != null) {
            LocalDateTime start = LocalDateTime.of(date, time);
            LocalDateTime now = LocalDateTime.now(clock);
            if (start.isBefore(now.plusHours(24))) errors.put("date", "활동은 지금부터 24시간 이후로 정해 주세요.");
            else if (start.isAfter(now.plusDays(60))) errors.put("date", "활동은 60일 이내로 정해 주세요.");
            if (time.isBefore(EARLIEST_START)) errors.put("time", "시작 시간은 06:00 이후로 정해 주세요.");
            else if (duration != null && time.plusMinutes(duration).isAfter(LATEST_END)
                    || duration != null && time.plusMinutes(duration).isBefore(time))
                errors.put("time", "활동은 22:00 전에 끝나야 합니다.");
            if (out != null && duration != null) out[0] = new Checked(start, start.plus(Duration.ofMinutes(duration)));
        }
        Integer capacity = request.capacity();
        if (capacity == null || capacity < 2 || capacity > 10) errors.put("capacity", "모집 정원은 2~10명입니다.");
        if (duration == null || duration < 30 || duration > 180) errors.put("duration", "활동 시간은 30~180분입니다.");
        String description = trim(request.description());
        if (description.length() < 20 || description.length() > 2000) errors.put("description", "활동 소개는 20~2000자로 적어 주세요.");
        if (!Boolean.TRUE.equals(request.safetyConfirmed())) errors.put("safety", "안전 안내를 확인해 주세요.");
        return errors;
    }

    private interface Parser<T> { T parse(CharSequence value); }

    private static <T> T parse(String value, Parser<T> parser) {
        try {
            return value == null ? null : parser.parse(value.trim());
        } catch (DateTimeParseException error) {
            return null;
        }
    }

    static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
