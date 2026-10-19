package com.volink.place;

import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PlaceController {
    private final PlaceService places;

    public PlaceController(PlaceService places) {
        this.places = places;
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
