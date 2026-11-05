-- Notification center A (2026-11-05): a filter category, the activity a notification is about, one stored copy per
-- event (dedupe_key) and finer types. Existing rows are kept and given the new values from their title and link.

ALTER TABLE notifications
    DROP CHECK ck_notification_type,
    MODIFY type VARCHAR(30) NOT NULL,
    ADD COLUMN category VARCHAR(10) NOT NULL DEFAULT 'OTHER' AFTER type,
    ADD COLUMN activity_id BIGINT NULL AFTER link_path,
    ADD COLUMN dedupe_key VARCHAR(80) NULL AFTER activity_id;

-- Older rows: one broad type → the specific one, by the fixed titles the server wrote.
UPDATE notifications SET type = CASE
        WHEN title = '새 참가 신청' THEN 'APPLIED'
        WHEN title = '참가 취소' THEN 'CANCELLED'
        WHEN title = '대기자 참가 확정' THEN 'OFFER_ACCEPTED'
        WHEN title LIKE '%분 늦어요' THEN 'LATE'
        WHEN title = '새 공지가 올라왔어요' THEN 'NOTICE'
        WHEN title IN ('새 질문이 있어요', '모집자에게만 보이는 질문이 있어요') THEN 'QUESTION'
        WHEN title = '질문에 답변이 달렸어요' THEN 'ANSWER'
        WHEN title = '활동이 취소됐어요' THEN 'ACTIVITY_CANCELLED'
        WHEN title = '활동 일정이 바뀌었어요' THEN 'RESCHEDULED'
        WHEN title = '활동이 끝났습니다' THEN 'FINISHED'
        ELSE type END
    WHERE type = 'ACTIVITY_CHANGED';
UPDATE notifications SET type = CASE
        WHEN title LIKE '승인을 기다리는 신청이%' THEN 'PENDING_REMINDER'
        WHEN title = '내일 함께해요' THEN 'DAY_BEFORE'
        WHEN title = '체크인이 열렸어요' THEN 'CHECKIN_OPEN'
        WHEN title = '출석 QR을 띄울 시간이에요' THEN 'QR_TIME'
        ELSE type END
    WHERE type = 'ACTIVITY_REMINDER';
UPDATE notifications SET type = CASE
        WHEN title = '참가가 확정되었습니다' THEN 'APPROVED'
        WHEN title = '참가 신청이 거절되었습니다' THEN 'REJECTED'
        WHEN title LIKE '대기 %번으로 신청했습니다' THEN 'WAITLISTED'
        WHEN title IN ('승인 전에 활동이 시작됐어요', '자리가 나지 않아 대기가 끝났어요') THEN 'START_EXPIRED'
        ELSE type END
    WHERE type = 'APPLICATION_RESULT';
UPDATE notifications SET type = CASE
        WHEN title = '자리 제안이 만료되었습니다' THEN 'OFFER_EXPIRED'
        WHEN title = '대기가 마감되었습니다' THEN 'WAITLIST_CLOSED'
        WHEN title = '빈자리가 생겼어요' THEN 'OFFERED'
        ELSE type END
    WHERE type = 'WAITLIST_OFFER';

UPDATE notifications SET category = CASE
        WHEN type IN ('APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED', 'WAITLISTED', 'OFFERED', 'OFFER_EXPIRED', 'WAITLIST_CLOSED', 'OFFER_ACCEPTED',
                      'START_EXPIRED', 'PENDING_REMINDER', 'APPLICATION_RESULT', 'WAITLIST_OFFER') THEN 'APPLY'
        WHEN type IN ('RESCHEDULED', 'ACTIVITY_CANCELLED', 'DAY_BEFORE', 'DAY_OF', 'CHECKIN_OPEN', 'QR_TIME', 'FINISHED', 'CHECKED_IN',
                      'RECORD_CONFIRMED', 'REVIEW_INVITE', 'LATE', 'ACTIVITY_REMINDER', 'ACTIVITY_CHANGED') THEN 'ACTIVITY'
        WHEN type IN ('NOTICE', 'QUESTION', 'ANSWER', 'COMMUNITY_COMMENT') THEN 'TALK'
        ELSE 'OTHER' END;

-- The activity from links like #/activity/12 (a link without one stays NULL; a deleted activity is shown as such).
UPDATE notifications SET activity_id = CAST(REGEXP_SUBSTR(link_path, '[0-9]+') AS UNSIGNED)
    WHERE link_path REGEXP '^#/(activity|manage|news|checkin)/[0-9]+';

ALTER TABLE notifications
    ADD CONSTRAINT ck_notification_type CHECK (type IN (
        'APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED', 'WAITLISTED', 'OFFERED', 'OFFER_EXPIRED', 'WAITLIST_CLOSED', 'OFFER_ACCEPTED',
        'START_EXPIRED', 'PENDING_REMINDER', 'RESCHEDULED', 'ACTIVITY_CANCELLED', 'DAY_BEFORE', 'DAY_OF', 'CHECKIN_OPEN', 'QR_TIME',
        'FINISHED', 'CHECKED_IN', 'RECORD_CONFIRMED', 'REVIEW_INVITE', 'LATE', 'NOTICE', 'QUESTION', 'ANSWER', 'COMMUNITY_COMMENT',
        'APPLICATION_RESULT', 'WAITLIST_OFFER', 'ACTIVITY_CHANGED', 'ACTIVITY_REMINDER', 'REPORT_RESULT', 'ORGANIZATION_REVIEW', 'SANCTION')),
    ADD CONSTRAINT ck_notification_category CHECK (category IN ('APPLY', 'ACTIVITY', 'TALK', 'OTHER')),
    -- No foreign key to activities: a notification outlives a deleted activity and says so on the screen.
    ADD UNIQUE KEY uk_notification_dedupe (user_id, dedupe_key),
    ADD INDEX ix_notification_user_id (user_id, id),
    ADD INDEX ix_notification_user_category (user_id, category, id);

-- Phone notification (push) preferences, per person. The in-app list always keeps everything; these apply to push
-- once it is connected. push_on: all phone notifications on/off. Quiet hours (방해 금지): no push between
-- quiet_start and quiet_end (may cross midnight), chosen by the person; asked once after signup.
CREATE TABLE notification_settings (
    user_id BIGINT PRIMARY KEY,
    push_on BOOLEAN NOT NULL DEFAULT TRUE,
    apply_on BOOLEAN NOT NULL DEFAULT TRUE,
    activity_on BOOLEAN NOT NULL DEFAULT TRUE,
    talk_on BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_on BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_start TIME NOT NULL DEFAULT '22:00:00',
    quiet_end TIME NOT NULL DEFAULT '08:00:00',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT ck_notification_quiet CHECK (quiet_start <> quiet_end),
    CONSTRAINT fk_notification_settings_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
