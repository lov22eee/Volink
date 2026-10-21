-- 4주차 보완 2 (2026-10-21). Numbered 5.2: after V5.1 (already on the server) and before the week 5-7 migrations.

-- "전기 배관 작업" passed because only "전기 작업" (with a space) was listed. Matching now ignores spaces
-- (RiskClassifier) and these words are added. 전기·가스 alone go to an admin; the work words are refused.
INSERT INTO risk_keywords (keyword, risk_level, reason) VALUES
    ('배관', 'BLOCKED', '전기·가스 작업'),
    ('전선', 'BLOCKED', '전기·가스 작업'),
    ('고압', 'BLOCKED', '전기·가스 작업'),
    ('용접', 'BLOCKED', '위험 장비'),
    ('전기', 'REVIEW', '전기 관련 활동'),
    ('가스', 'REVIEW', '가스 관련 활동');

-- An organizer can delete an activity nobody has applied to. It is kept (logs point to it) but hidden everywhere.
ALTER TABLE activities
    DROP CHECK ck_activity_status,
    ADD CONSTRAINT ck_activity_status CHECK (status IN ('DRAFT', 'RECRUITING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED', 'HELD', 'DELETED'));
