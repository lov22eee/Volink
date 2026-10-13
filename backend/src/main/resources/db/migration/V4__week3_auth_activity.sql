-- Week 3: login refresh tokens and activity creation fields.
-- place_id points at the demo place candidates until week 4 adds real address/coordinate input (Kakao).
ALTER TABLE activities
    ADD COLUMN place_id BIGINT NULL AFTER organization_id,
    ADD COLUMN risk_reasons VARCHAR(500) NULL AFTER risk_level,
    ADD COLUMN review_note VARCHAR(500) NULL AFTER status,
    ADD CONSTRAINT fk_activity_place FOREIGN KEY (place_id) REFERENCES demo_places(id),
    ADD INDEX ix_activity_public (status, starts_at);

-- Only the SHA-256 of each refresh token is stored; a used or logged-out token is revoked.
CREATE TABLE refresh_tokens (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX ix_refresh_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
