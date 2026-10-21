package com.volink.place;

import com.volink.auth.TokenService;
import com.volink.common.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Place search for the create form and the "지역 직접 고르기" box. With a Kakao REST key it searches Kakao; without one
 * it searches the admin-entered places only (the old three-place list), so local development still works.
 * Each Kakao result carries a server signature over its name, address, coordinate, category and class: the browser
 * sends the choice back with the activity and cannot change where the activity is or how the place was classified.
 */
@Service
public class PlaceSearchService {
    static final Duration TOKEN_TTL = Duration.ofHours(3);

    private final KakaoLocal kakao;
    private final JdbcTemplate jdbc;
    private final SecretKey key;
    private final Clock clock;

    public PlaceSearchService(KakaoLocal kakao, JdbcTemplate jdbc, TokenService tokens, Clock clock) {
        this.kakao = kakao;
        this.jdbc = jdbc;
        this.key = tokens.derive("place");
        this.clock = clock;
    }

    /** A place picked in the browser and sent back with the activity. */
    public record Choice(String kakaoId, String name, String address, String categoryName, Double latitude, Double longitude,
                         String placeClass, String classLabel, String token) {}

    public record Stored(long id, String placeClass, String classLabel) {}

    public Map<String, Object> search(String query, Double lat, Double lng) {
        String text = query == null ? "" : query.trim();
        if (text.isEmpty() || text.length() > 50) throw ApiException.validation(Map.of("query", "검색어를 1~50자로 입력해 주세요."));
        if (!kakao.enabled()) return localResult(text, lat, lng);
        return result("KAKAO", kakao.keyword(text, lat, lng).stream().map(this::view).toList());
    }

    public Map<String, Object> nearby(double lat, double lng) {
        if (!kakao.enabled()) return localResult("", lat, lng);
        return result("KAKAO", kakao.nearby(lat, lng).stream().map(this::view).toList());
    }

    private static Map<String, Object> result(String mode, List<Map<String, Object>> items) {
        return Map.of("mode", mode, "items", items);
    }

    private Map<String, Object> view(KakaoLocal.Place place) {
        PlaceClassifier.Result kind = PlaceClassifier.classify(place.categoryName(), place.categoryGroup(), place.name());
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("kakaoId", place.id());
        row.put("name", place.name());
        row.put("address", place.address());
        row.put("categoryName", place.categoryName());
        row.put("latitude", round(place.latitude()));
        row.put("longitude", round(place.longitude()));
        row.put("distanceMeters", place.distanceMeters());
        row.put("placeClass", kind.level().name());
        row.put("classLabel", kind.label());
        if (kind.level() != PlaceClassifier.Level.BLOCKED) {
            Choice choice = new Choice(place.id(), place.name(), place.address(), place.categoryName(), round(place.latitude()), round(place.longitude()),
                    kind.level().name(), kind.label(), null);
            row.put("token", sign(choice, clock.instant().plus(TOKEN_TTL).getEpochSecond()));
        }
        return row;
    }

    /** Fallback without a Kakao key: admin-entered places (they are parks, so OPEN). */
    private Map<String, Object> localResult(String text, Double lat, Double lng) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> place : jdbc.queryForList("""
                SELECT id, name, area, meeting_point, latitude, longitude, place_class, category_name FROM demo_places
                WHERE source = 'CURATED' AND (? = '' OR name LIKE CONCAT('%', ?, '%') OR area LIKE CONCAT('%', ?, '%')) ORDER BY id
                """, text, text, text)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("placeId", place.get("id"));
            row.put("name", place.get("name"));
            row.put("address", place.get("area"));
            row.put("categoryName", place.get("category_name") == null ? "공원" : place.get("category_name"));
            row.put("latitude", place.get("latitude"));
            row.put("longitude", place.get("longitude"));
            row.put("meetingPoint", place.get("meeting_point"));
            row.put("distanceMeters", lat == null || lng == null || place.get("latitude") == null ? null
                    : (int) Math.round(meters(lat, lng, ((Number) place.get("latitude")).doubleValue(), ((Number) place.get("longitude")).doubleValue())));
            row.put("placeClass", place.get("place_class"));
            row.put("classLabel", "공원");
            rows.add(row);
        }
        return result("LOCAL", rows);
    }

    /** Checks the signature and stores (or reuses) the place. BLOCKED places never get a signature. */
    public Stored store(Choice choice) {
        if (choice == null || choice.token() == null || !valid(choice))
            throw ApiException.validation(Map.of("place", "장소를 다시 검색해서 골라 주세요."));
        String name = cut(choice.name(), 100);
        jdbc.update("""
                INSERT INTO demo_places(name, area, address_note, latitude, longitude, coordinate_status, source, kakao_place_id, category_name, place_class)
                VALUES (?, ?, ?, ?, ?, 'ENTERED', 'KAKAO', ?, ?, ?)
                ON DUPLICATE KEY UPDATE name = VALUES(name), area = VALUES(area), latitude = VALUES(latitude), longitude = VALUES(longitude),
                                        category_name = VALUES(category_name), place_class = VALUES(place_class)
                """, name, cut(choice.address(), 100), "카카오 장소 검색: " + cut(choice.categoryName(), 200),
                BigDecimal.valueOf(choice.latitude()), BigDecimal.valueOf(choice.longitude()), choice.kakaoId(), cut(choice.categoryName(), 200), choice.placeClass());
        long id = jdbc.queryForObject("SELECT id FROM demo_places WHERE kakao_place_id = ?", Long.class, choice.kakaoId());
        return new Stored(id, choice.placeClass(), choice.classLabel());
    }

    private boolean valid(Choice choice) {
        String[] parts = choice.token().split("\\.", 2);
        if (parts.length != 2 || choice.latitude() == null || choice.longitude() == null || choice.kakaoId() == null) return false;
        long expires;
        try { expires = Long.parseLong(parts[0]); } catch (NumberFormatException e) { return false; }
        if (clock.instant().getEpochSecond() > expires) return false;
        if (!"OPEN".equals(choice.placeClass()) && !"REVIEW".equals(choice.placeClass())) return false;
        return MessageDigest.isEqual(sign(choice, expires).getBytes(StandardCharsets.US_ASCII), choice.token().getBytes(StandardCharsets.US_ASCII));
    }

    String sign(Choice c, long expires) {
        String body = String.join("\u001f", String.valueOf(expires), c.kakaoId(), c.name(), String.valueOf(c.address()), String.valueOf(c.categoryName()),
                BigDecimal.valueOf(c.latitude()).toPlainString(), BigDecimal.valueOf(c.longitude()).toPlainString(), c.placeClass(), String.valueOf(c.classLabel()));
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return expires + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static double round(double value) {
        return BigDecimal.valueOf(value).setScale(7, RoundingMode.HALF_UP).doubleValue();
    }

    private static String cut(String value, int max) {
        String text = value == null ? "" : value.trim();
        return text.length() > max ? text.substring(0, max) : text;
    }

    static double meters(double lat1, double lng1, double lat2, double lng2) {
        double r = 6_371_000, dLat = Math.toRadians(lat2 - lat1), dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    static void requireCoordinate(Double lat, Double lng) {
        if (lat == null || lng == null || lat < 33 || lat > 39 || lng < 124 || lng > 132)
            throw ApiException.validation(Map.of("location", "위치를 확인할 수 없습니다. 다시 시도해 주세요."));
    }

    public static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SEARCH_UNAVAILABLE", "장소 검색을 잠시 쓸 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
}
