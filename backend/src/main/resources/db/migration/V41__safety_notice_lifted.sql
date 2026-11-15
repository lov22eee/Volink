-- 2026-11-15 (user decision): when an appeal lifts a limit, the person sees one "제한이 풀렸어요" sheet in the app.
-- It reuses safety_notices with kind LIFTED (sanction_id = the lifted sanction, participation_id = the cleared no-show).
ALTER TABLE safety_notices DROP CHECK ck_safety_notice_kind;
ALTER TABLE safety_notices ADD CONSTRAINT ck_safety_notice_kind CHECK (kind IN ('REPORT', 'NOSHOW', 'LIFTED'));
