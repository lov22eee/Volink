-- Week 5: participation workflow. The (activity_id, user_id) UNIQUE row from V1 is reused for re-application.
-- cancel_count: one re-application is allowed after the first cancellation (docs/architecture.md).
ALTER TABLE participations
    ADD COLUMN cancel_count TINYINT NOT NULL DEFAULT 0 AFTER offer_expires_at,
    ADD COLUMN updated_at DATETIME NULL AFTER created_at,
    ADD INDEX ix_participation_activity_status (activity_id, status),
    ADD INDEX ix_participation_offer_due (status, offer_expires_at);
