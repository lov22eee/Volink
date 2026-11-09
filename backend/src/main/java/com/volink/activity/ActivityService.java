package com.volink.activity;

import com.volink.auth.AuthService;
import com.volink.auth.AuthUser;
import com.volink.common.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.volink.place.PlaceSearchService;
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
                   o.name AS organizationName, a.place_id AS placeId, p.name AS placeName, p.area AS placeAddress, a.meeting_point AS meetingPoint, a.supplies,
                   DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date, DATE_FORMAT(a.starts_at, '%H:%i') AS startTime,
                   TIMESTAMPDIFF(MINUTE, a.starts_at, a.ends_at) AS durationMinutes, a.capacity,
                   a.difficulty, a.place_kind AS placeKind, a.newcomer_ok AS newcomerOk, a.auto_approve AS autoApprove, a.reschedule_count AS rescheduleCount, DATE_FORMAT(a.checkin_opened_at, '%Y-%m-%dT%H:%i:%s') AS checkinOpenedAt, a.cancel_reason AS cancelReason,
                   (SELECT COUNT(*) FROM participations x WHERE x.activity_id = a.id AND x.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')) AS confirmed,
                   (SELECT COUNT(*) FROM participations x WHERE x.activity_id = a.id AND x.status = 'WAITLISTED') AS waiting,
                   a.status, a.risk_level AS riskLevel, a.organizer_id AS organizerId,
                   COALESCE(u.community_nickname, CONCAT(LEFT(u.display_name, 1), '*', IF(CHAR_LENGTH(u.display_name) > 2, RIGHT(u.display_name, 1), ''))) AS organizerName,
                   u.community_nickname IS NOT NULL AS organizerNicknamed,
                   ST_Latitude(l.location) AS latitude, ST_Longitude(l.location) AS longitude
            FROM activities a
            JOIN categories c ON c.id = a.category_id
            JOIN users u ON u.id = a.organizer_id
            LEFT JOIN organizations o ON o.id = a.organization_id
            LEFT JOIN demo_places p ON p.id = a.place_id
            LEFT JOIN activity_locations l ON l.activity_id = a.id
            """;
    /** For the organizer's own list (home "지금 할 일"): applications to answer, questions without an answer, check-ins. */
    private static final String TODO = """
            (SELECT COUNT(*) FROM participations x WHERE x.activity_id = a.id AND x.status = 'APPLIED') AS pending,
            (SELECT COUNT(*) FROM participations x WHERE x.activity_id = a.id AND x.status = 'CHECKED_IN') AS checkedIn,
            (SELECT COUNT(*) FROM participations x WHERE x.activity_id = a.id AND x.status = 'COMPLETED') AS completed,
            (SELECT COUNT(*) FROM activity_posts q WHERE q.activity_id = a.id AND q.kind = 'QUESTION' AND q.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM activity_posts r WHERE r.parent_id = q.id AND r.deleted_at IS NULL)) AS unanswered""";
    static final List<String> PUBLIC_STATUSES = List.of("RECRUITING", "IN_PROGRESS", "FINISHED");

    private final JdbcTemplate jdbc;
    private final ActivityRules rules;
    private final RiskClassifier risk;
    private final AuthService auth;
    private final Clock clock;
    private final PlaceService places;
    private final PlaceSearchService placeSearch;
    private final ObjectMapper json;

    public ActivityService(JdbcTemplate jdbc, ActivityRules rules, RiskClassifier risk, AuthService auth, Clock clock, PlaceService places,
                           PlaceSearchService placeSearch, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
        this.places = places;
        this.placeSearch = placeSearch;
        this.rules = rules;
        this.risk = risk;
        this.auth = auth;
        this.clock = clock;
    }

    @Transactional
    /** Risk words per field while the organizer types (the same words the save checks; long input is cut, not refused). */
    public Map<String, Object> check(ActivityController.CheckRequest request) {
        java.util.function.Function<String, String> cut = text -> text == null ? "" : text.length() > 2000 ? text.substring(0, 2000) : text;
        String supplies = request.supplies() == null ? "" : String.join(" ", request.supplies().stream().limit(10).map(name -> cut.apply(name)).toList());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("title", risk.words(cut.apply(request.title())));
        result.put("description", risk.words(cut.apply(request.description())));
        result.put("supplies", risk.words(supplies));
        return result;
    }

    public Map<String, Object> create(long userId, ActivityRequest request) {
        return save(userId, request, null);
    }

    /**
     * Organizer edit: everything can change while nobody has applied and the activity has not started. The risk check
     * runs again (an approved activity edited into a REVIEW one goes back to an admin; BLOCKED changes nothing).
     */
    @Transactional
    public Map<String, Object> update(long userId, long id, ActivityRequest request) {
        return save(userId, request, editable(userId, id, true));
    }

    /** Small edits allowed even after people applied: the description and the meeting point (risk words still checked). */
    @Transactional
    public Map<String, Object> updateNotes(long userId, long id, String description, String meetingPoint) {
        Map<String, Object> row = editable(userId, id, false);
        String text = ActivityRules.trim(description), meeting = ActivityRules.trim(meetingPoint);
        Map<String, String> errors = new LinkedHashMap<>();
        if (text.length() < 20 || text.length() > 2000) errors.put("description", "활동 소개는 20~2000자로 적어 주세요.");
        if (meeting.length() > 100) errors.put("meetingPoint", "만나는 곳은 100자 이내로 적어 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        RiskClassifier.Result result = risk.classify((String) row.get("title"), text, (String) row.get("category"), (LocalDateTime) row.get("ends_at"), placeReview(((Number) row.get("place_id")).longValue()));
        if ("BLOCKED".equals(result.level())) throw blocked(result);
        String from = (String) row.get("status");
        String status = "REVIEW".equals(result.level()) ? "DRAFT" : from;
        jdbc.update("UPDATE activities SET description = ?, meeting_point = ?, status = ?, risk_level = CASE WHEN ? = 'REVIEW' THEN 'REVIEW' ELSE risk_level END, risk_reasons = COALESCE(?, risk_reasons) WHERE id = ?",
                text, meeting.isEmpty() ? null : meeting, status, result.level(), result.reasons().isEmpty() ? null : String.join(", ", result.reasons()), id);
        log(id, userId, from, status, "소개·만나는 곳 수정");
        return mine(userId, id);
    }

    /** Deleting keeps the row (logs point to it) as DELETED, hidden from every list. Only before anyone applied. */
    @Transactional
    public void delete(long userId, long id) {
        Map<String, Object> row = editable(userId, id, true);
        jdbc.update("UPDATE activities SET status = 'DELETED' WHERE id = ?", id);
        jdbc.update("DELETE FROM activity_locations WHERE activity_id = ?", id);
        log(id, userId, (String) row.get("status"), "DELETED", "모집자가 삭제");
    }

    /** The organizer's own, not deleted, not started activity (others get 404). fully = no active applications either. */
    private Map<String, Object> editable(long userId, long id, boolean fully) {
        Map<String, Object> row = jdbc.queryForList("""
                SELECT a.id, a.organizer_id, a.status, a.title, a.place_id, a.starts_at, a.ends_at, c.name AS category
                FROM activities a JOIN categories c ON c.id = a.category_id WHERE a.id = ? FOR UPDATE
                """, id).stream().findFirst().orElseThrow(ActivityService::notFound);
        if (((Number) row.get("organizer_id")).longValue() != userId || "DELETED".equals(row.get("status"))) throw notFound();
        if (!List.of("DRAFT", "RECRUITING").contains(row.get("status")) || !((LocalDateTime) row.get("starts_at")).isAfter(LocalDateTime.now(clock)))
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "시작했거나 반려·종료된 활동은 고칠 수 없습니다.");
        if (fully && activeApplications(id) > 0)
            throw new ApiException(HttpStatus.CONFLICT, "HAS_APPLICANTS", "신청한 사람이 있어 소개와 만나는 곳만 고칠 수 있습니다.");
        return row;
    }

    /** Applications that still count (week 5 adds the screens; the table exists since V1). */
    public int activeApplications(long activityId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED')",
                Integer.class, activityId);
    }

    /** Why the stored place needs a look ("요양·복지시설"), or null for an open place. */
    private String placeReview(long placeId) {
        return jdbc.queryForList("SELECT name, category_name, place_class FROM demo_places WHERE id = ?", placeId).stream().findFirst()
                .filter(place -> "REVIEW".equals(place.get("place_class")))
                .map(place -> com.volink.place.PlaceClassifier.classify((String) place.get("category_name"), null, (String) place.get("name")).label())
                .orElse(null);
    }

    private static ApiException blocked(RiskClassifier.Result result) {
        return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "ACTIVITY_BLOCKED",
                "등록할 수 없는 활동입니다. " + String.join(", ", result.reasons()), Map.of("risk", String.join(", ", result.reasons())));
    }

    private Map<String, Object> save(long userId, ActivityRequest request, Map<String, Object> existing) {
        AuthUser user = auth.findById(userId);
        if (user.admin()) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 계정은 활동을 개설할 수 없습니다.");
        if (!user.canWrite()) throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_RESTRICTED", "이용이 제한된 계정은 활동을 개설할 수 없습니다.");

        ActivityRules.Checked[] times = new ActivityRules.Checked[1];
        Map<String, String> errors = rules.validate(request, times);
        String category = ActivityRules.trim(request.category());
        Long categoryId = jdbc.queryForList("SELECT id FROM categories WHERE name = ? AND active", Long.class, category).stream().findFirst().orElse(null);
        if (categoryId == null) errors.putIfAbsent("category", "분야를 선택해 주세요.");
        // On an edit the current place may stay as it is (it can be a searched place, which is not in the public list).
        boolean samePlace = existing != null && request.placeId() != null && request.placeId() == ((Number) existing.get("place_id")).longValue();
        if (request.place() == null && request.placeId() != null && !samePlace && !places.exists(request.placeId()))
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

        // A searched place is checked (signature) and stored only now, after every other field passed.
        Long placeId = request.placeId();
        String placeReview = samePlace ? placeReview(placeId) : null;
        if (request.place() != null) {
            PlaceSearchService.Stored stored = placeSearch.store(request.place());
            placeId = stored.id();
            if ("REVIEW".equals(stored.placeClass())) placeReview = stored.classLabel();
        }
        String meetingPoint = ActivityRules.trim(request.meetingPoint());
        String title = ActivityRules.trim(request.title());
        String description = ActivityRules.trim(request.description());
        List<Map<String, Object>> supplies = request.supplies() == null ? List.of() : request.supplies().stream()
                .map(supply -> Map.<String, Object>of("name", ActivityRules.trim(supply.name()), "provided", Boolean.TRUE.equals(supply.provided()))).toList();
        // Supply names are checked for risky words too (e.g. a ladder to bring).
        String supplyText = supplies.stream().map(supply -> " " + supply.get("name")).reduce("", String::concat);
        RiskClassifier.Result result = risk.classify(title, description + supplyText, category, times[0].endsAt(), placeReview);
        if ("BLOCKED".equals(result.level())) throw blocked(result);

        String status = "LOW".equals(result.level()) ? "RECRUITING" : "DRAFT";
        if (existing != null) {
            long id = ((Number) existing.get("id")).longValue();
            jdbc.update("""
                    UPDATE activities SET category_id = ?, activity_type = ?, organization_id = ?, place_id = ?, meeting_point = ?, supplies = ?,
                           title = ?, description = ?, starts_at = ?, ends_at = ?, capacity = ?, risk_level = ?, risk_reasons = ?, status = ?, review_note = NULL,
                           difficulty = ?, place_kind = ?, newcomer_ok = ?, auto_approve = COALESCE(?, auto_approve)
                    WHERE id = ?
                    """, categoryId, institution ? "INSTITUTION" : "GENERAL", organizationId, placeId, meetingPoint.isEmpty() ? null : meetingPoint,
                    supplies.isEmpty() ? null : write(supplies), title, description, times[0].startsAt(), times[0].endsAt(), request.capacity(),
                    result.level(), result.reasons().isEmpty() ? null : String.join(", ", result.reasons()), status,
                    request.difficultyOrDefault(), request.placeKindOrDefault(), request.newcomer(), request.autoApprove(), id);
            jdbc.update("DELETE FROM activity_locations WHERE activity_id = ?", id);
            places.locate(id, placeId);
            log(id, userId, (String) existing.get("status"), status, "수정 · 위험도 " + result.level());
            return mine(userId, id);
        }
        jdbc.update("""
                INSERT INTO activities(organizer_id, category_id, activity_type, organization_id, place_id, meeting_point, supplies, title, description,
                                       starts_at, ends_at, capacity, risk_level, risk_reasons, status, difficulty, place_kind, newcomer_ok, auto_approve)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, userId, categoryId, institution ? "INSTITUTION" : "GENERAL", organizationId, placeId, meetingPoint.isEmpty() ? null : meetingPoint,
                supplies.isEmpty() ? null : write(supplies), title, description,
                times[0].startsAt(), times[0].endsAt(), request.capacity(),
                result.level(), result.reasons().isEmpty() ? null : String.join(", ", result.reasons()), status,
                request.difficultyOrDefault(), request.placeKindOrDefault(), request.newcomer(), Boolean.TRUE.equals(request.autoApprove()));
        long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        places.locate(id, placeId);
        log(id, userId, null, status, "개설 · 위험도 " + result.level());
        return mine(userId, id);
    }

    /** Search filters (all optional). With lat+lng only activities within radiusKm are returned, nearest first.
     *  4주차 보완: q (words in the title, description or place), from/to (date range), part (AM = starts before noon, PM = from noon). */
    /**
     * {@code category}: one name or several separated by commas (V17, 7 categories). {@code status} (optional):
     * OPEN = seats left, WAITLIST = also full ones whose waitlist is still open (until 2 h before), ALL = also
     * closed ones (full with the waitlist closed, started or finished in the last 30 days; never cancelled or
     * deleted). Without it the list is as before (recruiting and not started, full ones included).
     * {@code sido}/{@code sigungu}: the place's address starts with the province and names the district.
     */
    public record Search(Double lat, Double lng, Double radiusKm, String date, String category, String type,
                         String q, String from, String to, String part, String status, String sido, String sigungu) {
        public static final double DEFAULT_RADIUS_KM = 3;
        public static final double MAX_RADIUS_KM = 20;
        public Search(Double lat, Double lng, Double radiusKm, String date, String category, String type, String q, String from, String to, String part) {
            this(lat, lng, radiusKm, date, category, type, q, from, to, part, null, null, null);
        }
        public static Search none() { return new Search(null, null, null, null, null, null, null, null, null, null); }
    }

    /** "환경,교육" → [환경, 교육]; blank or 전체 → none. */
    public static List<String> categoryList(String value) {
        if (value == null || value.isBlank()) return List.of();
        return java.util.Arrays.stream(value.split(",")).map(String::trim).filter(name -> !name.isEmpty() && !name.equals("전체")).distinct().toList();
    }

    private static final String SEATS_TAKEN = "(SELECT COUNT(*) FROM participations s WHERE s.activity_id = a.id AND s.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'OFFERED'))";

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
        if (radiusKm < 0.5 || radiusKm > Search.MAX_RADIUS_KM) errors.put("radiusKm", "검색 반경은 0.5~20km로 정해 주세요.");
        LocalDate date = day(search.date(), "date", errors), from = day(search.from(), "from", errors), to = day(search.to(), "to", errors);
        String q = search.q() == null ? "" : search.q().trim();
        if (q.length() > 50) errors.put("q", "검색어는 50자 이내로 입력해 주세요.");
        String part = search.part() == null || search.part().isBlank() ? null : search.part().trim();
        if (part != null && !part.equals("AM") && !part.equals("PM")) errors.put("part", "시간대를 확인해 주세요.");
        String type = search.type() == null || search.type().isBlank() ? null : search.type().trim();
        if (type != null && !type.equals("GENERAL") && !type.equals("INSTITUTION")) errors.put("type", "활동 유형을 확인해 주세요.");
        String status = search.status() == null || search.status().isBlank() ? null : search.status().trim().toUpperCase(java.util.Locale.ROOT);
        if (status != null && !List.of("OPEN", "WAITLIST", "ALL").contains(status)) errors.put("status", "모집 상태를 확인해 주세요.");
        List<String> categories = categoryList(search.category());
        if (categories.size() > 7) errors.put("category", "분야를 확인해 주세요.");
        String sido = search.sido() == null ? "" : search.sido().trim(), sigungu = search.sigungu() == null ? "" : search.sigungu().trim();
        if (sido.length() > 20 || sigungu.length() > 20 || (!sigungu.isEmpty() && sido.isEmpty())) errors.put("sido", "지역을 확인해 주세요.");
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
        LocalDateTime now = LocalDateTime.now(clock);
        if (status == null) { sql.append(" AND a.status = 'RECRUITING' AND a.starts_at > ?"); args.add(now); }
        else if (status.equals("OPEN")) { sql.append(" AND a.status = 'RECRUITING' AND a.starts_at > ? AND " + SEATS_TAKEN + " < a.capacity"); args.add(now); }
        else if (status.equals("WAITLIST")) {
            // Full ones only while the waitlist is open (it closes 2 h before the start).
            sql.append(" AND a.status = 'RECRUITING' AND a.starts_at > ? AND (" + SEATS_TAKEN + " < a.capacity OR a.starts_at > ?)");
            args.add(now); args.add(now.plusHours(2));
        } else {
            sql.append(" AND ((a.status = 'RECRUITING' AND a.starts_at > ?) OR (a.status IN ('RECRUITING', 'IN_PROGRESS', 'FINISHED') AND a.starts_at > ?))");
            args.add(now); args.add(now.minusDays(30));
        }
        if (date != null) { sql.append(" AND a.starts_at >= ? AND a.starts_at < ?"); args.add(date.atStartOfDay()); args.add(date.plusDays(1).atStartOfDay()); }
        if (from != null) { sql.append(" AND a.starts_at >= ?"); args.add(from.atStartOfDay()); }
        if (to != null) { sql.append(" AND a.starts_at < ?"); args.add(to.plusDays(1).atStartOfDay()); }
        if (part != null) sql.append(part.equals("AM") ? " AND HOUR(a.starts_at) < 12" : " AND HOUR(a.starts_at) >= 12");
        if (!q.isEmpty()) {
            // The typed word and its group (강아지 → 유기견·반려동물 …), plus the category it points to (강아지 → 동물).
            List<String> words = com.volink.common.SearchWords.expand(q);
            List<String> parts = new ArrayList<>();
            for (String word : words) {
                String like = "%" + like(word) + "%";
                parts.add("a.title LIKE ? OR a.description LIKE ? OR p.name LIKE ?");
                args.add(like); args.add(like); args.add(like);
            }
            java.util.Optional<String> pointed = com.volink.common.SearchWords.category(q);
            if (pointed.isPresent()) { parts.add("c.name = ?"); args.add(pointed.get()); }
            sql.append(" AND (").append(String.join(" OR ", parts)).append(")");
        }
        if (!categories.isEmpty()) {
            sql.append(" AND c.name IN (").append(String.join(", ", categories.stream().map(name -> "?").toList())).append(")");
            args.addAll(categories);
        }
        if (!sido.isEmpty()) {
            // Kakao addresses start with the short province ("서울 강북구 …", "경기 양주시 …"); a district may also be written
            // without 시/군/구 ("양주 · 옥정동"), so it is matched by its stem.
            sql.append(" AND p.area LIKE ?");
            args.add(like(shortSido(sido)) + "%");
            if (!sigungu.isEmpty()) { sql.append(" AND p.area LIKE ?"); args.add("%" + like(sigungu.length() > 2 ? sigungu.substring(0, sigungu.length() - 1) : sigungu) + "%"); }
        }
        if (type != null) { sql.append(" AND a.activity_type = ?"); args.add(type); }
        if (near) { sql.append(" HAVING distanceMeters <= ? ORDER BY distanceMeters, a.starts_at, a.id"); args.add(radiusKm * 1000); }
        else sql.append(" ORDER BY a.starts_at, a.id");
        List<Map<String, Object>> rows = withSupplies(jdbc.queryForList(sql.toString(), args.toArray()));
        if (near) rows.forEach(row -> row.put("distanceKm", Math.round(((Number) row.remove("distanceMeters")).doubleValue() / 100.0) / 10.0));
        return rows;
    }

    private static String like(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /** 서울특별시 → 서울, 경기도 → 경기, 충청북도 → 충북 (as Kakao writes addresses). */
    static String shortSido(String sido) {
        return switch (sido) {
            case "충청북도" -> "충북"; case "충청남도" -> "충남"; case "전라북도", "전북특별자치도" -> "전북"; case "전라남도" -> "전남";
            case "경상북도" -> "경북"; case "경상남도" -> "경남";
            default -> sido.replaceAll("(특별자치시|특별자치도|특별시|광역시|도)$", "");
        };
    }

    /** The JSON column arrives as text; the API returns it as a list ([] when none). */
    private List<Map<String, Object>> withSupplies(List<Map<String, Object>> rows) {
        for (Map<String, Object> row : rows) {
            Object raw = row.get("supplies");
            try {
                row.put("supplies", raw == null ? List.of() : json.readValue(raw.toString(), List.class));
            } catch (JsonProcessingException broken) {
                row.put("supplies", List.of());
            }
        }
        return rows;
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static LocalDate day(String value, String field, Map<String, String> errors) {
        if (value == null || value.isBlank()) return null;
        try { return LocalDate.parse(value.trim()); } catch (DateTimeParseException e) { errors.put(field, "날짜 형식을 확인해 주세요."); return null; }
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
        Map<String, Object> activity = withSupplies(jdbc.queryForList(SELECT + " WHERE a.id = ?", id)).stream().findFirst().orElseThrow(ActivityService::notFound);
        boolean organizer = viewerId != null && viewerId.equals(((Number) activity.get("organizerId")).longValue());
        // Week 6: someone who applied still sees an activity the organizer cancelled (with the reason).
        boolean applied = viewerId != null && "CANCELLED".equals(activity.get("status")) && activity.get("cancelReason") != null
                && jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND user_id = ?", Integer.class, id, viewerId) > 0;
        boolean visible = PUBLIC_STATUSES.contains(activity.get("status")) || applied
                || viewerId != null && !"DELETED".equals(activity.get("status")) && (organizer || auth.findById(viewerId).admin());
        if (!visible) throw notFound();
        // Week 7 (공개 이름 통일): everyone sees the organizer's community nickname (or a partly hidden name); the real
        // name only reaches the organizer, admins and people confirmed for this activity (they meet in person).
        if (viewerId != null && (organizer || auth.findById(viewerId).admin() || jdbc.queryForObject(
                "SELECT COUNT(*) FROM participations WHERE activity_id = ? AND user_id = ? AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')", Integer.class, id, viewerId) > 0))
            activity.put("organizerRealName", jdbc.queryForObject("SELECT display_name FROM users WHERE id = ?", String.class, activity.get("organizerId")));
        // Instead of a name: what this organizer has done on Volink (activities opened and finished).
        activity.put("organizerStats", jdbc.queryForMap("""
                SELECT COALESCE(SUM(status IN ('RECRUITING', 'IN_PROGRESS', 'FINISHED')), 0) AS hosted, COALESCE(SUM(status = 'FINISHED'), 0) AS finished
                FROM activities WHERE organizer_id = ?""", activity.get("organizerId")));
        if (activity.get("organizerNicknamed") instanceof Number n) activity.put("organizerNicknamed", n.intValue() == 1);
        // The organizer sees how many applications lock the full edit (week 5 adds applying).
        if (organizer) activity.put("applicants", activeApplications(id));
        // Cancelled by the organizer: reason, message, time and who was affected (shown to the organizer and applicants).
        if ("CANCELLED".equals(activity.get("status"))) jdbc.queryForList("""
                SELECT reason_code AS reasonCode, message, status_before AS statusBefore, confirmed_count AS confirmedCount, waiting_count AS waitingCount,
                       applied_count AS appliedCount, DATE_FORMAT(cancelled_at, '%Y-%m-%d %H:%i') AS cancelledAt
                FROM activity_cancellations WHERE activity_id = ?""", id).stream().findFirst().ifPresent(c -> {
            c.put("reasonLabel", ActivityChangeService.REASONS.get(c.get("reasonCode")));
            activity.put("cancellation", c);
        });
        return activity;
    }

    public List<Map<String, Object>> listMine(long userId) {
        return withSupplies(jdbc.queryForList(SELECT.replace("a.organizer_id AS organizerId", "a.organizer_id AS organizerId, a.risk_reasons AS riskReasons, a.review_note AS reviewNote, " + TODO)
                + " WHERE a.organizer_id = ? AND a.status <> 'DELETED' ORDER BY a.created_at DESC, a.id DESC", userId));
    }

    public List<Map<String, Object>> reviewQueue() {
        return withSupplies(jdbc.queryForList(SELECT.replace("a.organizer_id AS organizerId", "a.organizer_id AS organizerId, a.risk_reasons AS riskReasons")
                + " WHERE a.status = 'DRAFT' AND a.risk_level = 'REVIEW' ORDER BY a.created_at, a.id"));
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
