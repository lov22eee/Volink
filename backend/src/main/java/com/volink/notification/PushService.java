package com.volink.notification;

import java.time.Clock;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Phone push for a saved in-app notification: only after the saving transaction commits (a rolled-back action sends
 * nothing), only when the person's settings allow it now (all on, the category on, outside quiet hours), and off the
 * request thread. Tokens Firebase reports as gone are deleted. Without a Firebase key nothing is sent.
 */
@Service
public class PushService {
    private static final ExecutorService WORKER = Executors.newFixedThreadPool(2, runnable -> {
        Thread thread = new Thread(runnable, "volink-push");
        thread.setDaemon(true);
        return thread;
    });

    private final JdbcTemplate jdbc;
    private final PushSender sender;
    private final Clock clock;
    private NotificationService notifications;

    public PushService(JdbcTemplate jdbc, PushSender sender, Clock clock) {
        this.jdbc = jdbc;
        this.sender = sender;
        this.clock = clock;
    }

    void attach(NotificationService notifications) {
        this.notifications = notifications;
    }

    /** One installed app's token for this member (moves the token if someone else had it on this phone). */
    public void register(long userId, String rawToken, String rawPlatform) {
        String token = rawToken == null ? "" : rawToken.trim();
        if (token.isEmpty() || token.length() > 512) throw com.volink.common.ApiException.validation(Map.of("token", "알림 토큰이 올바르지 않아요."));
        String platform = "IOS".equals(rawPlatform) || "WEB".equals(rawPlatform) ? rawPlatform : "ANDROID";
        jdbc.update("""
                INSERT INTO push_tokens(user_id, token, platform) VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), last_seen_at = CURRENT_TIMESTAMP
                """, userId, token, platform);
    }

    /** Sign-out on this phone: its token stops receiving this member's notifications. */
    public void unregister(long userId, String token) {
        if (token != null) jdbc.update("DELETE FROM push_tokens WHERE user_id = ? AND token = ?", userId, token.trim());
    }

    void queue(long userId, String category, String title, String body, String link) {
        if (!sender.enabled()) return;
        Runnable job = () -> WORKER.submit(() -> deliver(userId, category, title, body, link));
        if (TransactionSynchronizationManager.isSynchronizationActive())
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { job.run(); }
            });
        else job.run();
    }

    /** Package-visible for tests: the same steps as the worker, on the caller's thread. */
    void deliver(long userId, String category, String title, String body, String link) {
        if (notifications != null && !notifications.pushAllowed(userId, category, LocalDateTime.now(clock).toLocalTime())) return;
        List<String> tokens = jdbc.queryForList("SELECT token FROM push_tokens WHERE user_id = ?", String.class, userId);
        for (String token : tokens)
            if (sender.send(token, title, body, link) == PushSender.Result.GONE)
                jdbc.update("DELETE FROM push_tokens WHERE token = ?", token);
    }
}
