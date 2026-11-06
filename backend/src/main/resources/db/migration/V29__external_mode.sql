-- 2026-11-06: how the person keeps their 1365 activities, chosen once right after signup (changeable in 설정):
-- IMPORT = 1365 화면에서 가져오기 (lab), MANUAL = 직접 남기기 (참여했나요? → 실적확인서). NULL = not chosen yet.
ALTER TABLE users
    ADD COLUMN ext_mode VARCHAR(8) NULL,
    ADD CONSTRAINT ck_user_ext_mode CHECK (ext_mode IS NULL OR ext_mode IN ('IMPORT', 'MANUAL'));

-- When a new 1365 total shows more activities than the last one, that many past 1365 records still waiting are marked
-- "실적 반영됨(추정)": a guess from the count, not a match with 1365 itself.
ALTER TABLE external_records ADD COLUMN reflected_at DATETIME NULL AFTER cert_at;

-- "1365 실적 새로고침해 볼까요?": a few days after a 1365 activity, and once a month when the last import is old.
ALTER TABLE notifications DROP CHECK ck_notification_type;
ALTER TABLE notifications
    ADD CONSTRAINT ck_notification_type CHECK (type IN (
        'APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED', 'WAITLISTED', 'OFFERED', 'OFFER_EXPIRED', 'WAITLIST_CLOSED', 'OFFER_ACCEPTED',
        'START_EXPIRED', 'PENDING_REMINDER', 'RESCHEDULED', 'ACTIVITY_CANCELLED', 'DAY_BEFORE', 'DAY_OF', 'CHECKIN_OPEN', 'QR_TIME',
        'FINISHED', 'CHECKED_IN', 'RECORD_CONFIRMED', 'REVIEW_INVITE', 'LATE', 'NOTICE', 'QUESTION', 'ANSWER', 'COMMUNITY_COMMENT',
        'APPLICATION_RESULT', 'WAITLIST_OFFER', 'ACTIVITY_CHANGED', 'ACTIVITY_REMINDER', 'REPORT_RESULT', 'ORGANIZATION_REVIEW', 'SANCTION',
        'EXT_DAY_BEFORE', 'EXT_CHECK', 'EXT_REFRESH'));
