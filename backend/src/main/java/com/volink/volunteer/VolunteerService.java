package com.volink.volunteer;

import com.volink.common.ApiException;
import com.volink.place.KakaoLocal;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import jakarta.annotation.PreDestroy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 1365 programs near a point, shown next to our activities (read only: applying, records and insurance stay on 1365).
 * Flow: point → region (Kakao) → region codes → program list (cached 3 h per region and keyword) → detail of programs
 * not seen before (stored, without personal contact fields) → coordinate from the place text (Kakao) → nearest first.
 * At most {@link #NEW_DETAILS} new details per search keep the daily quota (1000 calls per operation) safe.
 * The outside calls of one search (regions, lists, details) run side by side on a small pool instead of one after another,
 * so a district seen for the first time takes about as long as its slowest call, not the sum of all of them.
 */
@Service
public class VolunteerService {
    static final Duration LIST_CACHE = Duration.ofHours(3);
    static final Duration DETAIL_REFRESH = Duration.ofHours(12);
    static final int LIST_ROWS = 50;
    static final int NEW_DETAILS = 20;
    static final double RING_KM = 3;
    static final int MAX_AREAS = 4;
    static final String LINK = "https://www.1365.go.kr/vols/P9210/partcptn/timeCptn.do?type=show&progrmRegistNo=";
    private static final DateTimeFormatter YMD = DateTimeFormatter.BASIC_ISO_DATE;

    private final VolunteerApi api;
    private final KakaoLocal kakao;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final Map<String, Cached> lists = new ConcurrentHashMap<>();
    private final Map<String, Object> listLocks = new ConcurrentHashMap<>();
    /** Bounded so one search never opens more than a handful of connections to Kakao or data.go.kr at once. */
    private final ExecutorService calls = Executors.newFixedThreadPool(8, task -> {
        Thread thread = new Thread(task, "volunteer-call");
        thread.setDaemon(true);
        return thread;
    });

    private record Cached(Instant at, List<Map<String, String>> items) {}

    public VolunteerService(VolunteerApi api, KakaoLocal kakao, JdbcTemplate jdbc, Clock clock) {
        this.api = api;
        this.kakao = kakao;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @PreDestroy
    void stop() {
        calls.shutdownNow();
    }

    /** Runs every task on the pool and returns the answers in the same order. */
    private <T> List<T> together(List<Callable<T>> tasks) {
        List<Future<T>> futures = tasks.stream().map(calls::submit).toList();
        List<T> answers = new ArrayList<>();
        for (Future<T> future : futures) {
            try {
                answers.add(future.get());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                answers.add(null);
            } catch (ExecutionException failed) {
                answers.add(null);
            }
        }
        return answers;
    }

    public record Query(Double lat, Double lng, Double radiusKm, String q, Boolean youth, Boolean recruiting) {}

    public Map<String, Object> search(Query query) {
        if (query.lat() == null || query.lng() == null || query.lat() < 33 || query.lat() > 39 || query.lng() < 124 || query.lng() > 132)
            throw ApiException.validation(Map.of("location", "위치를 확인할 수 없습니다. 다시 시도해 주세요."));
        String q = query.q() == null ? "" : query.q().trim();
        if (q.length() > 50) throw ApiException.validation(Map.of("q", "검색어는 50자 이내로 입력해 주세요."));
        double radiusKm = query.radiusKm() == null ? 20 : Math.min(Math.max(query.radiusKm(), 0.5), 30);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("enabled", api.enabled() && kakao.enabled());
        if (!api.enabled() || !kakao.enabled()) { result.put("items", List.of()); return result; }

        List<Optional<KakaoLocal.Region>> regions = regions(query.lat(), query.lng());
        Optional<KakaoLocal.Region> region = regions.get(0);
        result.put("region", region.map(r -> (r.province() + " " + r.city()).trim()).orElse(null));
        List<RegionCodes.Codes> areas = areas(regions);
        if (areas.isEmpty()) { result.put("items", List.of()); return result; }

        // The centre's district first (it gets the detail budget first), then the neighbours the 3 km ring reaches.
        List<Map<String, String>> list = new ArrayList<>();
        for (List<Map<String, String>> part : together(areas.stream().<Callable<List<Map<String, String>>>>map(codes -> () -> list(codes, q)).toList()))
            if (part != null) list.addAll(part);
        List<String> numbers = new ArrayList<>();
        Map<String, Map<String, String>> entries = new LinkedHashMap<>();
        Map<String, Map<String, Object>> rows = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        for (Map<String, String> entry : list) {
            String no = first(entry, "progrmRegistNo");
            if (no == null || entries.containsKey(no)) continue;
            entries.put(no, entry);
            numbers.add(no);
            Map<String, Object> stored = stored(no);
            if (stored != null) rows.put(no, stored);
            if ((stored == null || stale(stored)) && missing.size() < NEW_DETAILS) missing.add(no);
        }
        // New or old details: fetched side by side.
        List<Map<String, Object>> refreshed = together(missing.stream().<Callable<Map<String, Object>>>map(no -> () -> fetch(no, entries.get(no), query.lat(), query.lng())).toList());
        for (int i = 0; i < missing.size(); i++) if (refreshed.get(i) != null) rows.put(missing.get(i), refreshed.get(i));
        List<Map<String, Object>> items = new ArrayList<>();
        for (String no : numbers) if (rows.containsKey(no)) items.add(view(rows.get(no), query.lat(), query.lng()));
        String today = LocalDate.now(clock.withZone(ZoneId.of("Asia/Seoul"))).format(YMD);
        items.removeIf(item -> item.get("periodEnd") != null && ((String) item.get("periodEnd")).replace("-", "").compareTo(today) < 0);
        if (Boolean.TRUE.equals(query.youth())) items.removeIf(item -> !Boolean.TRUE.equals(item.get("youthOk")));
        // Only programs known to be closed are hidden; an unknown status stays (the link shows the live state).
        if (!Boolean.FALSE.equals(query.recruiting())) items.removeIf(item -> item.get("recruitStatus") != null && !"모집중".equals(item.get("recruitStatus")));
        items.removeIf(item -> item.get("distanceKm") != null && (Double) item.get("distanceKm") > radiusKm);
        items.sort(Comparator.comparing(item -> item.get("distanceKm") == null ? Double.MAX_VALUE : (Double) item.get("distanceKm")));
        result.put("items", items);
        result.put("found", list.size());
        return result;
    }

    /** The centre's region, then the regions 3 km north, south, east and west (a point near a border also needs the next district). */
    private List<Optional<KakaoLocal.Region>> regions(double lat, double lng) {
        double dLat = RING_KM / 111.0, dLng = RING_KM / (111.0 * Math.cos(Math.toRadians(lat)));
        double[][] points = {{lat, lng}, {lat + dLat, lng}, {lat - dLat, lng}, {lat, lng + dLng}, {lat, lng - dLng}};
        List<Optional<KakaoLocal.Region>> found = together(java.util.Arrays.stream(points).<Callable<Optional<KakaoLocal.Region>>>map(point -> () -> kakao.region(point[0], point[1])).toList());
        return found.stream().map(region -> region == null ? Optional.<KakaoLocal.Region>empty() : region).toList();
    }

    /** Districts to ask 1365 about: the centre's first, at most {@link #MAX_AREAS}; none when the centre is unknown. */
    private List<RegionCodes.Codes> areas(List<Optional<KakaoLocal.Region>> regions) {
        java.util.LinkedHashSet<RegionCodes.Codes> areas = new java.util.LinkedHashSet<>();
        for (Optional<KakaoLocal.Region> region : regions) {
            Optional<RegionCodes.Codes> codes = region.flatMap(r -> RegionCodes.of(r.province(), r.city()));
            if (areas.isEmpty() && codes.isEmpty()) return List.of();
            if (areas.size() < MAX_AREAS) codes.ifPresent(areas::add);
        }
        return List.copyOf(areas);
    }

    private List<Map<String, String>> list(RegionCodes.Codes codes, String q) {
        String cacheKey = codes.province() + "|" + codes.city() + "|" + q;
        Cached cached = lists.get(cacheKey);
        if (cached != null && cached.at().plus(LIST_CACHE).isAfter(clock.instant())) return cached.items();
        synchronized (listLocks.computeIfAbsent(cacheKey, ignored -> new Object())) {
            cached = lists.get(cacheKey);
            if (cached != null && cached.at().plus(LIST_CACHE).isAfter(clock.instant())) return cached.items();
            List<Map<String, String>> items = api.areaList(codes.province(), codes.city(), q, LIST_ROWS);
            // An empty answer (error or quota) is kept only briefly so the next search can try again.
            lists.put(cacheKey, new Cached(items.isEmpty() ? clock.instant().minus(LIST_CACHE).plusSeconds(300) : clock.instant(), items));
            return items;
        }
    }

    private Map<String, Object> stored(String no) {
        return jdbc.queryForList("SELECT * FROM volunteer_programs WHERE program_no = ?", no).stream().findFirst().orElse(null);
    }

    private boolean stale(Map<String, Object> row) {
        return ((LocalDateTime) row.get("fetched_at")).isBefore(LocalDateTime.now(clock).minus(DETAIL_REFRESH));
    }

    /** Detail → only public program fields are stored (the API's contact person, phone, fax, address, e-mail are dropped here). */
    private Map<String, Object> fetch(String no, Map<String, String> listEntry, double nearLat, double nearLng) {
        Map<String, String> d = new LinkedHashMap<>(listEntry);
        api.detail(no).ifPresent(d::putAll);
        String title = first(d, "progrmSj");
        if (title == null) return null;
        String place = first(d, "actPlace", "actPlc");
        Map<String, Object> old = stored(no);
        BigDecimal lat = old == null ? null : (BigDecimal) old.get("latitude"), lng = old == null ? null : (BigDecimal) old.get("longitude");
        if (lat == null && place != null) {
            Optional<KakaoLocal.Place> found = kakao.locate(place, nearLat, nearLng);
            if (found.isPresent()) { lat = BigDecimal.valueOf(found.get().latitude()); lng = BigDecimal.valueOf(found.get().longitude()); }
        }
        jdbc.update("""
                REPLACE INTO volunteer_programs(program_no, title, organization, place, field, period_start, period_end, begin_time, end_time,
                                                weekdays, recruit_status, recruit_end, capacity, youth_ok, adult_ok, latitude, longitude, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, no, cut(title, 255), cut(first(d, "mnnstNm", "nanmmbyNm"), 255), cut(place, 255), cut(first(d, "srvcClCode"), 100),
                ymd(first(d, "progrmBgnde")), ymd(first(d, "progrmEndde")), hour(first(d, "actBeginTm")), hour(first(d, "actEndTm")),
                cut(first(d, "actWkdy"), 20), status(first(d, "progrmSttusSe")), ymd(first(d, "noticeEndde")), number(first(d, "rcritNmpr")),
                yes(first(d, "yngbgsPosblAt")), yes(first(d, "adultPosblAt")), lat, lng, LocalDateTime.now(clock));
        return stored(no);
    }

    private Map<String, Object> view(Map<String, Object> row, double lat, double lng) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("programNo", row.get("program_no"));
        item.put("title", row.get("title"));
        item.put("organization", row.get("organization"));
        item.put("place", row.get("place"));
        item.put("field", row.get("field"));
        item.put("periodStart", dashed((String) row.get("period_start")));
        item.put("periodEnd", dashed((String) row.get("period_end")));
        item.put("beginTime", row.get("begin_time"));
        item.put("endTime", row.get("end_time"));
        item.put("weekdays", weekdays((String) row.get("weekdays")));
        item.put("recruitStatus", row.get("recruit_status"));
        item.put("recruitEnd", dashed((String) row.get("recruit_end")));
        item.put("capacity", row.get("capacity"));
        item.put("youthOk", row.get("youth_ok"));
        item.put("latitude", row.get("latitude"));
        item.put("longitude", row.get("longitude"));
        item.put("distanceKm", row.get("latitude") == null ? null
                : Math.round(meters(lat, lng, ((Number) row.get("latitude")).doubleValue(), ((Number) row.get("longitude")).doubleValue()) / 100.0) / 10.0);
        item.put("link", LINK + row.get("program_no"));
        return item;
    }

    /** Field names returned by the live API (no values), for checking the field mapping after the key is installed. */
    public Map<String, Object> check(double lat, double lng) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("apiKey", api.enabled());
        out.put("kakaoKey", kakao.enabled());
        Optional<KakaoLocal.Region> region = kakao.region(lat, lng);
        out.put("region", region.map(r -> r.province() + " " + r.city()).orElse(null));
        Optional<RegionCodes.Codes> codes = region.flatMap(r -> RegionCodes.of(r.province(), r.city()));
        out.put("codes", codes.map(c -> c.province() + " / " + c.city()).orElse(null));
        if (codes.isPresent() && api.enabled()) {
            List<Map<String, String>> items = api.areaList(codes.get().province(), codes.get().city(), "", 5);
            out.put("listCount", items.size());
            out.put("listFields", items.isEmpty() ? List.of() : List.copyOf(items.get(0).keySet()));
            out.put("detailFields", items.isEmpty() ? List.of() : first(items.get(0), "progrmRegistNo") == null ? List.of()
                    : api.detail(first(items.get(0), "progrmRegistNo")).map(m -> List.copyOf(m.keySet())).orElse(List.of()));
        }
        if (api instanceof DataGoKrVolunteerApi live) out.put("usedToday", live.usage());
        return out;
    }

    static String first(Map<String, String> fields, String... names) {
        for (String name : names) {
            String value = fields.get(name);
            if (value != null && !value.isBlank()) return value.trim();
        }
        return null;
    }

    private static String cut(String value, int max) {
        return value == null ? null : value.length() > max ? value.substring(0, max) : value;
    }

    private static String ymd(String value) {
        if (value == null) return null;
        String digits = value.replaceAll("[^0-9]", "");
        return digits.length() >= 8 ? digits.substring(0, 8) : null;
    }

    private static String dashed(String ymd) {
        return ymd == null || ymd.length() != 8 ? null : ymd.substring(0, 4) + "-" + ymd.substring(4, 6) + "-" + ymd.substring(6);
    }

    /** "9" → "09:00", "0930" or "09:30" → "09:30". */
    static String hour(String value) {
        if (value == null) return null;
        String digits = value.replaceAll("[^0-9]", "");
        if (digits.isEmpty() || digits.length() > 4) return null;
        if (digits.length() <= 2) return String.format("%02d:00", Integer.parseInt(digits));
        String padded = String.format("%4s", digits).replace(' ', '0');
        return padded.substring(0, 2) + ":" + padded.substring(2);
    }

    /** progrmSttusSe: 1 모집대기, 2 모집중, 3 모집완료. */
    static String status(String value) {
        if (value == null) return null;
        return switch (value.trim()) { case "1" -> "모집대기"; case "2" -> "모집중"; case "3" -> "모집완료"; default -> cut(value.trim(), 10); };
    }

    /** actWkdy "1111100" (월~일) → "월 화 수 목 금"; any other format is shown as is. */
    static String weekdays(String value) {
        if (value == null) return null;
        if (!value.matches("[01]{7}")) return value;
        String names = "월화수목금토일";
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < 7; i++) if (value.charAt(i) == '1') out.append(out.isEmpty() ? "" : " ").append(names.charAt(i));
        return out.toString();
    }

    private static Integer number(String value) {
        if (value == null) return null;
        try { return Integer.parseInt(value.replaceAll("[^0-9]", "")); } catch (NumberFormatException e) { return null; }
    }

    private static Boolean yes(String value) {
        return value == null ? null : value.trim().equalsIgnoreCase("Y");
    }

    private static double meters(double lat1, double lng1, double lat2, double lng2) {
        double r = 6_371_000, dLat = Math.toRadians(lat2 - lat1), dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }
}
