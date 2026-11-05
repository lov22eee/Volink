package com.volink.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.volink.ApiTestSupport;
import com.volink.FakeExternal;
import com.volink.auth.social.SocialLogin;
import jakarta.servlet.http.Cookie;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Android app (Capacitor, origin https://localhost): cross-site calls, its own refresh token, social login back into the app. */
class AppClientIntegrationTest extends ApiTestSupport {
    static final String APP = "https://localhost";
    @Autowired FakeExternal.Social social;

    @AfterEach
    void off() { social.reset(); }

    @Test
    void onlyTheAppOriginMayCallAcrossSites() throws Exception {
        mvc.perform(options("/api/activities").header(HttpHeaders.ORIGIN, APP).header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "authorization,content-type"))
                .andExpect(status().isOk()).andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, APP))
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS));
        mvc.perform(options("/api/activities").header(HttpHeaders.ORIGIN, "https://evil.example").header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
        // The site's own pages (Origin differs from the proxied Host, as behind the Vite proxy) are not refused.
        mvc.perform(get("/api/activities").header(HttpHeaders.ORIGIN, "http://127.0.0.1:5173")).andExpect(status().isOk())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
        perform(post("/api/auth/login").header(HttpHeaders.ORIGIN, "https://volink.example"), Map.of("email", "nobody@example.com", "password", "x"), null)
                .andExpect(status().isUnauthorized());
    }

    @Test
    void theAppKeepsItsRefreshTokenInTheBodyAndTheSiteKeepsTheCookie() throws Exception {
        String email = email();
        perform(post("/api/auth/signup"), signupBody(email, "GENERAL", TODAY.minusYears(20)), null).andExpect(status().isCreated());
        String login = json.writeValueAsString(Map.of("email", email, "password", PASSWORD));

        MockHttpServletResponse app = mvc.perform(post("/api/auth/login").header(HttpHeaders.ORIGIN, APP).contentType(MediaType.APPLICATION_JSON).content(login))
                .andExpect(status().isOk()).andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE)).andReturn().getResponse();
        String refresh = json.readTree(app.getContentAsString()).path("refreshToken").asText();
        assertThat(refresh).isNotBlank();

        // A page on the site cannot use a body token (only its HttpOnly cookie).
        mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("refreshToken", refresh))))
                .andExpect(status().isUnauthorized());
        JsonNode renewed = json.readTree(mvc.perform(post("/api/auth/refresh").header(HttpHeaders.ORIGIN, APP).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("refreshToken", refresh)))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String next = renewed.path("refreshToken").asText();
        assertThat(next).isNotBlank().isNotEqualTo(refresh);
        assertThat(renewed.path("accessToken").asText()).isNotBlank();
        // Single use, then logout revokes the new one.
        mvc.perform(post("/api/auth/refresh").header(HttpHeaders.ORIGIN, APP).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("refreshToken", refresh))))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/logout").header(HttpHeaders.ORIGIN, APP).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("refreshToken", next))))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/auth/refresh").header(HttpHeaders.ORIGIN, APP).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("refreshToken", next))))
                .andExpect(status().isUnauthorized());

        // The site still gets the cookie and no token in the body.
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(login))
                .andExpect(header().string(HttpHeaders.SET_COOKIE, org.hamcrest.Matchers.containsString("volink_refresh=")))
                .andExpect(jsonPath("$.refreshToken").doesNotExist());
    }

    @Test
    void socialLoginFromTheAppComesBackIntoTheApp() throws Exception {
        social.reset();
        social.enabled = true;
        String subject = "app" + System.nanoTime();
        social.profiles.put(subject, new SocialLogin.Profile(subject, null, false, "앱 이웃"));
        MockHttpServletResponse start = mvc.perform(get("/api/auth/oauth/kakao/start").param("app", "1")).andExpect(status().is3xxRedirection()).andReturn().getResponse();
        String state = param(start.getRedirectedUrl(), "state");
        Cookie nonce = start.getCookie(SocialController.NONCE_COOKIE);
        String page = mvc.perform(get("/api/auth/oauth/kakao/callback").param("code", subject).param("state", state).cookie(nonce))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_HTML)).andReturn().getResponse().getContentAsString();
        assertThat(page).contains("intent://social-signup?provider=kakao&ticket=").contains("#Intent;scheme=volink;package=com.volink.app;end");
        // A forged state is not "from the app": the site's login page.
        mvc.perform(get("/api/auth/oauth/kakao/callback").param("code", subject).param("state", state + "x").cookie(nonce))
                .andExpect(redirectedUrl("/#/login?oauth=OAUTH_STATE"));
        social.enabled = false;
        assertThat(mvc.perform(get("/api/auth/oauth/kakao/start").param("app", "1")).andReturn().getResponse().getContentAsString())
                .contains("intent://login?oauth=off#Intent");
    }

    private static String param(String url, String name) {
        for (String part : url.substring(url.indexOf('?') + 1).split("&"))
            if (part.startsWith(name + "=")) return URLDecoder.decode(part.substring(name.length() + 1), StandardCharsets.UTF_8);
        throw new AssertionError(name + " missing in " + url);
    }
}
