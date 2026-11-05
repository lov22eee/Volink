package com.volink.activity;

import com.fasterxml.jackson.databind.JsonNode;
import com.volink.ApiTestSupport;
import com.volink.volunteer.ProgramCategory;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** V17 categories and the find screen's detail filter on the server: several categories, status, region. */
class CategorySearchIntegrationTest extends ApiTestSupport {
    @Test
    void sevenCategoriesAreOfferedAndOldNamesAreRefused() throws Exception {
        String host = token(member("GENERAL"));
        for (String category : List.of("환경", "교육", "문화·예술", "동물", "지역사회", "기타")) {
            Map<String, Object> body = activity(category + " 분야 확인 활동", "새 분야로 만들어지는지 확인하는 활동이에요.");
            body.put("category", category);
            perform(post("/api/activities"), body, host).andExpect(status().isCreated()).andExpect(jsonPath("$.category").value(category));
        }
        // 복지, animal work and 어르신 are published at once (user decision 2026-11-05).
        Map<String, Object> welfare = activity("복지 분야 확인 활동", "새 분야로 만들어지는지 확인하는 활동이에요.");
        welfare.put("category", "복지");
        perform(post("/api/activities"), welfare, host).andExpect(status().isCreated()).andExpect(jsonPath("$.riskLevel").value("LOW"));
        Map<String, Object> animal = activity("동물 보호소 산책 돕기", "어르신과 함께 보호소 강아지 산책을 도와요.");
        animal.put("category", "동물");
        perform(post("/api/activities"), animal, host).andExpect(status().isCreated()).andExpect(jsonPath("$.riskLevel").value("LOW"));
        Map<String, Object> old = activity("옛 분야 활동", "옛 분야 이름은 더 이상 쓰지 않아요.");
        old.put("category", "생활 지원");
        perform(post("/api/activities"), old, host).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].field").value("category"));
        old.put("category", "생활 지원(복지로 통합)");
        perform(post("/api/activities"), old, host).andExpect(status().isBadRequest());
    }

    @Test
    void severalCategoriesStatusAndRegion() throws Exception {
        String host = token(member("GENERAL"));
        long env = create(host, "다중 분야 환경 활동", "환경", 2);
        long edu = create(host, "다중 분야 교육 활동", "교육", 2);
        long art = create(host, "다중 분야 문화 활동", "문화·예술", 2);
        List<Long> both = ids(get("/api/activities").param("category", "환경,교육"));
        assertThat(both).contains(env, edu).doesNotContain(art);
        assertThat(ids(get("/api/activities").param("category", "전체"))).contains(env, edu, art);

        // Full: capacity 1 with one confirmed person.
        long full = create(host, "꽉 찬 활동", "환경", 1);
        String member = token(member("GENERAL"));
        long pid = json.readTree(perform(post("/api/activities/" + full + "/participations"), Map.of(), member).andReturn().getResponse().getContentAsString()).path("participation").path("id").asLong();
        perform(post("/api/participations/" + pid + "/approve"), Map.of(), host).andExpect(status().isNoContent());
        assertThat(ids(get("/api/activities").param("status", "OPEN"))).contains(env).doesNotContain(full);
        assertThat(ids(get("/api/activities").param("status", "WAITLIST"))).contains(env, full);
        assertThat(ids(get("/api/activities"))).contains(full);
        // Waitlist closes 2 h before the start: then only "마감 포함" shows it.
        java.time.LocalDateTime soon = java.time.LocalDateTime.now(java.time.ZoneId.of("Asia/Seoul")).plusMinutes(90);
        jdbc.update("UPDATE activities SET starts_at = ?, ends_at = ? WHERE id = ?", soon, soon.plusMinutes(60), full);
        assertThat(ids(get("/api/activities").param("status", "WAITLIST"))).doesNotContain(full);
        assertThat(ids(get("/api/activities").param("status", "ALL"))).contains(full);
        perform(get("/api/activities").param("status", "SOON"), null, null).andExpect(status().isBadRequest());

        // Region: the place address (place 1 is in 양주).
        jdbc.update("UPDATE demo_places SET area = '경기 양주시 옥정동' WHERE id = 1");
        assertThat(ids(get("/api/activities").param("sido", "경기도").param("sigungu", "양주시"))).contains(env);
        assertThat(ids(get("/api/activities").param("sido", "서울특별시"))).doesNotContain(env);
        assertThat(ids(get("/api/activities").param("sido", "경기도").param("sigungu", "수원시"))).doesNotContain(env);
    }

    @Test
    void programCategoriesPreferTheOfficialFieldAndNeverHideTheUnknown() {
        assertThat(ProgramCategory.of("환경보호", "아무 제목")).isEqualTo(new ProgramCategory.Result("환경", "OFFICIAL"));
        assertThat(ProgramCategory.of("생활편의지원 > 활동보조", "공원 정화")).isEqualTo(new ProgramCategory.Result("복지", "OFFICIAL"));
        assertThat(ProgramCategory.of(null, "유기견 보호소 청소")).isEqualTo(new ProgramCategory.Result("동물", "ESTIMATED"));
        assertThat(ProgramCategory.of("알 수 없는 값", "도서관 독서 지도")).isEqualTo(new ProgramCategory.Result("교육", "ESTIMATED"));
        assertThat(ProgramCategory.of(null, "봉사자 모집")).isEqualTo(new ProgramCategory.Result("기타", "UNKNOWN"));
    }

    private long create(String token, String title, String category, int capacity) throws Exception {
        Map<String, Object> body = activity(title, "여러 조건으로 찾을 수 있는지 확인하는 활동이에요.");
        body.put("category", category);
        body.put("capacity", capacity);
        return createActivity(body, token);
    }

    private List<Long> ids(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request) throws Exception {
        JsonNode list = json.readTree(mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        List<Long> out = new ArrayList<>();
        list.forEach(item -> out.add(item.path("id").asLong()));
        return out;
    }
}
