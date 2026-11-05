package com.volink.stats;

import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Room for an official yearly statistic (e.g. KOSIS volunteering rate) next to Volink's own numbers. Not connected yet
 * (2026-11-05 user decision): this default answers nothing, and the home banner shows no official figure.
 * A future source implements {@link #latest()} with its own key, cache and source label.
 */
public interface OfficialStats {
    /** {label, value, year, source} or empty. */
    Optional<Map<String, Object>> latest();

    @Component
    class None implements OfficialStats {
        @Override public Optional<Map<String, Object>> latest() { return Optional.empty(); }
    }
}
