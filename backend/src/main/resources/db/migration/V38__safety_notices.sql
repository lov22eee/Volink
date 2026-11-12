-- 2026-11-12 (user decision): when a report is accepted or no-shows add up, the person sees one warning sheet the next time
-- the app opens (신고 1·2·3회, 불참 2·3회) and has to tick "확인했어요". One row per warning; acked_at is set when they confirm.
-- The sanction / report / participation it is about are kept as plain ids (rows can be revoked or removed later).
CREATE TABLE safety_notices (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    kind VARCHAR(10) NOT NULL,
    step TINYINT NOT NULL,
    sanction_id BIGINT NULL,
    report_id BIGINT NULL,
    participation_id BIGINT NULL,
    created_at DATETIME NOT NULL,
    acked_at DATETIME NULL,
    CONSTRAINT fk_safety_notice_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT ck_safety_notice_kind CHECK (kind IN ('REPORT', 'NOSHOW')),
    CONSTRAINT ck_safety_notice_step CHECK (step BETWEEN 1 AND 3),
    INDEX ix_safety_notice_open (user_id, acked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
