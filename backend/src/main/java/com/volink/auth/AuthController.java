package com.volink.auth;

import com.volink.config.AppClients;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
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
    private final AppClients apps;
    private final boolean secureCookie;

    public AuthController(AuthService auth, AppClients apps, @Value("${volink.auth.cookie-secure:true}") boolean secureCookie) {
        this.auth = auth;
        this.apps = apps;
        this.secureCookie = secureCookie;
    }

    public record LoginRequest(String email, String password) {}
    public record InterestsRequest(List<String> interests) {}
    /** The Android app keeps its refresh token itself and sends it in the body (no cookie across sites). */
    public record RefreshRequest(String refreshToken) {}

    @PostMapping("/api/auth/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> signup(@RequestBody SignupRequest request) {
        return auth.profile(auth.signup(request));
    }

    @PostMapping("/api/auth/login")
    public Map<String, Object> login(@RequestBody LoginRequest request, HttpServletRequest http, HttpServletResponse response) {
        return session(auth.login(request.email(), request.password()), http, response);
    }

    @PostMapping("/api/auth/refresh")
    public Map<String, Object> refresh(@CookieValue(name = REFRESH_COOKIE, required = false) String cookie, @RequestBody(required = false) RefreshRequest body,
                                       HttpServletRequest http, HttpServletResponse response) {
        try {
            return session(auth.refresh(token(cookie, body, http)), http, response);
        } catch (RuntimeException error) {
            setCookie(response, "", Duration.ZERO);
            throw error;
        }
    }

    @PostMapping("/api/auth/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@CookieValue(name = REFRESH_COOKIE, required = false) String cookie, @RequestBody(required = false) RefreshRequest body,
                       HttpServletRequest http, HttpServletResponse response) {
        auth.logout(token(cookie, body, http));
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

    /** The site gets the refresh token as an HttpOnly cookie; the Android app gets it in the body (it has no same-site cookie). */
    Map<String, Object> session(AuthService.Session session, HttpServletRequest http, HttpServletResponse response) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("accessToken", session.accessToken());
        body.put("expiresIn", TokenService.ACCESS_TTL.toSeconds());
        body.put("user", auth.profile(session.user().id()));
        if (apps.isApp(http)) body.put("refreshToken", session.refreshToken());
        else setCookie(response, session.refreshToken(), TokenService.REFRESH_TTL);
        return body;
    }

    /** The cookie on the site; the body only from the app's origin (a page on the site cannot use a body token). */
    private String token(String cookie, RefreshRequest body, HttpServletRequest http) {
        if (cookie != null && !cookie.isBlank()) return cookie;
        return body != null && apps.isApp(http) ? body.refreshToken() : null;
    }

    /** HttpOnly + SameSite=Strict refresh cookie, sent only to /api/auth. */
    void setCookie(HttpServletResponse response, String value, Duration maxAge) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(REFRESH_COOKIE, value)
                .httpOnly(true).secure(secureCookie).sameSite("Strict").path("/api/auth").maxAge(maxAge).build().toString());
    }
}
