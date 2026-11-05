package com.volink.auth;

import com.volink.ApiTestSupport;
import com.volink.FakeExternal;
import com.volink.auth.social.SocialLogin;
import jakarta.servlet.http.Cookie;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Kakao / Google login (V15): personal members only, signup completed in our form, one-time code, state tied to a cookie. */
class SocialLoginIntegrationTest extends ApiTestSupport {
    @Autowired FakeExternal.Social social;

    @BeforeEach
    void on() { social.reset(); social.enabled = true; }

    @AfterEach
    void off() { social.reset(); }

    @Test
    void providersAreOffWithoutKeysAndStartSendsYouBackToLogin() throws Exception {
        social.enabled = false;
        mvc.perform(get("/api/auth/oauth/providers")).andExpect(jsonPath("$.kakao").value(false)).andExpect(jsonPath("$.google").value(false));
        mvc.perform(get("/api/auth/oauth/kakao/start")).andExpect(status().is3xxRedirection()).andExpect(redirectedUrl("/#/login?oauth=off"));
        mvc.perform(get("/api/auth/oauth/naver/start")).andExpect(status().is3xxRedirection());
    }

    @Test
    void firstLoginFinishesSignupAsAPersonalMemberThenLogsStraightIn() throws Exception {
        String subject = "k" + System.nanoTime();
        social.profiles.put(subject, new SocialLogin.Profile(subject, null, false, "카카오 이웃"));
        MockHttpServletResponse back = callback("kakao", subject);
        assertThat(back.getRedirectedUrl()).startsWith("/#/social-signup?provider=kakao&ticket=").contains("name=");
        String ticket = param(back.getRedirectedUrl(), "ticket");

        Map<String, Object> form = new HashMap<>(Map.of("ticket", ticket, "name", "카카오 이웃", "birthDate", "2015-01-01", "interests", List.of("환경"), "agreedNotice", true));
        perform(post("/api/auth/oauth/complete"), form, null).andExpect(status().isUnprocessableEntity()).andExpect(jsonPath("$.code").value("UNDER_AGE"));
        form.put("birthDate", "2001-05-14");
        form.put("memberType", "INSTITUTION");
        perform(post("/api/auth/oauth/complete"), form, null).andExpect(status().isOk()).andExpect(jsonPath("$.accessToken").exists())
                .andExpect(jsonPath("$.user.memberType").value("GENERAL")).andExpect(jsonPath("$.user.role").value("USER"));
        perform(post("/api/auth/oauth/complete"), form, null).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("SOCIAL_TAKEN"));
        assertThat(jdbc.queryForObject("SELECT u.email FROM social_accounts s JOIN users u ON u.id = s.user_id WHERE s.subject = ?", String.class, subject)).endsWith("@social.volink.invalid");

        // Second time: a one-time code that the page exchanges for the session (once).
        MockHttpServletResponse again = callback("kakao", subject);
        assertThat(again.getRedirectedUrl()).startsWith("/#/oauth?code=");
        String code = param(again.getRedirectedUrl(), "code");
        perform(post("/api/auth/oauth/finish"), Map.of("code", code), null).andExpect(status().isOk()).andExpect(jsonPath("$.user.name").value("카카오 이웃"))
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("volink_refresh=")));
        perform(post("/api/auth/oauth/finish"), Map.of("code", code), null).andExpect(status().isBadRequest());
    }

    @Test
    void aVerifiedGoogleEmailIsKeptButNeverTakesOverAnExistingAccount() throws Exception {
        String free = "g" + System.nanoTime() + "@gmail.example", sub = "g" + System.nanoTime();
        social.profiles.put(sub, new SocialLogin.Profile(sub, free, true, "구글 이웃"));
        String ticket = param(callback("google", sub).getRedirectedUrl(), "ticket");
        perform(post("/api/auth/oauth/complete"), Map.of("ticket", ticket, "name", "구글 이웃", "birthDate", "2000-01-01", "interests", List.of("복지"), "agreedNotice", true), null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.email").value(free));
        String taken = email();
        perform(post("/api/auth/signup"), signupBody(taken, "GENERAL", TODAY.minusYears(20)), null).andExpect(status().isCreated());
        String other = "g2" + System.nanoTime();
        social.profiles.put(other, new SocialLogin.Profile(other, taken, true, "다른 사람"));
        String second = param(callback("google", other).getRedirectedUrl(), "ticket");
        perform(post("/api/auth/oauth/complete"), Map.of("ticket", second, "name", "다른 사람", "birthDate", "2000-01-01", "interests", List.of("복지"), "agreedNotice", true), null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.user.email").value(org.hamcrest.Matchers.endsWith("@social.volink.invalid")));
    }

    @Test
    void aForgedStateOrAMissingCookieOrARefusalGoesBackToLogin() throws Exception {
        String sub = "x" + System.nanoTime();
        social.profiles.put(sub, new SocialLogin.Profile(sub, null, false, "누군가"));
        MockHttpServletResponse start = mvc.perform(get("/api/auth/oauth/kakao/start")).andReturn().getResponse();
        String state = param(start.getRedirectedUrl(), "state");
        mvc.perform(get("/api/auth/oauth/kakao/callback").param("code", sub).param("state", state))
                .andExpect(redirectedUrl("/#/login?oauth=OAUTH_STATE"));
        mvc.perform(get("/api/auth/oauth/kakao/callback").param("code", sub).param("state", state + "x").cookie(start.getCookie(SocialController.NONCE_COOKIE)))
                .andExpect(redirectedUrl("/#/login?oauth=OAUTH_STATE"));
        mvc.perform(get("/api/auth/oauth/kakao/callback").param("error", "access_denied").param("state", state).cookie(start.getCookie(SocialController.NONCE_COOKIE)))
                .andExpect(redirectedUrl("/#/login?oauth=OAUTH_DENIED"));
        perform(post("/api/auth/oauth/complete"), Map.of("ticket", "nope.nope", "name", "a", "birthDate", "2000-01-01", "interests", List.of("복지"), "agreedNotice", true), null)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("OAUTH_TICKET"));
    }

    private MockHttpServletResponse callback(String provider, String code) throws Exception {
        MockHttpServletResponse start = mvc.perform(get("/api/auth/oauth/" + provider + "/start")).andExpect(status().is3xxRedirection()).andReturn().getResponse();
        assertThat(start.getRedirectedUrl()).contains("/api/auth/oauth/" + provider + "/callback");
        Cookie nonce = start.getCookie(SocialController.NONCE_COOKIE);
        return mvc.perform(get("/api/auth/oauth/" + provider + "/callback").param("code", code).param("state", param(start.getRedirectedUrl(), "state")).cookie(nonce))
                .andExpect(status().is3xxRedirection()).andReturn().getResponse();
    }

    private static String param(String url, String name) {
        for (String part : url.substring(url.indexOf('?') + 1).split("&"))
            if (part.startsWith(name + "=")) return URLDecoder.decode(part.substring(name.length() + 1), StandardCharsets.UTF_8);
        throw new AssertionError(name + " missing in " + url);
    }
}
