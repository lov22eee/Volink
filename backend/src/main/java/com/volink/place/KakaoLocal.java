package com.volink.place;

import java.util.List;
import java.util.Optional;

/** Kakao Local REST API (server only; the REST key never reaches the browser). A test or a missing key swaps in another implementation. */
public interface KakaoLocal {
    boolean enabled();

    /** Keyword search, nearest first when a centre is given. */
    List<Place> keyword(String query, Double lat, Double lng);

    /** Places around a map pin: parks/sights, culture, public offices, cafes, restaurants, hospitals within ~150 m. */
    List<Place> nearby(double lat, double lng);

    /** Province and city/district at a point, e.g. ("경기도", "양주시"). */
    Optional<Region> region(double lat, double lng);

    /** Best coordinate for a free-text place or address (used for 1365 programs, which have no coordinates). */
    Optional<Place> locate(String text, Double nearLat, Double nearLng);

    record Place(String id, String name, String categoryName, String categoryGroup, String address, double latitude, double longitude, Integer distanceMeters) {}

    record Region(String province, String city) {}
}
