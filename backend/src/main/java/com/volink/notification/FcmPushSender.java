package com.volink.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

/**
 * Firebase Cloud Messaging HTTP v1. The service account JSON (Firebase console → 프로젝트 설정 → 서비스 계정 → 새 비공개 키)
 * stays on the server only (FIREBASE_SERVICE_ACCOUNT_FILE, put there by hand; never in git or a VITE_ variable).
 * A signed JWT is exchanged for an access token (cached ~50 min). Not reachable from the development sandbox.
 */
@Component
public class FcmPushSender implements PushSender {
    private static final Logger log = LoggerFactory.getLogger(FcmPushSender.class);
    private static final String SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

    private final RestClient http;
    private final String projectId, clientEmail, tokenUri;
    private final PrivateKey key;
    private String accessToken;
    private Instant accessUntil = Instant.EPOCH;

    public FcmPushSender(@Value("${volink.firebase.service-account-file:}") String file, ObjectMapper json) {
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(4));
        timeouts.setReadTimeout(Duration.ofSeconds(8));
        this.http = RestClient.builder().requestFactory(timeouts).build();
        String project = null, email = null, uri = null;
        PrivateKey parsed = null;
        if (file != null && !file.isBlank()) {
            try {
                JsonNode account = json.readTree(Files.readString(Path.of(file.trim())));
                project = account.path("project_id").asText(null);
                email = account.path("client_email").asText(null);
                uri = account.path("token_uri").asText("https://oauth2.googleapis.com/token");
                String pem = account.path("private_key").asText("").replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
                parsed = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
            } catch (Exception error) {
                // The key's content is never logged.
                log.warn("Firebase service account file could not be read ({}); phone push is off", error.getClass().getSimpleName());
                project = null;
            }
        }
        this.projectId = project;
        this.clientEmail = email;
        this.tokenUri = uri;
        this.key = parsed;
    }

    @Override
    public boolean enabled() {
        return projectId != null && clientEmail != null && key != null;
    }

    @Override
    public Result send(String token, String title, String body, String link) {
        if (!enabled()) return Result.FAILED;
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("token", token);
        message.put("notification", Map.of("title", title, "body", body));
        message.put("data", Map.of("link", link == null ? "#/notifications" : link));
        message.put("android", Map.of("priority", "HIGH", "notification", Map.of("channel_id", "volink")));
        try {
            http.post().uri("https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send")
                    .header("Authorization", "Bearer " + access()).contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("message", message)).retrieve().toBodilessEntity();
            return Result.SENT;
        } catch (HttpClientErrorException error) {
            String text = error.getResponseBodyAsString();
            if (error.getStatusCode().value() == 404 || text.contains("UNREGISTERED") || text.contains("registration token is not a valid"))
                return Result.GONE;
            log.warn("FCM refused a push: HTTP {}", error.getStatusCode().value());
            return Result.FAILED;
        } catch (RuntimeException error) {
            log.warn("FCM push failed: {}", error.getClass().getSimpleName());
            return Result.FAILED;
        }
    }

    private synchronized String access() {
        if (accessToken != null && Instant.now().isBefore(accessUntil)) return accessToken;
        try {
            Instant now = Instant.now();
            SignedJWT assertion = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).build(),
                    new JWTClaimsSet.Builder().issuer(clientEmail).audience(tokenUri).claim("scope", SCOPE)
                            .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(3600))).build());
            assertion.sign(new RSASSASigner(key));
            MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
            form.add("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
            form.add("assertion", assertion.serialize());
            JsonNode answer = http.post().uri(tokenUri).contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(JsonNode.class);
            accessToken = answer == null ? null : answer.path("access_token").asText(null);
            if (accessToken == null) throw new IllegalStateException("no access token");
            accessUntil = now.plusSeconds(Math.max(60, answer.path("expires_in").asLong(3600) - 600));
            return accessToken;
        } catch (Exception error) {
            throw new IllegalStateException("Firebase access token: " + error.getClass().getSimpleName());
        }
    }
}
