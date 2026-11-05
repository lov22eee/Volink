-- Phone push (Firebase Cloud Messaging, 2026-11-05 user decision). One row per installed app: the token Firebase gives
-- the phone. A token belongs to one member at a time (signing in as someone else on the same phone moves it); tokens
-- Firebase reports as gone are deleted. No phone number or device data is stored.
CREATE TABLE push_tokens (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    token VARCHAR(512) NOT NULL,
    platform VARCHAR(10) NOT NULL DEFAULT 'ANDROID',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_push_token UNIQUE (token),
    CONSTRAINT ck_push_platform CHECK (platform IN ('ANDROID', 'IOS', 'WEB')),
    CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_push_user ON push_tokens(user_id);
