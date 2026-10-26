package com.volink.volunteer;

import com.volink.ApiTestSupport;
import com.volink.FakeExternal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import com.volink.place.KakaoLocal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 4주차 보완: 1365 programs next to our activities (docs/test-cases.md V-01..V-03). */
class VolunteerIntegrationTest extends ApiTestSupport {
    @Autowired FakeExternal.Kakao kakao;
    @Autowired FakeExternal.Volunteer volunteer;

    @AfterEach
    void reset() {
        kakao.reset();
        volunteer.reset();
    }

    @Test
    void withoutKeysNothingIsShown() throws Exception {
        mvc.perform(get("/api/volunteer-programs").param("lat", "37.82").param("lng", "127.09"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(false)).andExpect(jsonPath("$.items.length()").value(0));
        mvc.perform(get("/api/volunteer-programs")).andExpect(status().isBadRequest());
    }

    @Test
    void programsAreLocatedFilteredAndCachedWithoutContactFields() throws Exception {
        kakao.enabled = true;
        volunteer.enabled = true;
        kakao.region = new KakaoLocal.Region("경기도", "양주시");
        String end = TODAY.plusDays(30).toString().replace("-", "");
        volunteer.list = List.of(Map.of("progrmRegistNo", "T-1", "progrmSj", "도서관 서가 정리", "progrmSttusSe", "2"),
                Map.of("progrmRegistNo", "T-2", "progrmSj", "청소년 불가 활동", "progrmSttusSe", "2"),
                Map.of("progrmRegistNo", "T-3", "progrmSj", "모집 끝난 활동", "progrmSttusSe", "3"));
        volunteer.details = Map.of(
                "T-1", fields("progrmRegistNo", "T-1", "progrmSj", "도서관 서가 정리", "actPlace", "덕정도서관", "progrmBgnde", "20261020",
                        "progrmEndde", end, "actBeginTm", "9", "actEndTm", "12", "actWkdy", "0000011", "yngbgsPosblAt", "Y",
                        "mnnstNm", "양주시자원봉사센터", "telno", "000-0000-0000", "email", "someone@example.com", "nanmmbyNmAdmn", "담당자"),
                "T-2", Map.of("progrmRegistNo", "T-2", "progrmSj", "청소년 불가 활동", "actPlace", "어딘가", "progrmEndde", end, "yngbgsPosblAt", "N"),
                "T-3", Map.of("progrmRegistNo", "T-3", "progrmSj", "모집 끝난 활동", "progrmEndde", end, "yngbgsPosblAt", "Y"));
        kakao.located.put("덕정도서관", new KakaoLocal.Place(null, "덕정도서관", null, null, "경기 양주시", 37.84, 127.06, null));

        mvc.perform(get("/api/volunteer-programs").param("lat", "37.82").param("lng", "127.09").param("youth", "true"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.enabled").value(true)).andExpect(jsonPath("$.region").value("경기도 양주시"))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].title").value("도서관 서가 정리")).andExpect(jsonPath("$.items[0].organization").value("양주시자원봉사센터"))
                .andExpect(jsonPath("$.items[0].beginTime").value("09:00")).andExpect(jsonPath("$.items[0].weekdays").value("토 일"))
                .andExpect(jsonPath("$.items[0].recruitStatus").value("모집중")).andExpect(jsonPath("$.items[0].distanceKm").isNumber())
                .andExpect(jsonPath("$.items[0].link").value(org.hamcrest.Matchers.endsWith("T-1")))
                .andExpect(jsonPath("$.items[0].telno").doesNotExist()).andExpect(jsonPath("$.items[0].email").doesNotExist());
        assertThat(volunteer.calls).contains("area:6410000/5590000/");
        // Second search: list from the cache, details from the database.
        int calls = volunteer.calls.size();
        mvc.perform(get("/api/volunteer-programs").param("lat", "37.82").param("lng", "127.09")).andExpect(jsonPath("$.items.length()").value(2));
        assertThat(volunteer.calls).hasSize(calls);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM volunteer_programs WHERE program_no IN ('T-1','T-2','T-3')", Integer.class)).isEqualTo(3);
    }

    @Test
    void aCentreNearABorderAlsoShowsTheNextDistrict() throws Exception {
        kakao.enabled = true;
        volunteer.enabled = true;
        // 강북구 at the centre, 도봉구 just north of it (like 창동 seen from 수유).
        kakao.regionAt = (lat, lng) -> lat > 37.64 ? new KakaoLocal.Region("서울특별시", "도봉구") : new KakaoLocal.Region("서울특별시", "강북구");
        String end = TODAY.plusDays(30).toString().replace("-", "");
        volunteer.byCity = Map.of(
                "3080000", List.of(Map.of("progrmRegistNo", "B-1", "progrmSj", "강북 활동", "progrmSttusSe", "2")),
                "3090000", List.of(Map.of("progrmRegistNo", "B-2", "progrmSj", "도봉 활동", "progrmSttusSe", "2")));
        volunteer.details = Map.of(
                "B-1", Map.of("progrmRegistNo", "B-1", "progrmSj", "강북 활동", "actPlace", "강북 장소", "progrmEndde", end),
                "B-2", Map.of("progrmRegistNo", "B-2", "progrmSj", "도봉 활동", "actPlace", "도봉 장소", "progrmEndde", end));
        kakao.located.put("강북 장소", new KakaoLocal.Place(null, "강북 장소", null, null, "서울 강북구", 37.630, 127.025, null));
        kakao.located.put("도봉 장소", new KakaoLocal.Place(null, "도봉 장소", null, null, "서울 도봉구", 37.650, 127.030, null));

        mvc.perform(get("/api/volunteer-programs").param("lat", "37.632").param("lng", "127.026"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.region").value("서울특별시 강북구"))
                .andExpect(jsonPath("$.items[*].title").value(org.hamcrest.Matchers.contains("강북 활동", "도봉 활동")));
        assertThat(volunteer.calls).contains("area:6110000/3080000/", "area:6110000/3090000/");
    }

    @Test
    void newDetailsAreFetchedSideBySide() throws Exception {
        kakao.enabled = true;
        volunteer.enabled = true;
        kakao.region = new KakaoLocal.Region("경기도", "양주시");
        String end = TODAY.plusDays(30).toString().replace("-", "");
        List<Map<String, String>> list = new java.util.ArrayList<>();
        Map<String, Map<String, String>> details = new java.util.HashMap<>();
        for (int i = 1; i <= 8; i++) {
            list.add(Map.of("progrmRegistNo", "S-" + i, "progrmSj", "동시 " + i, "progrmSttusSe", "2"));
            details.put("S-" + i, Map.of("progrmRegistNo", "S-" + i, "progrmSj", "동시 " + i, "progrmEndde", end));
        }
        volunteer.list = list;
        volunteer.details = details;
        volunteer.detailDelayMs = 400;
        long started = System.nanoTime();
        mvc.perform(get("/api/volunteer-programs").param("lat", "37.82").param("lng", "127.09").param("q", "동시"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(8));
        // One after another this would take 8 × 0.4 s = 3.2 s.
        assertThat((System.nanoTime() - started) / 1_000_000).isLessThan(1600);
        assertThat(volunteer.calls.stream().filter(call -> call.startsWith("detail:S-")).count()).isEqualTo(8);
    }

    private static Map<String, String> fields(String... pairs) {
        Map<String, String> map = new java.util.LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put(pairs[i], pairs[i + 1]);
        return map;
    }

    @Test
    void adminCheckShowsFieldNamesOnly() throws Exception {
        kakao.enabled = true;
        volunteer.enabled = true;
        kakao.region = new KakaoLocal.Region("서울특별시", "용산구");
        volunteer.list = List.of(Map.of("progrmRegistNo", "C-1", "progrmSj", "제목"));
        volunteer.details = Map.of("C-1", fields("progrmRegistNo", "C-1", "telno", "000"));
        String admin = token(admin());
        mvc.perform(get("/api/admin/volunteer-programs/check").param("lat", "37.53").param("lng", "126.97").header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk()).andExpect(jsonPath("$.codes").value("6110000 / 3020000"))
                .andExpect(jsonPath("$.listCount").value(1)).andExpect(jsonPath("$.detailFields[1]").value("telno"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("\"000\""))));
        mvc.perform(get("/api/admin/volunteer-programs/check").param("lat", "37.53").param("lng", "126.97").header("Authorization", "Bearer " + token(member("GENERAL"))))
                .andExpect(status().isForbidden());
    }
}
