package com.volink.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** Allows 5 failed logins per email per minute (single-server, in-memory). */
@Component
public class LoginRateLimiter {
    static final int MAX_FAILURES = 5;
    static final Duration WINDOW = Duration.ofMinutes(1);
    private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();
    private final Clock clock;

    public LoginRateLimiter(Clock clock) {
        this.clock = clock;
    }

    public boolean blocked(String key) {
        Deque<Instant> recent = failures.get(key);
        if (recent == null) return false;
        synchronized (recent) {
            prune(recent);
            return recent.size() >= MAX_FAILURES;
        }
    }

    public void failed(String key) {
        Deque<Instant> recent = failures.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (recent) {
            prune(recent);
            recent.addLast(clock.instant());
        }
    }

    public void succeeded(String key) {
        failures.remove(key);
    }

    private void prune(Deque<Instant> recent) {
        Instant limit = clock.instant().minus(WINDOW);
        while (!recent.isEmpty() && recent.peekFirst().isBefore(limit)) recent.removeFirst();
    }
}
