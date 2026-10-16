-- Week 7: reports with evidence files, 7-day appeals, sanctions (manual and no-show), recommendations.
-- A sanction made automatically (no-shows) has no admin: created_by is NULL and the reason says so.
ALTER TABLE sanctions
    MODIFY created_by BIGINT NULL,
    ADD COLUMN lifted_at DATETIME NULL AFTER ends_at,
    ADD INDEX ix_sanction_user_active (user_id, ends_at);
ALTER TABLE reports
    ADD INDEX ix_report_status (status, created_at),
    ADD INDEX ix_report_reporter_time (reporter_id, created_at);
-- The target of a report or an appeal can be held, so admin decisions name what they changed.
ALTER TABLE report_evidences
    ADD COLUMN uploaded_by BIGINT NULL AFTER report_id,
    ADD CONSTRAINT fk_evidence_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id);
