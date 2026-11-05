package com.volink.auth.social;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/**
 * Real Kakao / Google calls. Kakao: kauth.kakao.com (authorize, token) + kapi.kakao.com/v2/user/me.
 * Google: accounts.google.com (authorize) + oauth2.googleapis.com/token + openidconnect.googleapis.com/v1/userinfo.
 * Client secrets stay on the server. Not reachable from the development sandbox; tests use a fake.
 */
@Component
public class HttpSocialLogin implements SocialLogin {
    private final Map<String, String[]> clients;
    private final RestClient http;

    public HttpSocialLogin(@Value("${volink.oauth.kakao-client-id:}") String kakaoId, @Value("${volink.oauth.kakao-client-secret:}") String kakaoSecret,
                           @Value("${volink.oauth.google-client-id:}") String googleId, @Value("${volink.oauth.google-client-secret:}") String googleSecret) {
        this.clients = Map.of("kakao", new String[]{kakaoId.trim(), kakaoSecret.trim()}, "google", new String[]{googleId.trim(), googleSecret.trim()});
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(4));
        timeouts.setReadTimeout(Duration.ofSeconds(6));
        this.http = RestClient.builder().requestFactory(timeouts).build();
    }

    @Override
    public boolean enabled(String provider) {
        String[] client = clients.get(provider);
        // Google needs its secret; Kakao works with the REST key alone (its secret is optional).
        return client != null && !client[0].isBlank() && ("kakao".equals(provider) || !client[1].isBlank());
    }

    @Override
    public String authorizeUrl(String provider, String redirectUri, String state) {
        String id = enc(clients.get(provider)[0]), redirect = enc(redirectUri), s = enc(state);
        return "kakao".equals(provider)
                ? "https://kauth.kakao.com/oauth/authorize?response_type=code&client_id=" + id + "&redirect_uri=" + redirect + "&state=" + s
                : "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=" + id + "&redirect_uri=" + redirect
                  + "&scope=" + enc("openid email profile") + "&state=" + s + "&prompt=select_account";
    }

    @Override
    public Profile exchange(String provider, String code, String redirectUri) {
        String[] client = clients.get(provider);
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", client[0]);
        form.add("redirect_uri", redirectUri);
        form.add("code", code);
        if (!client[1].isBlank()) form.add("client_secret", client[1]);
        boolean kakao = "kakao".equals(provider);
        JsonNode token = http.post().uri(kakao ? "https://kauth.kakao.com/oauth/token" : "https://oauth2.googleapis.com/token")
                .contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(JsonNode.class);
        String access = token == null ? null : token.path("access_token").asText(null);
        if (access == null) throw new IllegalStateException("no access token");
        JsonNode me = http.get().uri(kakao ? "https://kapi.kakao.com/v2/user/me" : "https://openidconnect.googleapis.com/v1/userinfo")
                .header("Authorization", "Bearer " + access).retrieve().body(JsonNode.class);
        if (me == null) throw new IllegalStateException("no profile");
        if (kakao) {
            JsonNode account = me.path("kakao_account");
            return new Profile(me.path("id").asText(), account.path("email").asText(null), account.path("is_email_verified").asBoolean(false),
                    account.path("profile").path("nickname").asText(me.path("properties").path("nickname").asText(null)));
        }
        return new Profile(me.path("sub").asText(), me.path("email").asText(null), me.path("email_verified").asBoolean(false), me.path("name").asText(null));
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
