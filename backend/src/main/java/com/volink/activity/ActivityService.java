package com.volink.activity;

import com.volink.auth.AuthService;
import com.volink.auth.AuthUser;
import com.volink.common.ApiException;
import com.volink.place.PlaceService;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
                   a.status, a.risk_level AS riskLevel, a.organizer_id AS organizerId, u.display_name AS organizerName,
                   ST_Latitude(l.location) AS latitude, ST_Longitude(l.location) AS longitude
            FROM activities a
            JOIN categories c ON c.id = a.category_id
            JOIN users u ON u.id = a.organizer_id
            LEFT JOIN organizations o ON o.id = a.organization_id
            LEFT JOIN demo_places p ON p.id = a.place_id
            LEFT JOIN activity_locations l ON l.activity_id = a.id
            """;
    static final List<String> PUBLIC_STATUSES = List.of("RECRUITING", "IN_PROGRESS", "FINISHED");

    private final JdbcTemplate jdbc;
    private final ActivityRules rules;
    private final RiskClassifier risk;
    private final AuthService auth;
    private final Clock clock;
    private final PlaceService places;

    public ActivityService(JdbcTemplate jdbc, ActivityRules rules, RiskClassifier risk, AuthService auth, Clock clock, PlaceService places) {
        this.jdbc = jdbc;
        this.places = places;
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
        if (request.placeId() != null && !places.exists(request.placeId()))
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
        places.locate(id, request.placeId());
        log(id, userId, null, status, "개설 · 위험도 " + result.level());
        return mine(userId, id);
    }

    /** Search filters (all optional). With lat+lng only activities within radiusKm are returned, nearest first. */
    public record Search(Double lat, Double lng, Double radiusKm, String date, String category, String type) {
        public static final double DEFAULT_RADIUS_KM = 3;
        public static Search none() { return new Search(null, null, null, null, null, null); }
    }

    /**
     * Public list: only RECRUITING activities that have not started (REVIEW drafts and rejected ones never appear;
     * BLOCKED ones are never stored). The searcher's position is used for this query only and is not stored or logged.
     */
    public List<Map<String, Object>> listPublic(Search search) {
        Map<String, String> errors = new LinkedHashMap<>();
        boolean near = search.lat() != null || search.lng() != null;
        if (near && (search.lat() == null || search.lng() == null || search.lat() < -90 || search.lat() > 90 || search.lng() < -180 || search.lng() > 180))
            errors.put("location", "위치를 확인할 수 없습니다. 다시 시도해 주세요.");
        double radiusKm = search.radiusKm() == null ? Search.DEFAULT_RADIUS_KM : search.radiusKm();
        if (radiusKm < 0.5 || radiusKm > 10) errors.put("radiusKm", "검색 반경은 0.5~10km로 정해 주세요.");
        LocalDate date = null;
        if (search.date() != null && !search.date().isBlank()) {
            try { date = LocalDate.parse(search.date().trim()); } catch (DateTimeParseException e) { errors.put("date", "날짜 형식을 확인해 주세요."); }
        }
        String type = search.type() == null || search.type().isBlank() ? null : search.type().trim();
        if (type != null && !type.equals("GENERAL") && !type.equals("INSTITUTION")) errors.put("type", "활동 유형을 확인해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);

        List<Object> args = new ArrayList<>();
        StringBuilder sql = new StringBuilder(SELECT);
        if (near) {
            // The bounding box (MBRContains) lets MySQL use the spatial index; the sphere distance then trims the corners.
            String point = PlaceService.wkt(search.lat(), search.lng());
            sql.insert(SELECT.indexOf("ST_Latitude"), "ST_Distance_Sphere(l.location, " + PlaceService.POINT + ") AS distanceMeters, ");
            args.add(point);
            double dLat = radiusKm / 111.0, dLng = radiusKm / (111.0 * Math.cos(Math.toRadians(search.lat())));
            sql.append(" WHERE MBRContains(ST_PolygonFromText(?, 4326, 'axis-order=long-lat'), l.location)");
            args.add(box(search.lat() - dLat, search.lng() - dLng, search.lat() + dLat, search.lng() + dLng));
        } else sql.append(" WHERE 1 = 1");
        sql.append(" AND a.status = 'RECRUITING' AND a.starts_at > ?");
        args.add(LocalDateTime.now(clock));
        if (date != null) { sql.append(" AND a.starts_at >= ? AND a.starts_at < ?"); args.add(date.atStartOfDay()); args.add(date.plusDays(1).atStartOfDay()); }
        if (search.category() != null && !search.category().isBlank()) { sql.append(" AND c.name = ?"); args.add(search.category().trim()); }
        if (type != null) { sql.append(" AND a.activity_type = ?"); args.add(type); }
        if (near) { sql.append(" HAVING distanceMeters <= ? ORDER BY distanceMeters, a.starts_at, a.id"); args.add(radiusKm * 1000); }
        else sql.append(" ORDER BY a.starts_at, a.id");
        List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), args.toArray());
        if (near) rows.forEach(row -> row.put("distanceKm", Math.round(((Number) row.remove("distanceMeters")).doubleValue() / 100.0) / 10.0));
        return rows;
    }

    private static String box(double south, double west, double north, double east) {
        String sw = PlaceService.wkt(south, west), ne = PlaceService.wkt(north, east);
        String nw = PlaceService.wkt(north, west), se = PlaceService.wkt(south, east);
        return "POLYGON((" + inner(sw) + ", " + inner(se) + ", " + inner(ne) + ", " + inner(nw) + ", " + inner(sw) + "))";
    }

    private static String inner(String point) {
        return point.substring("POINT(".length(), point.length() - 1);
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
