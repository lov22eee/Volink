package com.volink.volunteer;

import com.volink.place.SearchLimiter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class VolunteerController {
    private final VolunteerService volunteers;
    private final SearchLimiter limiter;

    public VolunteerController(VolunteerService volunteers, SearchLimiter limiter) {
        this.volunteers = volunteers;
        this.limiter = limiter;
    }

    /** Public: 1365 programs near a point. enabled=false when the data.go.kr or Kakao REST key is not installed. */
    @GetMapping("/api/volunteer-programs")
    public Map<String, Object> search(@RequestParam(required = false) Double lat, @RequestParam(required = false) Double lng,
                                      @RequestParam(required = false) Double radiusKm, @RequestParam(required = false) String q,
                                      @RequestParam(required = false) Boolean youth, @RequestParam(required = false) Boolean recruiting,
                                      HttpServletRequest request) {
        limiter.check(request);
        return volunteers.search(new VolunteerService.Query(lat, lng, radiusKm, q, youth, recruiting));
    }

    /** Admin only (/api/admin/**): region codes and live field names, without values. */
    @GetMapping("/api/admin/volunteer-programs/check")
    public Map<String, Object> check(@RequestParam double lat, @RequestParam double lng) {
        return volunteers.check(lat, lng);
    }
}
