-- 2026-11-06: 기관 담당자 accounts no longer give a birth date (collect only what is used; the organization is confirmed
-- by an admin). Personal members still must (14+ is checked by the server). Existing rows are kept as they are.
ALTER TABLE users DROP CHECK ck_user_birth_date;
ALTER TABLE users ADD CONSTRAINT ck_user_birth_date
    CHECK (role = 'ADMIN' OR member_type = 'INSTITUTION' OR (birth_date IS NOT NULL AND birth_date >= '1900-01-01'));
