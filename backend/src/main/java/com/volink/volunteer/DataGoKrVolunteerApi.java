package com.volink.volunteer;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * XML client for https://apis.data.go.kr/1741000/volunteerPartcptnService. The key is the "일반 인증키 (Decoding)" in
 * DATA_GO_KR_KEY; it is sent URL-encoded and never logged. The development account allows 1000 calls a day per
 * operation, so each operation stops at {@link #DAILY_LIMIT} and the rest of the day is served from the cache.
 */
@Component
public class DataGoKrVolunteerApi implements VolunteerApi {
    static final String BASE = "https://apis.data.go.kr/1741000/volunteerPartcptnService";
    static final int DAILY_LIMIT = 900;
    private static final Logger log = LoggerFactory.getLogger(DataGoKrVolunteerApi.class);

    private final RestClient http;
    private final String key;
    private final Clock clock;
    private final Map<String, AtomicInteger> used = new ConcurrentHashMap<>();
    private volatile LocalDate day;

    public DataGoKrVolunteerApi(@Value("${volink.data-go-kr.key:}") String key, Clock clock) {
        this.key = key.trim();
        this.clock = clock;
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(3));
        timeouts.setReadTimeout(Duration.ofSeconds(8));
        this.http = RestClient.builder().requestFactory(timeouts).build();
    }

    @Override
    public boolean enabled() {
        return !key.isEmpty();
    }

    @Override
    public List<Map<String, String>> areaList(String provinceCode, String cityCode, String keyword, int rows) {
        if (!enabled() || !spend("area")) return List.of();
        String uri = BASE + "/getVltrAreaList?serviceKey={key}&pageNo=1&numOfRows={rows}&schSido={sido}&schSign1={sign}&keyword={keyword}";
        return items(call(uri, key, rows, provinceCode, cityCode == null ? "" : cityCode, keyword == null ? "" : keyword));
    }

    @Override
    public Optional<Map<String, String>> detail(String programNo) {
        if (!enabled() || !spend("detail")) return Optional.empty();
        return items(call(BASE + "/getVltrPartcptnItem?serviceKey={key}&pageNo=1&numOfRows=1&progrmRegistNo={no}", key, programNo))
                .stream().findFirst();
    }

    /** Calls used today per operation, for the admin check. */
    public Map<String, Integer> usage() {
        spend(null);
        Map<String, Integer> counts = new LinkedHashMap<>();
        used.forEach((operation, count) -> counts.put(operation, count.get()));
        return counts;
    }

    private synchronized boolean spend(String operation) {
        LocalDate today = LocalDate.now(clock.withZone(ZoneId.of("Asia/Seoul")));
        if (!today.equals(day)) { used.clear(); day = today; }
        if (operation == null) return true;
        if (used.computeIfAbsent(operation, ignored -> new AtomicInteger()).incrementAndGet() <= DAILY_LIMIT) return true;
        log.warn("1365 {} calls reached today's limit; serving cached programs only.", operation);
        return false;
    }

    private String call(String uri, Object... variables) {
        try {
            return http.get().uri(uri, variables).retrieve().body(String.class);
        } catch (RuntimeException error) {
            log.warn("1365 request failed: {}", error.getClass().getSimpleName());
            return null;
        }
    }

    /** Every <item> under the response as field → text. A gateway error (bad key, quota) has no items and is logged by its code only. */
    static List<Map<String, String>> items(String xml) {
        if (xml == null || xml.isBlank()) return List.of();
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            // No DTDs or external entities (XXE): the response is data from another server.
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            Document document = factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
            String code = text(document, "resultCode");
            String reason = text(document, "returnReasonCode");
            if (reason != null || code != null && !code.equals("00") && !code.equals("0") && !code.equals("0000")) {
                log.warn("1365 API answered with code {}", reason != null ? reason : code);
                return List.of();
            }
            NodeList nodes = document.getElementsByTagName("item");
            List<Map<String, String>> items = new ArrayList<>();
            for (int i = 0; i < nodes.getLength(); i++) {
                Map<String, String> fields = new LinkedHashMap<>();
                for (Node child = nodes.item(i).getFirstChild(); child != null; child = child.getNextSibling())
                    if (child instanceof Element element) fields.put(element.getTagName(), element.getTextContent().trim());
                items.add(fields);
            }
            return items;
        } catch (Exception error) {
            log.warn("1365 response could not be read: {}", error.getClass().getSimpleName());
            return List.of();
        }
    }

    private static String text(Document document, String tag) {
        NodeList nodes = document.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? null : nodes.item(0).getTextContent().trim();
    }
}
