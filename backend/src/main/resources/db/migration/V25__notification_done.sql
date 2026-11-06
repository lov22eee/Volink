-- 2026-11-06: an organizer's action notification (새 참가 신청 / 새 질문) shows what became of it
-- (승인 완료 · 거절함 · 답변 완료 …) once it is handled, and counts as read.
-- ref_id: the participation (APPLIED) or the question post (QUESTION) the notification is about.
ALTER TABLE notifications
    ADD COLUMN ref_id BIGINT NULL AFTER activity_id,
    ADD COLUMN done_label VARCHAR(20) NULL AFTER read_at,
    ADD COLUMN done_at DATETIME NULL AFTER done_label;
