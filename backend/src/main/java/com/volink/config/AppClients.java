package com.volink.config;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Arrays;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * The Android app (Capacitor) runs its bundled pages at https://localhost and calls this server from there.
 * Only those origins may call /api across sites (Bearer token, no cookies), and only they receive the refresh
 * token in the response body instead of the SameSite cookie, which a cross-site app cannot keep.
 * A page on the site itself always sends its own origin, so it keeps the HttpOnly cookie.
 */
@Component
public class AppClients {
    private final List<String> origins;

    public AppClients(@Value("${volink.app.origins:https://localhost}") String origins) {
        this.origins = Arrays.stream(origins.split(",")).map(String::trim).filter(value -> !value.isEmpty()).toList();
    }

    public boolean isApp(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        return origin != null && origins.contains(origin);
    }

    /**
     * CORS rules only for requests from the app's origin. Anything else gets no CORS handling at all (null), so the
     * site's own pages behind nginx or the Vite proxy (where Origin and the forwarded Host can differ) are never refused;
     * a browser on another site still cannot read the answers because no Access-Control-Allow-Origin is sent.
     */
    CorsConfigurationSource cors() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(origins);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        config.setAllowCredentials(false);
        config.setMaxAge(3600L);
        return request -> isApp(request) && request.getRequestURI().startsWith("/api/") ? config : null;
    }
}
