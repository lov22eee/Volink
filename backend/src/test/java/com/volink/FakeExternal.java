package com.volink;

import com.volink.place.KakaoLocal;
import com.volink.volunteer.VolunteerApi;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Tests never call Kakao or data.go.kr. These stand-ins start "without a key" (like local development); a test turns them on. */
@TestConfiguration
public class FakeExternal {
    public static class Kakao implements KakaoLocal {
        public boolean enabled;
        public List<Place> results = new ArrayList<>();
        public Region region;
        public Map<String, Place> located = new HashMap<>();

        public void reset() { enabled = false; results = new ArrayList<>(); region = null; located = new HashMap<>(); }
        @Override public boolean enabled() { return enabled; }
        @Override public List<Place> keyword(String query, Double lat, Double lng) { return results; }
        @Override public List<Place> nearby(double lat, double lng) { return results; }
        @Override public Optional<Region> region(double lat, double lng) { return Optional.ofNullable(region); }
        @Override public Optional<Place> locate(String text, Double lat, Double lng) { return Optional.ofNullable(located.get(text)); }
    }

    public static class Volunteer implements VolunteerApi {
        public boolean enabled;
        public List<Map<String, String>> list = new ArrayList<>();
        public Map<String, Map<String, String>> details = new HashMap<>();
        public List<String> calls = new ArrayList<>();

        public void reset() { enabled = false; list = new ArrayList<>(); details = new HashMap<>(); calls = new ArrayList<>(); }
        @Override public boolean enabled() { return enabled; }
        @Override public List<Map<String, String>> areaList(String province, String city, String keyword, int rows) {
            calls.add("area:" + province + "/" + city + "/" + keyword);
            return list;
        }
        @Override public Optional<Map<String, String>> detail(String programNo) {
            calls.add("detail:" + programNo);
            return Optional.ofNullable(details.get(programNo));
        }
    }

    @Bean @Primary public Kakao fakeKakao() { return new Kakao(); }
    @Bean @Primary public Volunteer fakeVolunteer() { return new Volunteer(); }
}
