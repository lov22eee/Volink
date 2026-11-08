-- 2026-11-08: the organizer opens attendance on site ([출석 시작], from 30 minutes before the start to 30 minutes before
-- the end). Until then nobody can check in with the QR or code; when it is never opened, the people still confirmed at
-- the end are not marked NO_SHOW ('출석 미확인').
ALTER TABLE activities ADD COLUMN checkin_opened_at DATETIME NULL AFTER ends_at;

-- The organizer hears when an admin approves or rejects a 검토 중 activity (ACTIVITY_REVIEW).
ALTER TABLE notifications DROP CHECK ck_notification_type;
ALTER TABLE notifications
    ADD CONSTRAINT ck_notification_type CHECK (type IN (
        'APPLIED', 'APPROVED', 'REJECTED', 'CANCELLED', 'WAITLISTED', 'OFFERED', 'OFFER_EXPIRED', 'WAITLIST_CLOSED', 'OFFER_ACCEPTED',
        'START_EXPIRED', 'PENDING_REMINDER', 'RESCHEDULED', 'ACTIVITY_CANCELLED', 'DAY_BEFORE', 'DAY_OF', 'CHECKIN_OPEN', 'QR_TIME',
        'FINISHED', 'CHECKED_IN', 'RECORD_CONFIRMED', 'REVIEW_INVITE', 'LATE', 'NOTICE', 'QUESTION', 'ANSWER', 'COMMUNITY_COMMENT',
        'APPLICATION_RESULT', 'WAITLIST_OFFER', 'ACTIVITY_CHANGED', 'ACTIVITY_REMINDER', 'REPORT_RESULT', 'ORGANIZATION_REVIEW', 'SANCTION',
        'EXT_DAY_BEFORE', 'EXT_CHECK', 'EXT_REFRESH', 'ACTIVITY_REVIEW'));
