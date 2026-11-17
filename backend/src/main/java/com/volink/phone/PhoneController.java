package com.volink.phone;

import com.volink.auth.AccountService;
import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 1인 1계정 (V42). The proof is the Firebase ID token the app got after the SMS code. */
@RestController
public class PhoneController {
    public record Proof(String proof, String note) {}
    public record Decision(String decision, String reason) {}

    private final PhoneService phones;
    private final AccountService accounts;
    private final JdbcTemplate jdbc;

    public PhoneController(PhoneService phones, AccountService accounts, JdbcTemplate jdbc) {
        this.phones = phones;
        this.accounts = accounts;
        this.jdbc = jdbc;
    }

    private static long me(Jwt jwt) { return Long.parseLong(jwt.getSubject()); }

    @GetMapping("/api/me/phone")
    public Map<String, Object> status(@AuthenticationPrincipal Jwt jwt) { return phones.status(me(jwt)); }

    @PostMapping("/api/me/phone")
    public Map<String, Object> register(@AuthenticationPrincipal Jwt jwt, @RequestBody Proof body) { return phones.register(me(jwt), body.proof()); }

    @PostMapping("/api/me/phone/dispute")
    public Map<String, Object> dispute(@AuthenticationPrincipal Jwt jwt, @RequestBody Proof body) { return phones.dispute(me(jwt), body.proof(), body.note()); }

    /** Whether the app asks for a phone at sign-up (Firebase phone check on, and not switched off). */
    @GetMapping("/api/auth/phone")
    public Map<String, Object> mode() { return Map.of("active", phones.active()); }

    /** Before an e-mail sign-up (no account yet): is this proven number free? */
    @PostMapping("/api/auth/phone-check")
    public Map<String, Object> check(@RequestBody Proof body) { return phones.check(body.proof()); }

    /**
     * "그 계정으로 로그인" right after a Kakao / Google sign-up whose number already has an account: the new, empty account
     * (made in the last 24 hours, no number yet) is withdrawn so the person goes back to the one they had.
     */
    @PostMapping("/api/me/phone/abandon")
    public Map<String, Object> abandon(@AuthenticationPrincipal Jwt jwt) {
        long id = me(jwt);
        Integer fresh = jdbc.queryForObject(Sql.kst("""
                SELECT COUNT(*) FROM users WHERE id = ? AND phone_hash IS NULL AND member_type = 'GENERAL' AND role = 'USER'
                  AND KST(created_at) > CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+09:00') - INTERVAL 1 DAY"""), Integer.class, id);
        if (fresh == null || fresh == 0) throw new ApiException(HttpStatus.CONFLICT, "NOT_FRESH", "이 계정은 정리할 수 없어요.");
        accounts.withdraw(id, true);
        return Map.of("status", "WITHDRAWN");
    }

    @GetMapping("/api/admin/phone-disputes")
    public List<Map<String, Object>> disputes() { return phones.openDisputes(); }

    @PostMapping("/api/admin/phone-disputes/{id}/decision")
    public Map<String, Object> decide(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @RequestBody Decision body) {
        return phones.decide(me(jwt), id, body.decision(), body.reason());
    }
}
