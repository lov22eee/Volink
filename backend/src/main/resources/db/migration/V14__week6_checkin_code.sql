-- Week 6 app (2026-11-05, user request): a 4-digit attendance code shown next to the QR (changes with it every 30 s)
-- for people whose camera cannot read the QR. Same checks as the QR (confirmed, time window, 200 m). Wrong codes are
-- logged as CODE_WRONG in activity_logs; 5 in 10 minutes block code entry for that person for a while.
ALTER TABLE check_ins
    DROP CHECK ck_checkin_method,
    ADD CONSTRAINT ck_checkin_method CHECK (method IN ('QR', 'MANUAL', 'CODE'));
