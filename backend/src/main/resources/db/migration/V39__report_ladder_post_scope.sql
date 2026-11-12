-- 2026-11-12 (user decision): a report is about what someone did in the community, so its limits stay in the community and
-- 봉사 신청·참여 always stays open. New scope POST = 글·댓글 and 모집글 (from the 3rd accepted report); WRITE stays
-- 글·댓글 only (the 2nd). Ladder within a year: 1 경고 · 2 24시간 · 3 7일 · 4 14일 · 5 30일 · 6+ 30일 and an admin
-- decides whether to stop community use without an end (SUSPENSION, scope POST, ends_at NULL).
ALTER TABLE sanctions
    DROP CHECK ck_sanction_scope,
    ADD CONSTRAINT ck_sanction_scope CHECK (scope IN ('APPLY', 'WRITE', 'POST', 'ALL', 'NONE'));
