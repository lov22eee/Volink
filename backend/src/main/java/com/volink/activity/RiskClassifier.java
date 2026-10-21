package com.volink.activity;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Order from docs/plan.md 6.7: clear rules -> risk keywords -> REVIEW goes to an admin.
 * Keyword matching only flags possible risk; it never proves an activity is safe.
 */
@Component
public class RiskClassifier {
    /** Approximate mid-month sunset in the Seoul area (minutes rounded down). Used only to send late activities to REVIEW. */
    static final LocalTime[] SUNSET = {
            LocalTime.of(17, 40), LocalTime.of(18, 10), LocalTime.of(18, 40), LocalTime.of(19, 5),
            LocalTime.of(19, 30), LocalTime.of(19, 50), LocalTime.of(19, 50), LocalTime.of(19, 25),
            LocalTime.of(18, 45), LocalTime.of(18, 0), LocalTime.of(17, 25), LocalTime.of(17, 15)};

    private final JdbcTemplate jdbc;

    public RiskClassifier(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record Result(String level, List<String> reasons) {}

    /** placeReview: why the chosen place needs a look (e.g. "요양·복지시설"), or null for an open place. */
    public Result classify(String title, String description, String category, LocalDateTime endsAt, String placeReview) {
        String text = (title + " " + description).toLowerCase(Locale.ROOT);
        List<String> blocked = new ArrayList<>();
        List<String> review = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT keyword, risk_level, reason FROM risk_keywords ORDER BY id")) {
            String keyword = (String) row.get("keyword");
            if (!text.contains(keyword.toLowerCase(Locale.ROOT))) continue;
            String reason = "'" + keyword + "' · " + row.get("reason");
            ("BLOCKED".equals(row.get("risk_level")) ? blocked : review).add(reason);
        }
        if (!blocked.isEmpty()) return new Result("BLOCKED", blocked);
        String baseRisk = jdbc.queryForList("SELECT base_risk FROM categories WHERE name = ?", String.class, category)
                .stream().findFirst().orElse("LOW");
        if ("REVIEW".equals(baseRisk)) review.add("'" + category + "' 분야 · 대상자 확인 필요");
        if (endsAt.toLocalTime().isAfter(SUNSET[endsAt.getMonthValue() - 1])) review.add("해가 진 뒤 끝나는 활동");
        if (placeReview != null) review.add("장소가 " + placeReview + " · 관리자 확인 필요");
        return review.isEmpty() ? new Result("LOW", List.of()) : new Result("REVIEW", review);
    }
}
