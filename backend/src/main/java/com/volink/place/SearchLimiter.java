package com.volink.place;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import com.volink.common.ApiException;

/**
 * Searches that call Kakao or data.go.kr: 40 per minute per visitor (single server, in memory), so one visitor
 * cannot spend the daily quota. Behind Nginx the visitor is the last X-Forwarded-For entry (added by Nginx itself).
 */
@Component
public class SearchLimiter {
    static final int PER_MINUTE = 40;
    private final Map<String, AtomicInteger> counts = new ConcurrentHashMap<>();
    private final Clock clock;
    private volatile long minute;

    public SearchLimiter(Clock clock) {
        this.clock = clock;
    }

    public void check(HttpServletRequest request) {
        long now = clock.millis() / 60_000;
        if (now != minute) { counts.clear(); minute = now; }
        if (counts.computeIfAbsent(visitor(request), ignored -> new AtomicInteger()).incrementAndGet() > PER_MINUTE)
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_SEARCHES", "검색을 너무 자주 했습니다. 1분 뒤에 다시 시도해 주세요.");
    }

    static String visitor(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        String forwarded = request.getHeader("X-Forwarded-For");
        boolean local = "127.0.0.1".equals(remote) || "0:0:0:0:0:0:0:1".equals(remote) || "::1".equals(remote);
        if (local && forwarded != null && !forwarded.isBlank()) {
            String[] parts = forwarded.split(",");
            return parts[parts.length - 1].trim();
        }
        return remote;
    }
}
