-- Account withdrawal (2026-11-05, user decision). A withdrawn member keeps its row (activities, records and posts point
-- to it) but loses everything that identifies the person: e-mail, name, birth date, nickname, interests, saved
-- activities, notifications, notification settings and social links are cleared or deleted by the service. Posts
-- and comments stay and show "탈퇴한 회원". Withdrawal is refused while the member hosts an activity that still has
-- applicants (cancel it first); the member's own pending applications are cancelled first.
ALTER TABLE users
    DROP CHECK ck_user_status,
    ADD CONSTRAINT ck_user_status CHECK (status IN ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'WITHDRAWN')),
    ADD COLUMN withdrawn_at DATETIME NULL;

-- What a withdrawal did (counts only, no personal data), for checking a complaint later.
CREATE TABLE account_withdrawals (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL UNIQUE,
    providers VARCHAR(40) NOT NULL,
    cancelled_applications INT NOT NULL,
    closed_activities INT NOT NULL,
    unlinked VARCHAR(40) NULL,
    withdrawn_at DATETIME NOT NULL,
    CONSTRAINT fk_withdrawal_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
