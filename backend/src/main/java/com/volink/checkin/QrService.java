package com.volink.checkin;

import com.volink.auth.TokenService;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

/**
 * QR value = "{activityId}.{issuedAtSeconds}.{HMAC-SHA256}" signed with a key derived from the server secret.
 * Valid for 60 seconds. It cannot be forged, but it can be photographed and forwarded, so check-in also needs
 * the time window and the location. It does not prove attendance perfectly.
 */
@Service
public class QrService {
    public static final Duration VALID = Duration.ofSeconds(60);

    public enum Result { VALID, EXPIRED, INVALID }

    private final SecretKey key;
    private final Clock clock;

    public QrService(TokenService tokens, Clock clock) {
        this.key = tokens.derive("qr");
        this.clock = clock;
    }

    public String issue(long activityId) {
        return token(activityId, clock.instant());
    }

    public String token(long activityId, Instant issuedAt) {
        String body = activityId + "." + issuedAt.getEpochSecond();
        return body + "." + sign(body);
    }

    public Result check(String token, long activityId) {
        if (token == null) return Result.INVALID;
        String[] parts = token.trim().split("\\.");
        if (parts.length != 3 || !parts[0].equals(String.valueOf(activityId))) return Result.INVALID;
        String body = parts[0] + "." + parts[1];
        if (!MessageDigest.isEqual(sign(body).getBytes(StandardCharsets.US_ASCII), parts[2].getBytes(StandardCharsets.US_ASCII))) return Result.INVALID;
        long issued;
        try { issued = Long.parseLong(parts[1]); } catch (NumberFormatException e) { return Result.INVALID; }
        long age = clock.instant().getEpochSecond() - issued;
        if (age < -5) return Result.INVALID;
        return age > VALID.getSeconds() ? Result.EXPIRED : Result.VALID;
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
}
