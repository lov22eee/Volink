package com.volink.stats;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class StatsController {
    private final StatsService stats;

    public StatsController(StatsService stats) {
        this.stats = stats;
    }

    /** Home banner numbers (signed-in members). Counts only; the position is used for this answer and not stored. */
    @GetMapping("/api/stats/home")
    public Map<String, Object> home(@RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng,
                                    @RequestParam(required = false) Double radiusKm) {
        return stats.home(lat, lng, radiusKm);
    }
}
