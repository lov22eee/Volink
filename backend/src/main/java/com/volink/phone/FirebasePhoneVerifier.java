package com.volink.phone;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

/**
 * Firebase Authentication (phone) ID tokens, checked against Google's public keys: issuer and audience must be this
 * Firebase project (project_id from the same service account file as push), and the sign-in must be by phone.
 * In local development (PHONE_DEV_VERIFY=true, never on the server) a proof "dev:+8210…" is accepted instead.
 */
@Component
public class FirebasePhoneVerifier implements PhoneVerifier {
    private static final Logger log = LoggerFactory.getLogger(FirebasePhoneVerifier.class);
    private static final String KEYS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
    private final JwtDecoder decoder;
    private final boolean dev;

    public FirebasePhoneVerifier(@Value("${volink.firebase.service-account-file:}") String file,
                                 @Value("${volink.phone.dev-verify:false}") boolean dev, ObjectMapper json) {
        this.dev = dev;
        String project = null;
        if (file != null && !file.isBlank()) {
            try { project = json.readTree(Files.readString(Path.of(file.trim()))).path("project_id").asText(null); }
            catch (Exception error) { log.warn("Firebase service account file could not be read ({}); phone check is off", error.getClass().getSimpleName()); }
        }
        if (project == null) { decoder = null; return; }
        NimbusJwtDecoder nimbus = NimbusJwtDecoder.withJwkSetUri(KEYS).jwsAlgorithm(SignatureAlgorithm.RS256).build();
        String issuer = "https://securetoken.google.com/" + project, audience = project;
        nimbus.setJwtValidator(new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer), token ->
                token.getAudience() != null && token.getAudience().contains(audience) ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "wrong audience", null))));
        this.decoder = nimbus;
    }

    @Override public boolean enabled() { return decoder != null || dev; }

    @Override public String verify(String proof) {
        if (proof == null || proof.isBlank()) throw new IllegalArgumentException("no proof");
        if (dev && proof.startsWith("dev:")) return proof.substring(4);
        if (decoder == null) throw new IllegalStateException("phone check is off");
        Jwt token = decoder.decode(proof);
        Object firebase = token.getClaims().get("firebase");
        Object provider = firebase instanceof Map<?, ?> map ? map.get("sign_in_provider") : null;
        String phone = token.getClaimAsString("phone_number");
        if (!"phone".equals(provider) || phone == null) throw new IllegalArgumentException("not a phone sign-in");
        return phone;
    }

}
