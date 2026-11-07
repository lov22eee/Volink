-- 2026-11-07: the list under the 1365 봉사참여 실적 page is read (every 시간인증형 / 활동인증형 row, all periods).
-- Each row is one finished 1365 activity: its recognised minutes (시간인증형; NULL for 활동인증형) and which kind it is.
ALTER TABLE external_records
    ADD COLUMN ext_minutes INT NULL AFTER cert_minutes,
    ADD COLUMN ext_kind VARCHAR(10) NULL AFTER ext_minutes,
    ADD CONSTRAINT ck_external_ext_minutes CHECK (ext_minutes IS NULL OR ext_minutes BETWEEN 0 AND 99999),
    ADD CONSTRAINT ck_external_ext_kind CHECK (ext_kind IS NULL OR ext_kind IN ('TIME', 'ACTIVITY'));
