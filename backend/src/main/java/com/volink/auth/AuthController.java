package com.volink.auth;

import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AuthController {
    static final String REFRESH_COOKIE = "volink_refresh";
    private final AuthService auth;
    private final boolean secureCookie;

    public AuthController(AuthService auth, @Value("${volink.auth.cookie-secure:true}") boolean secureCookie) {
        this.auth = auth;
        this.secureCookie = secureCookie;
    }

    public record LoginRequest(String email, String password) {}
    public record InterestsRequest(List<String> interests) {}

    @PostMapping("/api/auth/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> signup(@RequestBody SignupRequest request) {
        return auth.profile(auth.signup(request));
    }

    @PostMapping("/api/auth/login")
    public Map<String, Object> login(@RequestBody LoginRequest request, HttpServletResponse response) {
        return session(auth.login(request.email(), request.password()), response);
    }

    @PostMapping("/api/auth/refresh")
    public Map<String, Object> refresh(@CookieValue(name = REFRESH_COOKIE, required = false) String token, HttpServletResponse response) {
        try {
            return session(auth.refresh(token), response);
        } catch (RuntimeException error) {
            setCookie(response, "", Duration.ZERO);
            throw error;
        }
    }

    @PostMapping("/api/auth/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@CookieValue(name = REFRESH_COOKIE, required = false) String token, HttpServletResponse response) {
        auth.logout(token);
        setCookie(response, "", Duration.ZERO);
    }

    @GetMapping("/api/me")
    public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
        return auth.profile(Long.parseLong(jwt.getSubject()));
    }

    @PutMapping("/api/me/interests")
    public Map<String, Object> interests(@AuthenticationPrincipal Jwt jwt, @RequestBody InterestsRequest request) {
        long id = Long.parseLong(jwt.getSubject());
        auth.updateInterests(id, request.interests());
        return auth.profile(id);
    }

    private Map<String, Object> session(AuthService.Session session, HttpServletResponse response) {
        setCookie(response, session.refreshToken(), TokenService.REFRESH_TTL);
        return Map.of("accessToken", session.accessToken(), "expiresIn", TokenService.ACCESS_TTL.toSeconds(),
                "user", auth.profile(session.user().id()));
    }

    /** HttpOnly + SameSite=Strict refresh cookie, sent only to /api/auth. */
    private void setCookie(HttpServletResponse response, String value, Duration maxAge) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(REFRESH_COOKIE, value)
                .httpOnly(true).secure(secureCookie).sameSite("Strict").path("/api/auth").maxAge(maxAge).build().toString());
    }
}
