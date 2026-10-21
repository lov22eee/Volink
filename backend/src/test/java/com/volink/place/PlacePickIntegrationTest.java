package com.volink.place;

import com.fasterxml.jackson.databind.JsonNode;
import com.volink.ApiTestSupport;
import com.volink.FakeExternal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 4주차 보완: place search, classification by Kakao category, signed choices and the new explore filters (docs/test-cases.md P-01..P-06). */
class PlacePickIntegrationTest extends ApiTestSupport {
    static final KakaoLocal.Place PARK = new KakaoLocal.Place("9001", "옥정호수공원", "여행 > 공원 > 도시근린공원", "AT4", "경기 양주시 옥정동 1", 37.8201, 127.0901, 120);
    static final KakaoLocal.Place CARE = new KakaoLocal.Place("9002", "옥정 행복요양병원", "의료,건강 > 병원 > 요양병원", "HP8", "경기 양주시 옥정동 2", 37.8211, 127.0911, 350);
    static final KakaoLocal.Place GAS = new KakaoLocal.Place("9003", "SK 옥정주유소", "교통,수송 > 자동차 > 주유,가스 > 주유소", "OL7", "경기 양주시 옥정동 3", 37.8221, 127.0921, 520);

    @Autowired FakeExternal.Kakao kakao;

    @AfterEach
    void reset() {
        kakao.reset();
    }

