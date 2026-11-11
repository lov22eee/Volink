package com.volink.admin;

import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** PC 관리자 콘솔 (2026-11-11). /api/admin/** is ADMIN only (SecurityConfig). */
@RestController
public class OpsController {
    private final OpsService ops;

    public OpsController(OpsService ops) {
        this.ops = ops;
    }

    @GetMapping("/api/admin/actions")
    public List<Map<String, Object>> actions(@RequestParam(required = false) String type, @RequestParam(defaultValue = "50") int limit,
                                             @RequestParam(defaultValue = "false") boolean today) {
        return ops.actions(type, limit, today);
    }

    @GetMapping("/api/admin/overview")
    public Map<String, Object> overview() {
        return ops.overview();
    }

    @GetMapping("/api/admin/system")
    public Map<String, Object> system() {
        return ops.system();
    }

    @GetMapping("/api/admin/members")
    public List<Map<String, Object>> members(@RequestParam(defaultValue = "") String q) {
        return ops.members(q);
    }

    @GetMapping("/api/admin/members/{id}")
    public Map<String, Object> member(@PathVariable long id) {
        return ops.member(id);
    }
}
