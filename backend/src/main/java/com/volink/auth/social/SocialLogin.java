package com.volink.auth.social;

/** Kakao / Google OAuth (authorization code). Tests replace this with a fake; nothing here is stored. */
public interface SocialLogin {
    /** What the provider tells us about the person. email may be null (Kakao often has none). */
    record Profile(String subject, String email, boolean emailVerified, String name) {}

    boolean enabled(String provider);

    String authorizeUrl(String provider, String redirectUri, String state);

    /** Code → token → profile. Throws when the provider refuses. */
    Profile exchange(String provider, String code, String redirectUri);

    /** Withdrawal: cut the app's link on the provider side. False when it cannot be done (no key, or a provider without it). */
    default boolean unlink(String provider, String subject) { return false; }
}
