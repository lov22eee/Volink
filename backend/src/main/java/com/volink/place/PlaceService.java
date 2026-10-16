package com.volink.place;

import com.volink.common.ApiException;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Activity places. Coordinates are entered by an admin (copied from Kakao map), never guessed.
 * Every activity at a place with coordinates gets an activity_locations row (SRID 4326 point) for radius search.
 */
@Service
public class PlaceService {
    /** WKT for a WGS84 point written longitude first; MySQL's default axis order for 4326 is latitude first. */
    public static final String POINT = "ST_PointFromText(?, 4326, 'axis-order=long-lat')";

    private final JdbcTemplate jdbc;
    private final Clock clock;

    public PlaceService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public List<Map<String, Object>> list() {
        return jdbc.queryForList("""
                SELECT id, name, area, address_note AS addressNote, meeting_point AS meetingPoint,
                       latitude, longitude, coordinate_status AS coordinateStatus
                FROM demo_places ORDER BY id
                """);
    }

    public boolean exists(long id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM demo_places WHERE id = ?", Integer.class, id) > 0;
    }

    public record CoordinateRequest(BigDecimal latitude, BigDecimal longitude, String meetingPoint, String reason) {}

    @Transactional
    public Map<String, Object> updateCoordinates(long adminId, long id, CoordinateRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        if (request.latitude() == null || request.latitude().compareTo(BigDecimal.valueOf(33)) < 0 || request.latitude().compareTo(BigDecimal.valueOf(39)) > 0)
            errors.put("latitude", "위도는 33~39 사이 숫자로 입력해 주세요. (예: 37.8)");
        if (request.longitude() == null || request.longitude().compareTo(BigDecimal.valueOf(124)) < 0 || request.longitude().compareTo(BigDecimal.valueOf(132)) > 0)
            errors.put("longitude", "경도는 124~132 사이 숫자로 입력해 주세요. (예: 127.1)");
        String meetingPoint = request.meetingPoint() == null ? "" : request.meetingPoint().trim();
        if (meetingPoint.length() > 255) errors.put("meetingPoint", "만남 지점은 255자 이내로 입력해 주세요.");
        String reason = request.reason() == null || request.reason().isBlank() ? "장소 좌표 입력" : request.reason().trim();
        if (reason.length() > 500) errors.put("reason", "사유는 500자 이내로 입력해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        String from = jdbc.queryForList("SELECT coordinate_status FROM demo_places WHERE id = ? FOR UPDATE", String.class, id)
                .stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "장소를 찾을 수 없습니다."));

        jdbc.update("""
                UPDATE demo_places SET latitude = ?, longitude = ?, meeting_point = ?, coordinate_status = 'ENTERED',
                       coordinates_updated_by = ?, coordinates_updated_at = ? WHERE id = ?
                """, request.latitude(), request.longitude(), meetingPoint.isEmpty() ? null : meetingPoint, adminId, LocalDateTime.now(clock), id);
        // Existing activities at this place move with it.
        jdbc.update("DELETE l FROM activity_locations l JOIN activities a ON a.id = l.activity_id WHERE a.place_id = ?", id);
        jdbc.update("""
                INSERT INTO activity_locations(activity_id, place_name, address, latitude, longitude, location)
                SELECT a.id, p.name, COALESCE(p.meeting_point, p.area), p.latitude, p.longitude, %s
                FROM activities a JOIN demo_places p ON p.id = a.place_id WHERE p.id = ?
                """.formatted(POINT), wkt(request.latitude(), request.longitude()), id);
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, 'PLACE', ?, 'SET_COORDINATES', ?, 'ENTERED', ?)",
                adminId, id, from, reason);
        return list().stream().filter(row -> ((Number) row.get("id")).longValue() == id).findFirst().orElseThrow();
    }

    /** Called when an activity is created: copies the place coordinate, if the place has one. */
    public void locate(long activityId, Long placeId) {
        if (placeId == null) return;
        jdbc.queryForList("SELECT latitude, longitude FROM demo_places WHERE id = ? AND latitude IS NOT NULL", placeId).stream().findFirst()
                .ifPresent(place -> jdbc.update("""
                        INSERT INTO activity_locations(activity_id, place_name, address, latitude, longitude, location)
                        SELECT ?, name, COALESCE(meeting_point, area), latitude, longitude, %s FROM demo_places WHERE id = ?
                        """.formatted(POINT), activityId, wkt((BigDecimal) place.get("latitude"), (BigDecimal) place.get("longitude")), placeId));
    }

    public static String wkt(Number latitude, Number longitude) {
        return "POINT(" + plain(longitude) + " " + plain(latitude) + ")";
    }

    private static String plain(Number value) {
        return (value instanceof BigDecimal decimal ? decimal : BigDecimal.valueOf(value.doubleValue())).toPlainString();
    }
}
