package com.volink.volunteer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.net.URLDecoder;
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
        // Works with either key from the portal: the "Encoding" one (with %2B…) is decoded once, so it is not encoded twice.
        String trimmed = key.trim();
        this.key = trimmed.contains("%") ? URLDecoder.decode(trimmed, StandardCharsets.UTF_8) : trimmed;
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
        // Optional filters are left out when empty (an empty schSign1/keyword can make the gateway answer with nothing).
        StringBuilder uri = new StringBuilder(BASE + "/getVltrAreaList?serviceKey={key}&pageNo=1&numOfRows={rows}&schSido={sido}");
        List<Object> values = new ArrayList<>(List.of(key, rows, provinceCode));
        if (cityCode != null && !cityCode.isBlank()) { uri.append("&schSign1={sign}"); values.add(cityCode); }
        if (keyword != null && !keyword.isBlank()) { uri.append("&keyword={keyword}"); values.add(keyword); }
        List<Map<String, String>> found = items(call(uri.toString(), values.toArray()));
        log.info("1365 list {}/{}: {} items", provinceCode, cityCode, found.size());
        return found;
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
            // The gateway sends no charset, and Spring would then read the text as ISO-8859-1 (Korean turns into "ê°..."):
            // take the bytes and decode them ourselves.
            return decode(http.get().uri(uri, variables).retrieve().body(byte[].class));
        } catch (RuntimeException error) {
            log.warn("1365 request failed: {}", error.getClass().getSimpleName());
            return null;
        }
    }

    /** UTF-8 unless the XML declaration names another encoding (e.g. EUC-KR). */
    static String decode(byte[] body) {
        if (body == null) return null;
        String head = new String(body, 0, Math.min(body.length, 100), StandardCharsets.US_ASCII);
        java.util.regex.Matcher declared = java.util.regex.Pattern.compile("encoding=[\"']([A-Za-z0-9_-]+)[\"']").matcher(head);
        try {
            return new String(body, declared.find() ? java.nio.charset.Charset.forName(declared.group(1)) : StandardCharsets.UTF_8);
        } catch (IllegalArgumentException unknown) {
            return new String(body, StandardCharsets.UTF_8);
        }
    }

    /** Every <item> under the response as field → text. A gateway error (bad key, quota) has no items and is logged by its code only. */
    static List<Map<String, String>> items(String xml) {
        if (xml == null || xml.isBlank()) return List.of();
        String body = xml.strip();
        if (body.startsWith("{")) return jsonItems(body);
        if (!body.startsWith("<")) {
            // Plain-text gateway answers such as "SERVICE KEY IS NOT REGISTERED ERROR." or "Unauthorized".
            log.warn("1365 API answered with text: {}", body.length() > 80 ? body.substring(0, 80) : body);
            return List.of();
        }
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

    /** Some data.go.kr gateways answer in JSON: response.body.items.item (one object or a list). */
    static List<Map<String, String>> jsonItems(String json) {
        try {
            JsonNode root = new ObjectMapper().readTree(json);
            String code = root.path("response").path("header").path("resultCode").asText("");
            if (!code.isEmpty() && !code.equals("00") && !code.equals("0") && !code.equals("0000")) {
                log.warn("1365 API answered with code {}", code);
                return List.of();
            }
            JsonNode item = root.path("response").path("body").path("items").path("item");
            List<Map<String, String>> items = new ArrayList<>();
            for (JsonNode node : item.isArray() ? item : List.of(item)) {
                if (!node.isObject()) continue;
                Map<String, String> fields = new LinkedHashMap<>();
                node.fields().forEachRemaining(entry -> fields.put(entry.getKey(), entry.getValue().asText().trim()));
                items.add(fields);
            }
            return items;
        } catch (Exception error) {
            log.warn("1365 JSON response could not be read: {}", error.getClass().getSimpleName());
            return List.of();
        }
    }

    private static String text(Document document, String tag) {
        NodeList nodes = document.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? null : nodes.item(0).getTextContent().trim();
    }
}
