package com.volink.demo;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@Profile({"dev", "test"})
public class DemoController {
    private final JdbcTemplate jdbc;

    public DemoController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/demo/catalog")
    public Map<String, Object> catalog() {
        List<Map<String, Object>> places = jdbc.queryForList("""
                SELECT id, name, area, address_note AS addressNote,
                       coordinate_status AS coordinateStatus
                FROM demo_places ORDER BY id
                """);
        List<Map<String, Object>> personas = jdbc.queryForList("""
                SELECT code, display_name AS displayName, persona_role AS role
                FROM demo_personas ORDER BY code
                """);
        List<Map<String, Object>> activities = jdbc.queryForList("""
                SELECT a.id, a.title, a.description, c.name AS category,
                       a.place_id AS placeId, p.name AS placeName, a.start_time AS startTime,
                       a.duration_minutes AS durationMinutes, a.capacity, a.example_confirmed AS confirmed
                FROM demo_activity_templates a
                JOIN demo_places p ON p.id = a.place_id
                JOIN categories c ON c.id = a.category_id
                ORDER BY a.id
                """);
        return Map.of("demo", true, "baseDate", LocalDate.now(ZoneId.of("Asia/Seoul")).plusDays(3),
                "places", places, "personas", personas, "activities", activities,
                "notice", "UI 시연용 데이터입니다. 로그인·활동 개설·신청 기능은 아직 구현되지 않았습니다.");
    }

    @GetMapping("/project/status")
    public Map<String, Object> status() {
        jdbc.queryForObject("SELECT 1", Integer.class);
        return Map.of("project", "Volink", "week", 1, "database", "UP",
                "capabilities", List.of("React UI prototype", "Spring Boot API", "MySQL / Flyway", "Demo catalog"),
                "authenticationImplemented", false, "mapIntegrated", false,
                "notice", "활동 기록은 플랫폼 내부 기록이며 공식 봉사실적으로 인정되지 않습니다.");
    }
}
