package com.volink.auth;

import com.volink.auth.social.SocialAuthService;
import com.volink.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Kakao / Google login (personal members). The browser goes to /start, the provider sends it back to /callback,
 * and the callback answers with a redirect into the same page (web or app): /#/oauth (logged in, refresh cookie set),
 * /#/social-signup?ticket=… (first time: finish the signup form) or /#/login?oauth=… (failed).
 */
@RestController
public class SocialController {
    static final String NONCE_COOKIE = "volink_oauth";
    private final SocialAuthService social;
    private final AuthService auth;
    private final AuthController sessions;
    private final String redirectBase;
    private final String appPackage;
    private final boolean secureCookie;

    public SocialController(SocialAuthService social, AuthService auth, AuthController sessions,
                            @Value("${volink.oauth.redirect-base:}") String redirectBase, @Value("${volink.app.package:com.volink.app}") String appPackage,
                            @Value("${volink.auth.cookie-secure:true}") boolean secureCookie) {
        this.social = social;
        this.auth = auth;
        this.sessions = sessions;
        this.redirectBase = redirectBase.trim().replaceAll("/+$", "");
        this.appPackage = appPackage;
        this.secureCookie = secureCookie;
    }

    @GetMapping("/api/auth/oauth/providers")
    public Map<String, Object> providers() {
        return social.providers();
    }

    @GetMapping("/api/auth/oauth/{provider}/start")
    public void start(@PathVariable String provider, @RequestParam(required = false) String app, HttpServletRequest request, HttpServletResponse response) throws IOException {
        boolean fromApp = "1".equals(app);
        if (!Boolean.TRUE.equals(social.providers().get(provider))) { back(response, fromApp, "login?oauth=off"); return; }
        SocialAuthService.Start start = social.start(provider, callbackUri(provider, request), fromApp);
        // Lax: the provider sends the browser back with a top-level GET, which must carry this cookie.
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(NONCE_COOKIE, start.nonce()).httpOnly(true).secure(secureCookie)
                .sameSite("Lax").path("/api/auth/oauth").maxAge(Duration.ofMinutes(10)).build().toString());
        response.sendRedirect(start.url());
    }

    @GetMapping("/api/auth/oauth/{provider}/callback")
    public void callback(@PathVariable String provider, @RequestParam(required = false) String code, @RequestParam(required = false) String state,
                         @RequestParam(required = false) String error, @CookieValue(name = NONCE_COOKIE, required = false) String nonce,
                         HttpServletRequest request, HttpServletResponse response) throws IOException {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(NONCE_COOKIE, "").path("/api/auth/oauth").maxAge(Duration.ZERO).build().toString());
        boolean app = social.fromApp(state);
        try {
            if (error != null) throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST, "OAUTH_DENIED", "로그인을 취소했어요.");
            SocialAuthService.Outcome outcome = social.callback(provider, code, state, nonce, callbackUri(provider, request));
            if (outcome.userId() != null) {
                // The refresh cookie is SameSite=Strict, which a browser drops when set on this cross-site return.
                // So the page exchanges a one-time, 60-second code for the session with a same-site request.
                back(response, app, "oauth?code=" + enc(social.loginCode(outcome.userId())));
            } else {
                back(response, app, "social-signup?provider=" + provider + "&ticket=" + enc(outcome.ticket())
                        + (outcome.suggestedName() == null ? "" : "&name=" + enc(outcome.suggestedName())));
            }
        } catch (ApiException failed) {
            back(response, app, "login?oauth=" + enc(failed.code()));
        }
    }

    /**
     * The site: a redirect to /#/{route}. The Android app (login opened in the phone browser): a small page that hands
     * volink://{route} to the app, with a button in case the browser waits for a tap before opening an app.
     * {@code route} holds only URL-encoded values, so it needs no further escaping.
     */
    private void back(HttpServletResponse response, boolean app, String route) throws IOException {
        if (!app) { response.sendRedirect("/#/" + route); return; }
        String intent = "intent://" + route + "#Intent;scheme=volink;package=" + appPackage + ";end";
        response.setContentType("text/html;charset=UTF-8");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.getWriter().write("""
                <!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                <title>Volink</title><style>body{font-family:sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#1f2a24}
                a{display:block;padding:14px 22px;border-radius:12px;background:#2f8a5b;color:#fff;text-decoration:none;font-weight:700;text-align:center}</style></head>
                <body><main><p>Volink 앱으로 돌아가는 중이에요.</p><a href="%s">앱으로 돌아가기</a></main>
                <script>location.replace("%s")</script></body></html>
                """.formatted(intent.replace("&", "&amp;"), intent));
    }

    public record Finish(String code) {}

    /** After the callback: the one-time code → the session (same response as /api/auth/login). */
    @PostMapping("/api/auth/oauth/finish")
    public Map<String, Object> finish(@RequestBody Finish request, HttpServletRequest http, HttpServletResponse response) {
        return sessions.session(auth.sessionFor(social.redeem(request.code())), http, response);
    }

    public record Complete(String ticket, String name, String birthDate, List<String> interests, Boolean agreedNotice) {}

    /** First Kakao / Google login: finish the signup and log in (same response as /api/auth/login). */
    @PostMapping("/api/auth/oauth/complete")
    public Map<String, Object> complete(@RequestBody Complete request, HttpServletRequest http, HttpServletResponse response) {
        long id = social.complete(request.ticket(), request.name(), request.birthDate(), request.interests(), request.agreedNotice());
        return sessions.session(auth.sessionFor(id), http, response);
    }

    /** {base}/api/auth/oauth/{provider}/callback — exactly what is registered with the provider. */
    private String callbackUri(String provider, HttpServletRequest request) {
        String base = redirectBase;
        if (base.isEmpty()) {
            String proto = header(request, "X-Forwarded-Proto", request.getScheme());
            String host = header(request, "X-Forwarded-Host", header(request, "Host", request.getServerName() + ":" + request.getServerPort()));
            base = proto + "://" + host;
        }
        return base + "/api/auth/oauth/" + provider + "/callback";
    }

    private static String header(HttpServletRequest request, String name, String fallback) {
        String value = request.getHeader(name);
        return value == null || value.isBlank() ? fallback : value.split(",")[0].trim();
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
