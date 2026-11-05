-- Week 6 (2026-11-05, user request): Kakao and Google login for personal (GENERAL) members on the web and the app.
-- A social login creates only a GENERAL member; institutions keep e-mail signup (PC). One account per provider subject.
-- The provider's e-mail is used only when the provider says it is verified and no account has it yet; otherwise a
-- placeholder that cannot receive mail (…@social.volink.invalid). Social members have no usable password.
CREATE TABLE social_accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    provider VARCHAR(10) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_social_provider CHECK (provider IN ('KAKAO', 'GOOGLE')),
    CONSTRAINT uq_social_subject UNIQUE (provider, subject),
    CONSTRAINT uq_social_user_provider UNIQUE (user_id, provider),
    CONSTRAINT fk_social_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
