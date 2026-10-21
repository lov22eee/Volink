package com.volink.place;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Calls https://dapi.kakao.com with "KakaoAK {REST key}". Without KAKAO_REST_KEY every method returns nothing. */
@Component
public class KakaoLocalClient implements KakaoLocal {
    private static final Logger log = LoggerFactory.getLogger(KakaoLocalClient.class);
    /** Category groups looked up around a map pin (Kakao codes): sights/parks, culture, public offices, cafes, restaurants, hospitals. */
    static final List<String> NEARBY_GROUPS = List.of("AT4", "CT1", "PO3", "CE7", "FD6", "HP8");

    private final RestClient http;
    private final boolean enabled;

    public KakaoLocalClient(@Value("${volink.kakao.rest-key:}") String key) {
        this.enabled = !key.isBlank();
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(3));
        timeouts.setReadTimeout(Duration.ofSeconds(5));
        this.http = RestClient.builder().baseUrl("https://dapi.kakao.com").requestFactory(timeouts)
                .defaultHeader("Authorization", "KakaoAK " + key.trim()).build();
    }

    @Override
    public boolean enabled() {
        return enabled;
    }

    @Override
    public List<Place> keyword(String query, Double lat, Double lng) {
        if (!enabled) return List.of();
        String uri = lat == null ? "/v2/local/search/keyword.json?query={q}&size=15"
                : "/v2/local/search/keyword.json?query={q}&size=15&sort=distance&x={x}&y={y}";
        return places(lat == null ? get(uri, query) : get(uri, query, lng, lat));
    }

    @Override
    public List<Place> nearby(double lat, double lng) {
        if (!enabled) return List.of();
        Map<String, Place> found = new LinkedHashMap<>();
        for (String group : NEARBY_GROUPS)
            for (Place place : places(get("/v2/local/search/category.json?category_group_code={g}&x={x}&y={y}&radius=150&sort=distance&size=5", group, lng, lat)))
                found.putIfAbsent(place.id(), place);
        List<Place> sorted = new ArrayList<>(found.values());
        sorted.sort(Comparator.comparing(place -> place.distanceMeters() == null ? Integer.MAX_VALUE : place.distanceMeters()));
        return sorted.subList(0, Math.min(15, sorted.size()));
    }

    @Override
    public Optional<Region> region(double lat, double lng) {
        if (!enabled) return Optional.empty();
        JsonNode body = get("/v2/local/geo/coord2regioncode.json?x={x}&y={y}", lng, lat);
        if (body == null) return Optional.empty();
        for (JsonNode doc : body.path("documents"))
            if ("B".equals(doc.path("region_type").asText()) || "H".equals(doc.path("region_type").asText()))
                return Optional.of(new Region(doc.path("region_1depth_name").asText(), doc.path("region_2depth_name").asText()));
        return Optional.empty();
    }

    @Override
    public Optional<Place> locate(String text, Double nearLat, Double nearLng) {
        if (!enabled || text == null || text.isBlank()) return Optional.empty();
        List<Place> byName = keyword(text, nearLat, nearLng);
        if (!byName.isEmpty()) return Optional.of(byName.get(0));
        JsonNode body = get("/v2/local/search/address.json?query={q}&size=1", text);
        if (body == null) return Optional.empty();
        for (JsonNode doc : body.path("documents"))
            return Optional.of(new Place(null, text, null, null, doc.path("address_name").asText(), doc.path("y").asDouble(), doc.path("x").asDouble(), null));
        return Optional.empty();
    }

    private JsonNode get(String uri, Object... variables) {
        try {
            return http.get().uri(uri, variables).retrieve().body(JsonNode.class);
        } catch (RestClientException error) {
            // Never log the request headers (they carry the key).
            log.warn("Kakao Local request failed: {}", error.getClass().getSimpleName());
            return null;
        }
    }

    private static List<Place> places(JsonNode body) {
        if (body == null) return List.of();
        List<Place> places = new ArrayList<>();
        for (JsonNode doc : body.path("documents")) {
            String road = doc.path("road_address_name").asText("");
            places.add(new Place(doc.path("id").asText(), doc.path("place_name").asText(), doc.path("category_name").asText(""),
                    doc.path("category_group_code").asText(""), road.isBlank() ? doc.path("address_name").asText("") : road,
                    doc.path("y").asDouble(), doc.path("x").asDouble(),
                    doc.path("distance").asText("").isBlank() ? null : doc.path("distance").asInt()));
        }
        return places;
    }
}
