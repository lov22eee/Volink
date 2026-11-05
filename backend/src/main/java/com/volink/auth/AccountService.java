package com.volink.auth;

import com.volink.auth.social.SocialLogin;
import com.volink.common.ApiException;
import com.volink.common.Sql;
import com.volink.participation.ParticipationService;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 연결된 로그인 계정 and 회원 탈퇴 (V19, user decision 2026-11-05).
 * <ul>
 *   <li>Refused while the member hosts an activity that has not ended and still has applicants (cancel it first).</li>
 *   <li>The member's own applications to activities that have not started are cancelled (the next waiting person is
 *       offered the seat, the organizer is told when a confirmed person leaves).</li>
 *   <li>Hosted activities without applicants that have not ended are deleted (hidden, like the organizer's delete).</li>
 *   <li>Personal data is cleared; posts and comments stay and show "탈퇴한 회원"; Kakao is unlinked when the server has
 *       the Kakao admin key (Google cannot be revoked without the person's token: they remove it in their Google account).</li>
 * </ul>
 */
@Service
public class AccountService {
    public static final String WITHDRAWN_NAME = "탈퇴한 회원";
    static final String PLACEHOLDER_DOMAIN = "@social.volink.invalid";
    private static final Logger log = LoggerFactory.getLogger(AccountService.class);
    private static final String LIVE_HOSTED = "a.organizer_id = ? AND a.status IN ('DRAFT', 'RECRUITING', 'HELD', 'IN_PROGRESS') AND a.ends_at > ?";
    private static final String HAS_PEOPLE = "EXISTS (SELECT 1 FROM participations p WHERE p.activity_id = a.id AND p.status IN ('APPLIED', 'WAITLISTED', 'OFFERED', 'CONFIRMED', 'CHECKED_IN'))";

    public record Link(String provider, String subject) {}

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final ParticipationService participations;
    private final SocialLogin social;
    private final PasswordEncoder passwords;
    private final Clock clock;

    public AccountService(JdbcTemplate jdbc, AuthService auth, ParticipationService participations, SocialLogin social, PasswordEncoder passwords, Clock clock) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.participations = participations;
        this.social = social;
        this.passwords = passwords;
        this.clock = clock;
    }

    /** How this member signs in: Kakao / Google links, or e-mail and password. A placeholder e-mail is never shown. */
    public Map<String, Object> account(long userId) {
        AuthUser user = auth.findById(userId);
        List<Map<String, Object>> links = jdbc.queryForList(Sql.kst("""
                SELECT provider, DATE_FORMAT(KST(created_at), '%Y-%m-%d') AS linkedOn FROM social_accounts WHERE user_id = ? ORDER BY created_at
                """), userId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("method", links.isEmpty() ? "EMAIL" : links.get(0).get("provider"));
        out.put("email", shownEmail(user.email()));
        out.put("links", links);
        out.put("joinedOn", jdbc.queryForObject(Sql.kst("SELECT DATE_FORMAT(KST(created_at), '%Y-%m-%d') FROM users WHERE id = ?"), String.class, userId));
        out.put("memberType", user.memberType());
        return out;
    }

    /** What a withdrawal would do now, shown before the person confirms. */
    public Map<String, Object> preview(long userId) {
        LocalDateTime now = LocalDateTime.now(clock);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("blocking", jdbc.queryForList("SELECT a.id, a.title, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date FROM activities a WHERE " + LIVE_HOSTED + " AND " + HAS_PEOPLE + " ORDER BY a.starts_at", userId, now));
        out.put("applications", jdbc.queryForObject("""
                SELECT COUNT(*) FROM participations p JOIN activities a ON a.id = p.activity_id
                WHERE p.user_id = ? AND p.status IN ('APPLIED', 'WAITLISTED', 'OFFERED', 'CONFIRMED') AND a.starts_at > ?
                """, Integer.class, userId, now));
        out.put("hosted", jdbc.queryForObject("SELECT COUNT(*) FROM activities a WHERE " + LIVE_HOSTED + " AND NOT " + HAS_PEOPLE, Integer.class, userId, now));
        out.put("allowed", ((List<?>) out.get("blocking")).isEmpty() && "GENERAL".equals(auth.findById(userId).memberType()));
        return out;
    }

    /** Clears the account in one transaction and returns the social links to unlink afterwards (outside the transaction). */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public List<Link> withdraw(long userId, Boolean confirmed) {
        if (!Boolean.TRUE.equals(confirmed)) throw ApiException.validation(Map.of("confirm", "탈퇴 안내를 확인해 주세요."));
        AuthUser user = auth.findById(userId);
        if (user.admin()) throw conflict("ADMIN_ACCOUNT", "관리자 계정은 탈퇴할 수 없습니다.");
        if (!"GENERAL".equals(user.memberType())) throw conflict("INSTITUTION_ACCOUNT", "기관 회원 탈퇴는 관리자에게 문의해 주세요.");
        LocalDateTime now = LocalDateTime.now(clock);
        // The member row first: a second withdrawal (double tap) waits here and then finds the account gone.
        jdbc.queryForList("SELECT id FROM users WHERE id = ? FOR UPDATE", userId);
        if (jdbc.queryForObject("SELECT COUNT(*) FROM activities a WHERE " + LIVE_HOSTED + " AND " + HAS_PEOPLE, Integer.class, userId, now) > 0)
            throw conflict("HOSTING_ACTIVE", "신청자가 있는 모집 중인 활동이 있어요. 먼저 활동을 취소해 주세요.");

        int cancelled = 0;
        for (Long id : jdbc.queryForList("""
                SELECT p.id FROM participations p JOIN activities a ON a.id = p.activity_id
                WHERE p.user_id = ? AND p.status IN ('APPLIED', 'WAITLISTED', 'OFFERED', 'CONFIRMED') AND a.starts_at > ? ORDER BY p.id
                """, Long.class, userId, now)) {
            participations.cancel(userId, id, "탈퇴");
            cancelled++;
        }
        int closed = jdbc.update("UPDATE activities a SET a.status = 'DELETED' WHERE " + LIVE_HOSTED + " AND NOT " + HAS_PEOPLE, userId, now);

        List<Link> links = jdbc.query("SELECT provider, subject FROM social_accounts WHERE user_id = ?", (rs, i) -> new Link(rs.getString(1), rs.getString(2)), userId);
        jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
        for (String table : List.of("social_accounts", "user_interests", "saved_activities", "notification_settings", "notifications", "activity_post_seen"))
            jdbc.update("DELETE FROM " + table + " WHERE user_id = ?", userId);
        jdbc.update("""
                UPDATE users SET email = ?, display_name = ?, password_hash = ?, birth_date = '1900-01-01', community_nickname = NULL,
                    community_agreed_at = NULL, nickname_changed_at = NULL, status = 'WITHDRAWN', withdrawn_at = ? WHERE id = ?
                """, "withdrawn-" + userId + "@withdrawn.volink.invalid", WITHDRAWN_NAME, passwords.encode(UUID.randomUUID().toString()), now, userId);
        jdbc.update("INSERT INTO account_withdrawals(user_id, providers, cancelled_applications, closed_activities, withdrawn_at) VALUES (?, ?, ?, ?, ?)",
                userId, links.isEmpty() ? "EMAIL" : String.join(",", links.stream().map(Link::provider).toList()), cancelled, closed, now);
        return links;
    }

    /** Best effort after the withdrawal is saved: a provider that refuses or is unreachable does not undo it. */
    public void unlink(long userId, List<Link> links) {
        List<String> done = new ArrayList<>();
        for (Link link : links) {
            try {
                if (social.unlink(link.provider().toLowerCase(Locale.ROOT), link.subject())) done.add(link.provider());
            } catch (RuntimeException error) {
                log.warn("social unlink failed for withdrawn user {} ({}): {}", userId, link.provider(), error.getClass().getSimpleName());
            }
        }
        if (!done.isEmpty()) jdbc.update("UPDATE account_withdrawals SET unlinked = ? WHERE user_id = ?", String.join(",", done), userId);
    }

    static String shownEmail(String email) {
        return email == null || email.endsWith(PLACEHOLDER_DOMAIN) || email.endsWith("@withdrawn.volink.invalid") ? null : email;
    }

    private static ApiException conflict(String code, String message) {
        return new ApiException(HttpStatus.CONFLICT, code, message);
    }
}
