package com.volink.auth;

import com.volink.common.ApiException;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Period;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Signup and login rules mirror frontend/src/rules.ts and docs/rules.md. */
@Service
public class AuthService {
    static final int MINIMUM_AGE = 14;
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final Pattern CONTACT = Pattern.compile("^[0-9-]{9,20}$");
    static final RowMapper<AuthUser> USER = (rs, i) -> new AuthUser(rs.getLong("id"), rs.getString("email"),
            rs.getString("display_name"), rs.getString("role"), rs.getString("member_type"), rs.getString("status"));

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final TokenService tokens;
    private final LoginRateLimiter limiter;
    private final Clock clock;

    public AuthService(JdbcTemplate jdbc, PasswordEncoder passwords, TokenService tokens, LoginRateLimiter limiter, Clock clock) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.tokens = tokens;
        this.limiter = limiter;
        this.clock = clock;
    }

    public record Session(AuthUser user, String accessToken, String refreshToken) {}

    @Transactional
    public long signup(SignupRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        boolean institution = "INSTITUTION".equals(request.memberType());
        if (!institution && !"GENERAL".equals(request.memberType())) errors.put("memberType", "회원 유형을 선택해 주세요.");
        String name = trim(request.name());
        if (name.isEmpty() || name.length() > 40) errors.put("name", "이름을 1~40자로 입력해 주세요.");
        LocalDate birthDate = parseDate(request.birthDate());
        if (birthDate == null) errors.put("birthDate", "생년월일을 입력해 주세요.");
        List<String> interests = request.interests() == null ? List.of()
                : List.copyOf(new LinkedHashSet<>(request.interests()));
        if (interests.isEmpty() || interests.size() > 3) errors.put("interests", "관심 분야를 1~3개 골라 주세요.");
        else if (countCategories(interests) != interests.size()) errors.put("interests", "없는 관심 분야가 있습니다.");
        if (institution) {
            String organization = trim(request.organizationName());
            if (organization.length() < 2 || organization.length() > 100) errors.put("organization", "기관명을 2~100자로 입력해 주세요.");
            if (!CONTACT.matcher(trim(request.organizationContact())).matches()) errors.put("organizationContact", "연락처는 숫자와 - 로 9~20자 입력해 주세요.");
        }
        String email = trim(request.email()).toLowerCase(Locale.ROOT);
        if (!EMAIL.matcher(email).matches() || email.length() > 254) errors.put("email", "이메일 형식을 확인해 주세요.");
        String password = request.password() == null ? "" : request.password();
        if (password.length() < 8 || password.length() > 72 || !password.matches(".*[A-Za-z].*") || !password.matches(".*\\d.*"))
            errors.put("password", "비밀번호는 영문과 숫자를 섞어 8~72자로 입력해 주세요.");
        if (!Boolean.TRUE.equals(request.agreedNotice())) errors.put("notice", "이용 안내를 확인해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);

        // Age is counted on the Korean calendar date; no guardian consent flow exists, so under 14 is refused.
        if (Period.between(birthDate, LocalDate.now(clock)).getYears() < MINIMUM_AGE)
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "UNDER_AGE", "만 14세 미만은 가입할 수 없습니다.",
                    Map.of("birthDate", "만 14세 미만은 가입할 수 없습니다."));
        if (findByEmail(email).isPresent())
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "이미 가입된 이메일입니다.", Map.of("email", "이미 가입된 이메일입니다."));

        jdbc.update("INSERT INTO users(email, display_name, password_hash, role, member_type, birth_date) VALUES (?, ?, ?, 'USER', ?, ?)",
                email, name, passwords.encode(password), institution ? "INSTITUTION" : "GENERAL", birthDate);
        long id = jdbc.queryForObject("SELECT id FROM users WHERE email = ?", Long.class, email);
        for (String interest : interests)
            jdbc.update("INSERT INTO user_interests(user_id, category_id) SELECT ?, id FROM categories WHERE name = ?", id, interest);
        if (institution)
            jdbc.update("INSERT INTO organizations(manager_user_id, name, contact) VALUES (?, ?, ?)",
                    id, trim(request.organizationName()), trim(request.organizationContact()));
        return id;
    }

    @Transactional
    public Session login(String rawEmail, String password) {
        String email = trim(rawEmail).toLowerCase(Locale.ROOT);
        if (limiter.blocked(email))
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS", "로그인 시도가 많습니다. 1분 뒤 다시 시도해 주세요.");
        Optional<String> hash = jdbc.queryForList("SELECT password_hash FROM users WHERE email = ?", String.class, email).stream().findFirst();
        if (hash.isEmpty() || password == null || !passwords.matches(password, hash.get())) {
            limiter.failed(email);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.");
        }
        limiter.succeeded(email);
        AuthUser user = findByEmail(email).orElseThrow();
        return new Session(user, tokens.accessToken(user), issueRefresh(user.id()));
    }

    /** Rotates the refresh token: the old one is revoked and can never be used again. */
    @Transactional
    public Session refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) throw unauthenticated();
        String hash = TokenService.hash(refreshToken);
        List<Long> owners = jdbc.queryForList("""
                SELECT user_id FROM refresh_tokens
                WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? FOR UPDATE
                """, Long.class, hash, LocalDateTime.now(clock));
        if (owners.isEmpty()) throw unauthenticated();
        jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?", LocalDateTime.now(clock), hash);
        AuthUser user = findById(owners.get(0));
        return new Session(user, tokens.accessToken(user), issueRefresh(user.id()));
    }

    public void logout(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) return;
        jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
                LocalDateTime.now(clock), TokenService.hash(refreshToken));
    }

    public AuthUser findById(long id) {
        return jdbc.query("SELECT * FROM users WHERE id = ?", USER, id).stream().findFirst().orElseThrow(AuthService::unauthenticated);
    }

    public Map<String, Object> profile(long id) {
        AuthUser user = findById(id);
        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("id", user.id());
        profile.put("email", user.email());
        profile.put("name", user.displayName());
        profile.put("role", user.role());
        profile.put("memberType", user.memberType());
        profile.put("status", user.status());
        profile.put("interests", jdbc.queryForList("""
                SELECT c.name FROM user_interests i JOIN categories c ON c.id = i.category_id WHERE i.user_id = ? ORDER BY c.id
                """, String.class, id));
        profile.put("organization", jdbc.queryForList("""
                SELECT id, name, status, reject_reason AS rejectReason FROM organizations WHERE manager_user_id = ?
                """, id).stream().findFirst().orElse(null));
        return profile;
    }

    @Transactional
    public void updateInterests(long userId, List<String> requested) {
        List<String> interests = requested == null ? List.of() : List.copyOf(new LinkedHashSet<>(requested));
        if (interests.isEmpty() || interests.size() > 3 || countCategories(interests) != interests.size())
            throw ApiException.validation(Map.of("interests", "관심 분야를 1~3개 골라 주세요."));
        jdbc.update("DELETE FROM user_interests WHERE user_id = ?", userId);
        for (String interest : interests)
            jdbc.update("INSERT INTO user_interests(user_id, category_id) SELECT ?, id FROM categories WHERE name = ?", userId, interest);
    }

    private String issueRefresh(long userId) {
        String token = TokenService.newRefreshToken();
        jdbc.update("INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES (?, ?, ?)",
                userId, TokenService.hash(token), LocalDateTime.now(clock).plus(TokenService.REFRESH_TTL));
        return token;
    }

    private Optional<AuthUser> findByEmail(String email) {
        return jdbc.query("SELECT * FROM users WHERE email = ?", USER, email).stream().findFirst();
    }

    private int countCategories(List<String> names) {
        String marks = String.join(",", names.stream().map(ignored -> "?").toList());
        return jdbc.queryForObject("SELECT COUNT(*) FROM categories WHERE name IN (" + marks + ")", Integer.class, names.toArray());
    }

    private static LocalDate parseDate(String value) {
        try {
            LocalDate date = LocalDate.parse(trim(value));
            return date.getYear() >= 1900 ? date : null;
        } catch (DateTimeParseException error) {
            return null;
        }
    }

    static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    static ApiException unauthenticated() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "로그인이 필요합니다.");
    }
}
