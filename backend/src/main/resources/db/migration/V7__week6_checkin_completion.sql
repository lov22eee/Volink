-- Week 6: check-in, completion and no-show. check_ins / activity_records exist since V1; this adds what the
-- scheduler and the record screen need. Coordinates sent at check-in are never stored (only inside/outside).
ALTER TABLE activities
    ADD INDEX ix_activity_status_ends (status, ends_at);
ALTER TABLE activity_records
    ADD INDEX ix_record_confirmed (confirmed_at);
