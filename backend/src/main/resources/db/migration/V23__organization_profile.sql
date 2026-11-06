-- App 기관회원 가입 (2026-11-06): what kind of organization, where it is, and whether it is a 1365 수요처.
-- All optional for organizations that signed up before (web) and for the web form; the app asks them.
-- Evidence files (S3) for 1365 수요처 come in week 7.
ALTER TABLE organizations
    ADD COLUMN org_type VARCHAR(20) NULL AFTER name,
    ADD COLUMN address VARCHAR(200) NULL AFTER contact,
    ADD COLUMN vms_registered BOOLEAN NULL AFTER address,
    ADD COLUMN vms_code VARCHAR(30) NULL AFTER vms_registered,
    ADD CONSTRAINT ck_org_type CHECK (org_type IS NULL OR org_type IN ('VOLUNTEER_CENTER', 'WELFARE', 'SCHOOL', 'NONPROFIT', 'PUBLIC', 'OTHER'));
