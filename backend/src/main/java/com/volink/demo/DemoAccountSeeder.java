package com.volink.demo;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Local/demo environment only (dev profile): turns the 11 demo_personas into login accounts
 * ({code}@demo.volink.kr) with the password from the ignored .env (DEMO_ACCOUNT_PASSWORD).
 * No password is ever committed. institution-01 is approved, institution-02 stays pending.
 */
@Component
@Profile("dev")
public class DemoAccountSeeder implements ApplicationRunner {
    public static final String DOMAIN = "@demo.volink.kr";
    private static final Logger log = LoggerFactory.getLogger(DemoAccountSeeder.class);
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwords;
    private final String password;

    public DemoAccountSeeder(JdbcTemplate jdbc, PasswordEncoder passwords, @Value("${volink.demo.account-password:}") String password) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.password = password;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (password.isBlank()) {
            log.info("DEMO_ACCOUNT_PASSWORD is empty; demo login accounts are not created.");
            return;
        }
        String hash = passwords.encode(password);
        List<Map<String, Object>> personas = jdbc.queryForList("SELECT code, display_name, persona_role FROM demo_personas ORDER BY code");
        for (Map<String, Object> persona : personas) {
            String email = persona.get("code") + DOMAIN;
            if (jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, email) > 0) continue;
            String role = persona.get("persona_role").toString();
            boolean admin = "ADMIN".equals(role);
            jdbc.update("INSERT INTO users(email, display_name, password_hash, role, member_type, birth_date) VALUES (?, ?, ?, ?, ?, ?)",
                    email, persona.get("display_name"), hash, admin ? "ADMIN" : "USER", "INSTITUTION".equals(role) ? "INSTITUTION" : "GENERAL",
                    admin ? null : LocalDate.of(2000, 1, 1));
            if (!admin)
                jdbc.update("INSERT INTO user_interests(user_id, category_id) SELECT u.id, c.id FROM users u, categories c WHERE u.email = ? AND c.name = '환경 정화'", email);
        }
        Long adminId = jdbc.queryForList("SELECT id FROM users WHERE email = ?", Long.class, "admin-01" + DOMAIN).stream().findFirst().orElse(null);
        organization("institution-01", "시연 기관 01", adminId, true);
        organization("institution-02", "시연 기관 02", adminId, false);
        log.info("Demo login accounts are ready for {} personas (local demo environment only).", personas.size());
    }

    private void organization(String code, String name, Long adminId, boolean approved) {
        Long manager = jdbc.queryForList("SELECT id FROM users WHERE email = ?", Long.class, code + DOMAIN).stream().findFirst().orElse(null);
        if (manager == null || jdbc.queryForObject("SELECT COUNT(*) FROM organizations WHERE manager_user_id = ?", Integer.class, manager) > 0) return;
        if (approved && adminId != null)
            jdbc.update("INSERT INTO organizations(manager_user_id, name, contact, status, reviewed_by, reviewed_at) VALUES (?, ?, '000-0000-0000', 'APPROVED', ?, NOW())",
                    manager, name, adminId);
        else
            jdbc.update("INSERT INTO organizations(manager_user_id, name, contact) VALUES (?, ?, '000-0000-0000')", manager, name);
    }
}