    @Test
    void withoutAKakaoKeySearchListsTheAdminEnteredPlaces() throws Exception {
        mvc.perform(get("/api/places/search").param("query", "공원")).andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("LOCAL")).andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[0].placeId").value(1)).andExpect(jsonPath("$.items[0].placeClass").value("OPEN"));
        mvc.perform(get("/api/places/search").param("query", " ")).andExpect(status().isBadRequest());
    }

    @Test
    void kakaoResultsAreClassifiedAndBlockedPlacesCannotBeChosen() throws Exception {
        kakao.enabled = true;
        kakao.results = List.of(PARK, CARE, GAS);
        mvc.perform(get("/api/places/search").param("query", "옥정")).andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("KAKAO"))
                .andExpect(jsonPath("$.items[0].placeClass").value("OPEN")).andExpect(jsonPath("$.items[0].classLabel").value("공원"))
                .andExpect(jsonPath("$.items[0].token").exists())
                .andExpect(jsonPath("$.items[1].placeClass").value("REVIEW")).andExpect(jsonPath("$.items[1].classLabel").value("요양·복지시설"))
                .andExpect(jsonPath("$.items[2].placeClass").value("BLOCKED")).andExpect(jsonPath("$.items[2].token").doesNotExist());
        mvc.perform(get("/api/places/nearby").param("lat", "37.82").param("lng", "127.09")).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(3));
        mvc.perform(get("/api/places/nearby").param("lat", "10").param("lng", "10")).andExpect(status().isBadRequest());
    }

    @Test
    void anOpenPlacePublishesAndAReviewPlaceGoesToAnAdmin() throws Exception {
        kakao.enabled = true;
        kakao.results = List.of(PARK, CARE);
        JsonNode items = json.readTree(mvc.perform(get("/api/places/search").param("query", "옥정")).andReturn().getResponse().getContentAsString()).get("items");
        String organizer = token(member("GENERAL"));

        Map<String, Object> open = picked(items.get(0), "산책로 플로깅 함께 해요");
        open.put("meetingPoint", "정문 안내판 앞");
        long openId = createActivity(open, organizer);
        mvc.perform(get("/api/activities/" + openId)).andExpect(jsonPath("$.status").value("RECRUITING"))
                .andExpect(jsonPath("$.placeName").value("옥정호수공원")).andExpect(jsonPath("$.meetingPoint").value("정문 안내판 앞"))
                .andExpect(jsonPath("$.placeAddress").value("경기 양주시 옥정동 1")).andExpect(jsonPath("$.latitude").value(37.8201));
        // The same Kakao place is stored once.
        createActivity(picked(items.get(0), "산책로 플로깅 두 번째"), organizer);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM demo_places WHERE kakao_place_id = '9001'", Integer.class)).isEqualTo(1);
        // It is not offered in the admin coordinate list (that list is the curated places only).
        mvc.perform(get("/api/places")).andExpect(jsonPath("$.length()").value(3));

        long reviewId = createActivity(picked(items.get(1), "병원 앞 화단 가꾸기"), organizer);
        mvc.perform(get("/api/me/activities").header("Authorization", "Bearer " + organizer))
                .andExpect(jsonPath("$[?(@.id == " + reviewId + ")].status").value(org.hamcrest.Matchers.contains("DRAFT")))
                .andExpect(jsonPath("$[?(@.id == " + reviewId + ")].riskReasons").value(org.hamcrest.Matchers.contains(containsString("요양·복지시설"))));
    }

    @Test
    void aChangedOrExpiredChoiceIsRefused() throws Exception {
        kakao.enabled = true;
        kakao.results = List.of(CARE);
        JsonNode care = json.readTree(mvc.perform(get("/api/places/search").param("query", "요양")).andReturn().getResponse().getContentAsString()).get("items").get(0);
        String organizer = token(member("GENERAL"));
        Map<String, Object> body = picked(care, "화단 가꾸기 함께 해요");
        @SuppressWarnings("unchecked") Map<String, Object> place = (Map<String, Object>) body.get("place");
        place.put("placeClass", "OPEN");
        perform(post("/api/activities"), body, organizer).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("place"));
        place.put("placeClass", "REVIEW");
        place.put("latitude", 37.9);
        perform(post("/api/activities"), body, organizer).andExpect(status().isBadRequest());
        place.put("latitude", care.get("latitude").asDouble());
        place.put("token", "1." + care.get("token").asText().split("\\.")[1]);
        perform(post("/api/activities"), body, organizer).andExpect(status().isBadRequest());
    }

    @Test
    void exploreFiltersByWordsTimeOfDayAndDateRange() throws Exception {
        String organizer = token(member("GENERAL"));
        Map<String, Object> morning = activity("아침 산책로 정리 모임", "편한 신발을 신고 공원 산책로의 쓰레기를 함께 줍습니다.");
        long am = createActivity(morning, organizer);
        Map<String, Object> afternoon = activity("오후 화단 물주기 모임", "화단에 물을 주고 시든 잎을 정리하는 가벼운 활동입니다.");
        afternoon.put("time", "15:00");
        afternoon.put("date", TODAY.plusDays(9).toString());
        long pm = createActivity(afternoon, organizer);

        mvc.perform(get("/api/activities").param("q", "화단")).andExpect(jsonPath("$[?(@.id == " + pm + ")]").isNotEmpty())
                .andExpect(jsonPath("$[?(@.id == " + am + ")]").isEmpty());
        mvc.perform(get("/api/activities").param("part", "AM")).andExpect(jsonPath("$[?(@.id == " + am + ")]").isNotEmpty())
                .andExpect(jsonPath("$[?(@.id == " + pm + ")]").isEmpty());
        mvc.perform(get("/api/activities").param("from", TODAY.plusDays(8).toString()).param("to", TODAY.plusDays(9).toString()))
                .andExpect(jsonPath("$[?(@.id == " + pm + ")]").isNotEmpty()).andExpect(jsonPath("$[?(@.id == " + am + ")]").isEmpty());
        mvc.perform(get("/api/activities").param("q", "100%")).andExpect(status().isOk());
        mvc.perform(get("/api/activities").param("lat", "37.8").param("lng", "127.1").param("radiusKm", "20")).andExpect(status().isOk());
        mvc.perform(get("/api/activities").param("lat", "37.8").param("lng", "127.1").param("radiusKm", "25")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/activities").param("part", "NIGHT")).andExpect(status().isBadRequest());
    }

    private static Map<String, Object> picked(JsonNode item, String title) {
        Map<String, Object> body = activity(title, "편한 신발을 신고 함께 모여서 가볍게 정리하는 활동입니다.");
        body.remove("placeId");
        Map<String, Object> place = new HashMap<>();
        for (String field : List.of("kakaoId", "name", "address", "categoryName", "placeClass", "classLabel", "token")) place.put(field, item.get(field).asText());
        place.put("latitude", item.get("latitude").asDouble());
        place.put("longitude", item.get("longitude").asDouble());
        body.put("place", place);
        return body;
    }
}
