package com.volink.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Service;

/** Issues 30-minute HS256 access tokens and opaque refresh tokens (docs/security-cost.md). */
@Service
public class TokenService {
    public static final Duration ACCESS_TTL = Duration.ofMinutes(30);
    public static final Duration REFRESH_TTL = Duration.ofDays(14);
    private static final Logger log = LoggerFactory.getLogger(TokenService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final SecretKey key;
    private final JwtEncoder encoder;
    private final JwtDecoder decoder;
    private final Clock clock;

    public TokenService(@Value("${volink.auth.jwt-secret:}") String secret, Clock clock) {
        this.clock = clock;
        byte[] bytes;
        if (secret.isBlank()) {
            // Without a configured secret, tokens are valid only until restart; refresh cookies re-issue them.
            bytes = new byte[32];
            RANDOM.nextBytes(bytes);
            log.warn("JWT_SECRET is not set; using a random signing key for this process only.");
        } else {
            bytes = Base64.getDecoder().decode(secret);
            if (bytes.length < 32) throw new IllegalStateException("JWT_SECRET must decode to at least 32 bytes.");
        }
        this.key = new SecretKeySpec(bytes, "HmacSHA256");
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        this.decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }

    public JwtDecoder decoder() {
        return decoder;
    }

    public String accessToken(AuthUser user) {
        Instant now = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("volink")
                .subject(String.valueOf(user.id()))
                .issuedAt(now)
                .expiresAt(now.plus(ACCESS_TTL))
                .claim("role", user.role())
                .claim("memberType", user.memberType())
                .build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }

    public static String newRefreshToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Only the SHA-256 of a refresh token is stored. */
    public static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
