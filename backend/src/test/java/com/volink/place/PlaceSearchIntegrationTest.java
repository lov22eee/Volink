package com.volink.place;

import com.volink.ApiTestSupport;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.closeTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Week 4: admin-entered place coordinates and radius/date/category search (docs/test-cases.md S-01, R-02, R-03). */
class PlaceSearchIntegrationTest extends ApiTestSupport {
    /** Degrees of latitude per km on MySQL's ST_Distance_Sphere sphere (radius 6,370,986 m). */
    static final double DEG_PER_KM = 1 / 111.19490;

    @Test
    void placesArePublicAndOnlyAdminsCanEnterCoordinates() throws Exception {
        mvc.perform(get("/api/places")).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].name").value("옥정중앙공원"));
        String user = token(member("GENERAL"));
        perform(put("/api/admin/places/2"), Map.of("latitude", 37.8, "longitude", 127.1), user).andExpect(status().isForbidden());
        String admin = token(admin());
        perform(put("/api/admin/places/2"), Map.of("latitude", 50, "longitude", 10), admin).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[*].field").value(org.hamcrest.Matchers.contains("latitude", "longitude")));
        perform(put("/api/admin/places/99"), Map.of("latitude", 37.8, "longitude", 127.1), admin).andExpect(status().isNotFound());
        perform(put("/api/admin/places/2"), Map.of("latitude", 37.8, "longitude", 127.1, "meetingPoint", "공원 정문 안내판 앞"), admin)
                .andExpect(status().isOk()).andExpect(jsonPath("$.coordinateStatus").value("ENTERED"))
                .andExpect(jsonPath("$.meetingPoint").value("공원 정문 안내판 앞"));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM admin_actions WHERE target_type = 'PLACE' AND target_id = 2", Integer.class)).isPositive();
    }

    @Test
    void radiusSearchKeepsTwoPointNineKilometresAndDropsThreePointFour() throws Exception {
        double lat = 36.2, lng = 128.2;
        String admin = token(admin());
        String organizer = token(member("GENERAL"));
        // Created before the place has a coordinate: entering the coordinate must move it onto the map too.
        long near = createActivity(at(2, "가까운 공원 정리"), organizer);
        place(admin, 2, lat + 2.9 * DEG_PER_KM, lng);
        place(admin, 3, lat + 3.4 * DEG_PER_KM, lng);
        long far = createActivity(at(3, "조금 먼 공원 정리"), organizer);

        mvc.perform(get("/api/activities").param("lat", "" + lat).param("lng", "" + lng))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id == " + near + ")].distanceKm").value(org.hamcrest.Matchers.contains(closeTo(2.9, 0.05))))
                .andExpect(jsonPath("$[?(@.id == " + far + ")]").isEmpty());
        mvc.perform(get("/api/activities").param("lat", "" + lat).param("lng", "" + lng).param("radiusKm", "5"))
                .andExpect(jsonPath("$[?(@.id == " + far + ")].distanceKm").value(org.hamcrest.Matchers.contains(closeTo(3.4, 0.05))))
                .andExpect(jsonPath("$[0].distanceKm").value(closeTo(2.9, 0.05)));
        mvc.perform(get("/api/activities/" + near)).andExpect(jsonPath("$.latitude").value(closeTo(lat + 2.9 * DEG_PER_KM, 0.00001)))
                .andExpect(jsonPath("$.longitude").value(closeTo(lng, 0.00001)));
    }

    @Test
    void reviewActivitiesStayOutOfTheMapUntilApproved() throws Exception {
        double lat = 35.6, lng = 127.6;
        String admin = token(admin());
        place(admin, 2, lat, lng);
        String organizer = token(member("GENERAL"));
        Map<String, Object> review = at(2, "어르신과 함께 걷는 산책");
        review.put("description", "동네 공원에서 어르신과 천천히 걸으며 이야기를 나눕니다.");
        long id = createActivity(review, organizer);
        mvc.perform(get("/api/activities").param("lat", "" + lat).param("lng", "" + lng)).andExpect(jsonPath("$[?(@.id == " + id + ")]").isEmpty());
        perform(post("/api/admin/activities/" + id + "/approve"), Map.of(), admin).andExpect(status().isNoContent());
        mvc.perform(get("/api/activities").param("lat", "" + lat).param("lng", "" + lng))
                .andExpect(jsonPath("$[?(@.id == " + id + ")].distanceKm").value(org.hamcrest.Matchers.contains(closeTo(0, 0.05))));
        // BLOCKED is refused before anything is stored, so it can never reach the search.
        perform(post("/api/activities"), at(2, "사다리 타고 창문 닦기"), organizer).andExpect(status().isUnprocessableEntity());
    }

    @Test
    void dateCategoryAndTypeFiltersAndBadParametersAreRejected() throws Exception {
        String organizer = token(member("GENERAL"));
        Map<String, Object> body = at(1, "주말 생활 지원 나눔");
        body.put("category", "생활 지원");
        body.put("date", TODAY.plusDays(9).toString());
        long id = createActivity(body, organizer);
        String day = TODAY.plusDays(9).toString();
        mvc.perform(get("/api/activities").param("date", day).param("category", "생활 지원").param("type", "GENERAL"))
                .andExpect(jsonPath("$[?(@.id == " + id + ")]").isNotEmpty());
        mvc.perform(get("/api/activities").param("date", TODAY.plusDays(8).toString())).andExpect(jsonPath("$[?(@.id == " + id + ")]").isEmpty());
        mvc.perform(get("/api/activities").param("category", "환경 정화")).andExpect(jsonPath("$[?(@.id == " + id + ")]").isEmpty());
        mvc.perform(get("/api/activities").param("type", "INSTITUTION")).andExpect(jsonPath("$[?(@.id == " + id + ")]").isEmpty());

        mvc.perform(get("/api/activities").param("lat", "37.8")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("location"));
        mvc.perform(get("/api/activities").param("lat", "37.8").param("lng", "127.1").param("radiusKm", "50"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("radiusKm"));
        mvc.perform(get("/api/activities").param("date", "10/20")).andExpect(status().isBadRequest());
    }

    private void place(String admin, long id, double lat, double lng) throws Exception {
        perform(put("/api/admin/places/" + id), Map.of("latitude", lat, "longitude", lng), admin).andExpect(status().isOk());
    }

    private static Map<String, Object> at(long placeId, String title) {
        Map<String, Object> body = activity(title, "편한 신발을 신고 공원 산책로의 가벼운 쓰레기를 함께 줍습니다.");
        body.put("placeId", placeId);
        return body;
    }
}
