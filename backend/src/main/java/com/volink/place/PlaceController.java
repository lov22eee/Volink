package com.volink.place;

import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PlaceController {
    private final PlaceService places;
    private final PlaceSearchService search;
    private final SearchLimiter limiter;

    public PlaceController(PlaceService places, PlaceSearchService search, SearchLimiter limiter) {
        this.places = places;
        this.search = search;
        this.limiter = limiter;
    }

    /** Public (also used by "지역 직접 고르기" before login). Kakao keyword search; without a key, the admin-entered places. */
    @GetMapping("/api/places/search")
    public Map<String, Object> search(@RequestParam(required = false) String query, @RequestParam(required = false) Double lat,
                                      @RequestParam(required = false) Double lng, HttpServletRequest request) {
        limiter.check(request);
        return search.search(query, lat, lng);
    }

    /** Places around the map pin (Kakao category search within ~150 m). */
    @GetMapping("/api/places/nearby")
    public Map<String, Object> nearby(@RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng, HttpServletRequest request) {
        PlaceSearchService.requireCoordinate(lat, lng);
        limiter.check(request);
        return search.nearby(lat, lng);
    }

    /** A spot picked on the map without a place there (street, alley, empty lot): its address, signed, always REVIEW. */
    @GetMapping("/api/places/point")
    public Map<String, Object> point(@RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng, HttpServletRequest request) {
        PlaceSearchService.requireCoordinate(lat, lng);
        limiter.check(request);
        return search.point(lat, lng);
    }

    /** Public: place names and coordinates for the map and the create form. */
    @GetMapping("/api/places")
    public List<Map<String, Object>> list() {
        return places.list();
    }

    /** /api/admin/** is ADMIN only (SecurityConfig). */
    @PutMapping("/api/admin/places/{id}")
    public Map<String, Object> update(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody PlaceService.CoordinateRequest request) {
        return places.updateCoordinates(Long.parseLong(jwt.getSubject()), id, request);
    }
}
