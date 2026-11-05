package com.volink.auth.social;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.volink.auth.AuthService;
import com.volink.auth.TokenService;
import com.volink.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Kakao / Google login for personal members. start → provider → callback:
 * - a linked account logs straight in;
 * - a new person gets a signed 30-minute ticket and finishes signup (name, birth date 14+, interests, notice) in our form;
 * - an institution or admin account is never created or reached this way.
 * The state is signed and tied to a browser cookie (nonce) so another site cannot finish a login in your browser.
 */
@Service
public class SocialAuthService {
    public static final List<String> PROVIDERS = List.of("kakao", "google");
    static final Duration STATE_TTL = Duration.ofMinutes(10), TICKET_TTL = Duration.ofMinutes(30);
    private final SocialLogin login;
    private final AuthService auth;
    private final JdbcTemplate jdbc;
    private final SecretKey key;
    private final Clock clock;
    private final ObjectMapper json;
    private final SecureRandom random = new SecureRandom();

    public SocialAuthService(SocialLogin login, AuthService auth, JdbcTemplate jdbc, TokenService tokens, Clock clock, ObjectMapper json) {
        this.login = login;
        this.auth = auth;
        this.jdbc = jdbc;
        this.key = tokens.derive("oauth");
        this.clock = clock;
        this.json = json;
    }

    public Map<String, Object> providers() {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String provider : PROVIDERS) result.put(provider, login.enabled(provider));
        return result;
    }

    public record Start(String url, String nonce) {}

    public Start start(String provider, String redirectUri) {
        check(provider);
        String nonce = HexFormat.of().formatHex(bytes(16));
        String state = seal(Map.of("p", provider, "n", nonce, "e", clock.instant().plus(STATE_TTL).getEpochSecond()));
        return new Start(login.authorizeUrl(provider, redirectUri, state), nonce);
    }

    /** What the callback leads to: a user id to log in, or a ticket for the signup form (with a name to suggest). */
    public record Outcome(Long userId, String ticket, String suggestedName) {}

    public Outcome callback(String provider, String code, String state, String cookieNonce, String redirectUri) {
        check(provider);
        Map<String, Object> claims = open(state);
        if (claims == null || !provider.equals(claims.get("p")) || cookieNonce == null || !MessageDigest.isEqual(cookieNonce.getBytes(StandardCharsets.US_ASCII), String.valueOf(claims.get("n")).getBytes(StandardCharsets.US_ASCII)))
            throw new ApiException(HttpStatus.BAD_REQUEST, "OAUTH_STATE", "로그인 요청이 만료됐거나 올바르지 않아요. 다시 시도해 주세요.");
        if (code == null || code.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "OAUTH_DENIED", "로그인을 취소했어요.");
        SocialLogin.Profile profile;
        try {
            profile = login.exchange(provider, code, redirectUri);
        } catch (RuntimeException error) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "OAUTH_FAILED", "카카오·구글과 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
        }
        if (profile.subject() == null || profile.subject().isBlank()) throw new ApiException(HttpStatus.BAD_GATEWAY, "OAUTH_FAILED", "계정 정보를 받지 못했어요.");
        String upper = provider.toUpperCase(Locale.ROOT);
        Long linked = jdbc.queryForList("SELECT user_id FROM social_accounts WHERE provider = ? AND subject = ?", Long.class, upper, profile.subject()).stream().findFirst().orElse(null);
        if (linked != null) return new Outcome(linked, null, null);
        Map<String, Object> ticket = new LinkedHashMap<>();
        ticket.put("p", upper);
        ticket.put("s", profile.subject());
        ticket.put("m", profile.email());
        ticket.put("v", profile.emailVerified());
        ticket.put("e", clock.instant().plus(TICKET_TTL).getEpochSecond());
        return new Outcome(null, seal(ticket), profile.name());
    }

    private final java.util.concurrent.ConcurrentHashMap<String, Long> usedCodes = new java.util.concurrent.ConcurrentHashMap<>();

    /** One-time 60-second code the page exchanges for the session right after the provider sends it back. */
    public String loginCode(long userId) {
        return seal(Map.of("u", userId, "j", HexFormat.of().formatHex(bytes(12)), "e", clock.instant().plusSeconds(60).getEpochSecond()));
    }

    public long redeem(String code) {
        Map<String, Object> claims = open(code);
        long now = clock.instant().getEpochSecond();
        usedCodes.values().removeIf(expiry -> expiry < now);
        if (claims == null || !(claims.get("u") instanceof Number user) || usedCodes.putIfAbsent(String.valueOf(claims.get("j")), ((Number) claims.get("e")).longValue()) != null)
            throw new ApiException(HttpStatus.BAD_REQUEST, "OAUTH_CODE", "로그인 시간이 지났어요. 다시 시도해 주세요.");
        return user.longValue();
    }

    /** The signup form after a first social login. Returns the new user's id. */
    public long complete(String ticket, String name, String birthDate, List<String> interests, Boolean agreed) {
        Map<String, Object> claims = open(ticket);
        if (claims == null || claims.get("s") == null)
            throw new ApiException(HttpStatus.BAD_REQUEST, "OAUTH_TICKET", "가입 시간이 지났어요. 카카오·구글 로그인을 다시 눌러 주세요.");
        return auth.signupSocial((String) claims.get("p"), (String) claims.get("s"), (String) claims.get("m"), Boolean.TRUE.equals(claims.get("v")), name, birthDate, interests, agreed);
    }

    private static void check(String provider) {
        if (!PROVIDERS.contains(provider)) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "지원하지 않는 로그인입니다.");
    }

    // ---- signed, expiring values (base64url JSON + HMAC) ----

    private String seal(Map<String, Object> claims) {
        try {
            String body = Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(claims));
            return body + "." + sign(body);
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> open(String sealed) {
        if (sealed == null) return null;
        int dot = sealed.lastIndexOf('.');
        if (dot < 1) return null;
        String body = sealed.substring(0, dot);
        if (!MessageDigest.isEqual(sign(body).getBytes(StandardCharsets.US_ASCII), sealed.substring(dot + 1).getBytes(StandardCharsets.US_ASCII))) return null;
        try {
            Map<String, Object> claims = json.readValue(Base64.getUrlDecoder().decode(body), Map.class);
            Object exp = claims.get("e");
            if (!(exp instanceof Number n) || n.longValue() < clock.instant().getEpochSecond()) return null;
            return claims;
        } catch (Exception broken) {
            return null;
        }
    }

    private String sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private byte[] bytes(int n) {
        byte[] out = new byte[n];
        random.nextBytes(out);
        return out;
    }
}
