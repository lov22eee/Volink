package com.volink.stats;

import com.volink.activity.ActivityService;
import com.volink.volunteer.VolunteerService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Home banner '우리 동네 지금' (numbers only, never a person).
 * <ul>
 *   <li>nearby.volink: Volink activities recruiting and not started within the radius (the same public search as 찾기).</li>
 *   <li>nearby.program: 1365 programs within the radius that are not known to be closed (the cached 1365 search;
 *       null when 1365 is off or did not answer). Volink posts are written by members and never copied from 1365,
 *       so the two never count the same activity; inside 1365, one program number counts once.</li>
 *   <li>Without a position: no nearby count; volinkAll = every recruiting Volink activity (the screen says so).</li>
 *   <li>monthly: the last 6 Korean months, distinct members with a VALID activity record confirmed that month (one person
 *       counts once per month even after several activities; the same person can appear in several months).</li>
 * </ul>
 * Monthly numbers are cached 10 minutes; 1365 has its own 3-hour cache per district.
 */
@Service
public class StatsService {
    static final int MONTHS = 6;
    static final Duration MONTHLY_CACHE = Duration.ofMinutes(10);
    private static final Logger log = LoggerFactory.getLogger(StatsService.class);

    private final JdbcTemplate jdbc;
    private final ActivityService activities;
    private final VolunteerService volunteers;
    private final OfficialStats official;
    private final Clock clock;
    private volatile Map<String, Object> monthly;
    private volatile Instant monthlyAt = Instant.EPOCH;

    public StatsService(JdbcTemplate jdbc, ActivityService activities, VolunteerService volunteers, OfficialStats official, Clock clock) {
        this.jdbc = jdbc;
        this.activities = activities;
        this.volunteers = volunteers;
        this.official = official;
        this.clock = clock;
    }

    public Map<String, Object> home(Double lat, Double lng, Double rawRadius) {
        double radius = rawRadius == null ? 5 : Math.min(Math.max(rawRadius, 1), 10);
        boolean located = lat != null && lng != null && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> nearby = new LinkedHashMap<>();
        nearby.put("located", located);
        nearby.put("radiusKm", radius);
        if (located) {
            nearby.put("volink", activities.listPublic(new ActivityService.Search(lat, lng, radius, null, null, null, null, null, null, null)).size());
            Integer program = null;
            try {
                Map<String, Object> found = volunteers.search(new VolunteerService.Query(lat, lng, radius, null, null, true));
                if (Boolean.TRUE.equals(found.get("enabled")) && found.get("items") instanceof List<?> items)
                    program = (int) items.stream().map(item -> ((Map<?, ?>) item).get("programNo")).distinct().count();
            } catch (RuntimeException error) {
                log.info("1365 count unavailable: {}", error.getClass().getSimpleName());
            }
            nearby.put("program", program);
        } else {
            nearby.put("volink", null);
            nearby.put("program", null);
        }
        nearby.put("volinkAll", activities.listPublic(ActivityService.Search.none()).size());
        out.put("nearby", nearby);
        out.put("monthly", monthly());
        out.put("official", official.latest().orElse(null));
        out.put("updatedAt", LocalDateTime.now(clock).withNano(0).toString());
        return out;
    }

    /** Tests: read the database again on the next call. */
    void forget() { monthlyAt = Instant.EPOCH; }

    Map<String, Object> monthly() {
        Map<String, Object> cached = monthly;
        if (cached != null && clock.instant().isBefore(monthlyAt.plus(MONTHLY_CACHE))) return cached;
        YearMonth now = YearMonth.from(LocalDateTime.now(clock));
        YearMonth first = now.minusMonths(MONTHS - 1);
        Map<String, Integer> byMonth = new LinkedHashMap<>();
        for (int i = 0; i < MONTHS; i++) byMonth.put(first.plusMonths(i).toString(), 0);
        // confirmed_at is Korean time (DATETIME), so the month is the Korean month.
        for (Map<String, Object> row : jdbc.queryForList("""
                SELECT DATE_FORMAT(r.confirmed_at, '%Y-%m') AS month, COUNT(DISTINCT p.user_id) AS people
                FROM activity_records r JOIN participations p ON p.id = r.participation_id
                WHERE r.status = 'VALID' AND r.confirmed_at >= ? GROUP BY month
                """, first.atDay(1).atStartOfDay()))
            byMonth.computeIfPresent(String.valueOf(row.get("month")), (k, v) -> ((Number) row.get("people")).intValue());
        Integer people = jdbc.queryForObject("""
                SELECT COUNT(DISTINCT p.user_id) FROM activity_records r JOIN participations p ON p.id = r.participation_id
                WHERE r.status = 'VALID' AND r.confirmed_at >= ?
                """, Integer.class, first.atDay(1).atStartOfDay());
        List<Map<String, Object>> points = new ArrayList<>();
        byMonth.forEach((month, count) -> points.add(Map.of("month", month, "people", count)));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("points", points);
        result.put("people", people == null ? 0 : people);
        result.put("activeMonths", (int) byMonth.values().stream().filter(v -> v > 0).count());
        result.put("source", "VOLINK_RECORDS");
        monthly = result;
        monthlyAt = clock.instant();
        return result;
    }
}
