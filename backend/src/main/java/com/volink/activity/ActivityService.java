package com.volink.activity;

import com.volink.auth.AuthService;
import com.volink.auth.AuthUser;
import com.volink.common.ApiException;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityService {
    /** Shared projection. DATETIME columns hold Korean local time; LocalDateTime is bound as-is (no JVM time-zone shift). Participation counts arrive in week 5. */
    static final String SELECT = """
            SELECT a.id, a.title, a.description, c.name AS category, a.activity_type AS activityType,
                   o.name AS organizationName, a.place_id AS placeId, p.name AS placeName,
                   DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date, DATE_FORMAT(a.starts_at, '%H:%i') AS startTime,
                   TIMESTAMPDIFF(MINUTE, a.starts_at, a.ends_at) AS durationMinutes, a.capacity,
                   (SELECT COUNT(*) FROM participations x WHERE x.activity_id = a.id AND x.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')) AS confirmed,
                   a.status, a.risk_level AS riskLevel, a.organizer_id AS organizerId, u.display_name AS organizerName
            FROM activities a
            JOIN categories c ON c.id = a.category_id
            JOIN users u ON u.id = a.organizer_id
            LEFT JOIN organizations o ON o.id = a.organization_id
            LEFT JOIN demo_places p ON p.id = a.place_id
            """;
    static final List<String> PUBLIC_STATUSES = List.of("RECRUITING", "IN_PROGRESS", "FINISHED");

    private final JdbcTemplate jdbc;
    private final ActivityRules rules;
    private final RiskClassifier risk;
    private final AuthService auth;
    private final Clock clock;

    public ActivityService(JdbcTemplate jdbc, ActivityRules rules, RiskClassifier risk, AuthService auth, Clock clock) {
        this.jdbc = jdbc;
        this.rules = rules;
        this.risk = risk;
        this.auth = auth;
        this.clock = clock;
    }

    @Transactional
    public Map<String, Object> create(long userId, ActivityRequest request) {
        AuthUser user = auth.findById(userId);
        if (user.admin()) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 계정은 활동을 개설할 수 없습니다.");
        if (!user.canWrite()) throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_RESTRICTED", "이용이 제한된 계정은 활동을 개설할 수 없습니다.");

        ActivityRules.Checked[] times = new ActivityRules.Checked[1];
        Map<String, String> errors = rules.validate(request, times);
        String category = ActivityRules.trim(request.category());
        Long categoryId = jdbc.queryForList("SELECT id FROM categories WHERE name = ?", Long.class, category).stream().findFirst().orElse(null);
        if (categoryId == null) errors.putIfAbsent("category", "분야를 선택해 주세요.");
        if (request.placeId() != null && jdbc.queryForObject("SELECT COUNT(*) FROM demo_places WHERE id = ?", Integer.class, request.placeId()) == 0)
            errors.putIfAbsent("place", "장소를 선택해 주세요.");
        boolean institution = "INSTITUTION".equals(request.activityType());
        if (!institution && request.activityType() != null && !"GENERAL".equals(request.activityType()))
            errors.putIfAbsent("activityType", "활동 유형을 선택해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);

        Long organizationId = null;
        if (institution) {
            organizationId = jdbc.queryForList("SELECT id FROM organizations WHERE manager_user_id = ? AND status = 'APPROVED'",
                    Long.class, userId).stream().findFirst().orElse(null);
            if (organizationId == null)
                throw new ApiException(HttpStatus.FORBIDDEN, "ORGANIZATION_NOT_APPROVED", "기관 확인이 끝난 기관회원만 기관 주관 활동을 열 수 있습니다.");
        }

        String title = ActivityRules.trim(request.title());
        String description = ActivityRules.trim(request.description());
        RiskClassifier.Result result = risk.classify(title, description, category, times[0].endsAt());
        if ("BLOCKED".equals(result.level()))
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "ACTIVITY_BLOCKED",
                    "등록할 수 없는 활동입니다. " + String.join(", ", result.reasons()), Map.of("risk", String.join(", ", result.reasons())));

        String status = "LOW".equals(result.level()) ? "RECRUITING" : "DRAFT";
        jdbc.update("""
                INSERT INTO activities(organizer_id, category_id, activity_type, organization_id, place_id, title, description,
                                       starts_at, ends_at, capacity, risk_level, risk_reasons, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, userId, categoryId, institution ? "INSTITUTION" : "GENERAL", organizationId, request.placeId(), title, description,
                times[0].startsAt(), times[0].endsAt(), request.capacity(),
                result.level(), result.reasons().isEmpty() ? null : String.join(", ", result.reasons()), status);
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        log(id, userId, null, status, "개설 · 위험도 " + result.level());
        return mine(userId, id);
    }

    public List<Map<String, Object>> listPublic() {
        return jdbc.queryForList(SELECT + " WHERE a.status = 'RECRUITING' AND a.starts_at > ? ORDER BY a.starts_at, a.id",
                LocalDateTime.now(clock));
    }

    /** Hidden activities (REVIEW pending, rejected) are visible only to their organizer and admins; others get 404. */
    public Map<String, Object> detail(long id, Long viewerId) {
        Map<String, Object> activity = jdbc.queryForList(SELECT + " WHERE a.id = ?", id).stream().findFirst().orElseThrow(ActivityService::notFound);
        boolean visible = PUBLIC_STATUSES.contains(activity.get("status"))
                || viewerId != null && (viewerId.equals(((Number) activity.get("organizerId")).longValue()) || auth.findById(viewerId).admin());
        if (!visible) throw notFound();
        return activity;
    }

    public List<Map<String, Object>> listMine(long userId) {
        return jdbc.queryForList(SELECT.replace("a.organizer_id AS organizerId", "a.organizer_id AS organizerId, a.risk_reasons AS riskReasons, a.review_note AS reviewNote")
                + " WHERE a.organizer_id = ? ORDER BY a.created_at DESC, a.id DESC", userId);
    }

    public List<Map<String, Object>> reviewQueue() {
        return jdbc.queryForList(SELECT.replace("a.organizer_id AS organizerId", "a.organizer_id AS organizerId, a.risk_reasons AS riskReasons")
                + " WHERE a.status = 'DRAFT' AND a.risk_level = 'REVIEW' ORDER BY a.created_at, a.id");
    }

    Map<String, Object> mine(long userId, long id) {
        return listMine(userId).stream().filter(row -> ((Number) row.get("id")).longValue() == id).findFirst().orElseThrow();
    }

    public void log(long activityId, long actorId, String from, String to, String reason) {
        jdbc.update("INSERT INTO activity_logs(activity_id, actor_id, from_status, to_status, reason) VALUES (?, ?, ?, ?, ?)",
                activityId, actorId, from, to, reason);
    }

    static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "활동을 찾을 수 없습니다.");
    }

}
