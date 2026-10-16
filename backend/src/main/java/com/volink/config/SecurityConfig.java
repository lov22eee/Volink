package com.volink.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.volink.auth.TokenService;
import com.volink.common.ApiErrorHandler;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(10);
    }

    @Bean
    JwtDecoder jwtDecoder(TokenService tokens) {
        return tokens.decoder();
    }

    /**
     * Stateless Bearer tokens. CSRF protection is off because no API trusts a cookie for authorization;
     * the only cookie is the SameSite=Strict refresh token limited to /api/auth.
     */
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, Environment environment, ObjectMapper json) throws Exception {
        boolean development = environment.acceptsProfiles(Profiles.of("dev", "test"));
        JwtAuthenticationConverter roles = new JwtAuthenticationConverter();
        roles.setJwtGrantedAuthoritiesConverter(jwt -> List.of(new SimpleGrantedAuthority("ROLE_" + jwt.getClaimAsString("role"))));
        return http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .formLogin(login -> login.disable())
                .httpBasic(basic -> basic.disable())
                .authorizeHttpRequests(auth -> {
                    auth.requestMatchers(HttpMethod.GET, "/actuator/health").permitAll();
                    auth.requestMatchers(HttpMethod.POST, "/api/auth/signup", "/api/auth/login", "/api/auth/refresh", "/api/auth/logout").permitAll();
                    auth.requestMatchers(HttpMethod.GET, "/api/activities", "/api/activities/*", "/api/activities/*/my-participation", "/api/places", "/api/evidence-files/*").permitAll();
                    if (development) {
                        auth.requestMatchers(HttpMethod.GET, "/api/demo/catalog", "/api/project/status").permitAll();
                    }
                    auth.requestMatchers("/api/admin/**").hasRole("ADMIN");
                    auth.requestMatchers("/api/**").authenticated();
                    auth.anyRequest().denyAll();
                })
                .oauth2ResourceServer(server -> server
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(roles))
                        .authenticationEntryPoint((req, res, ex) -> write(res, HttpStatus.UNAUTHORIZED, json))
                        .accessDeniedHandler((req, res, ex) -> write(res, HttpStatus.FORBIDDEN, json)))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((req, res, ex) -> write(res, HttpStatus.UNAUTHORIZED, json))
                        .accessDeniedHandler((req, res, ex) -> write(res, HttpStatus.FORBIDDEN, json)))
                .build();
    }

    private static void write(HttpServletResponse response, HttpStatus status, ObjectMapper json) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        json.writeValue(response.getOutputStream(), ApiErrorHandler.body(status));
    }
}
