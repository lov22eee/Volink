-- 1인 1계정 (2026-11-22, user decision): a personal account is tied to one verified phone number.
-- The number itself is not kept: phone_hash is an HMAC of the E.164 number (server key), unique across accounts, and
-- phone_last4 is only for showing "***-5678" to the owner. Accounts that existed before this change may keep using
-- apply / 모집글 / 글쓰기 without a number until phone_grace_until (2026-11-29 KST end of day); new accounts need it at once.
-- 기관·관리자 accounts are not asked (organizations are checked with documents and an admin).
ALTER TABLE users
    ADD COLUMN phone_hash CHAR(64) NULL,
    ADD COLUMN phone_last4 CHAR(4) NULL,
    ADD COLUMN phone_verified_at DATETIME NULL,
    ADD COLUMN phone_grace_until DATETIME NULL,
    ADD CONSTRAINT uq_users_phone UNIQUE (phone_hash);

UPDATE users SET phone_grace_until = '2026-11-29 23:59:59' WHERE role = 'USER' AND member_type <> 'INSTITUTION' AND status <> 'WITHDRAWN';

-- "제 번호가 아니에요": someone else's account holds the number (a recycled number, a family member). An admin looks at it.
CREATE TABLE phone_disputes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    holder_id BIGINT NOT NULL,
    phone_hash CHAR(64) NOT NULL,
    phone_last4 CHAR(4) NOT NULL,
    note VARCHAR(300) NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    created_at DATETIME NOT NULL,
    handled_by BIGINT NULL,
    handled_at DATETIME NULL,
    result_note VARCHAR(300) NULL,
    CONSTRAINT ck_phone_dispute_status CHECK (status IN ('OPEN', 'MOVED', 'KEPT')),
    CONSTRAINT fk_phone_dispute_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_phone_dispute_holder FOREIGN KEY (holder_id) REFERENCES users(id),
    INDEX ix_phone_dispute_open (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
