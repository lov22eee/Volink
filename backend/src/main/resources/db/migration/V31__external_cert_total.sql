-- 2026-11-07: a 1365 자원봉사활동 확인서 may sum a whole period (e.g. 2019-04 ~ 2021-11, 46 hours, 8 times), not one day.
-- Recognised minutes on a certificate can therefore be more than one day (up to 99999 minutes).
ALTER TABLE external_records DROP CHECK ck_external_minutes;
ALTER TABLE external_records ADD CONSTRAINT ck_external_minutes CHECK (cert_minutes IS NULL OR cert_minutes BETWEEN 1 AND 99999);
