-- 4주차 보완 (2026-10-21): places chosen from Kakao search, a meeting point per activity, and a cache for 1365 programs.
-- Numbered 5.1 so it runs after V5 and before the week 5-7 migrations (V6-V8) that are merged later.

-- New places are added by the server when an activity is created at a searched place; existing ids 1-3 stay.
-- Changing the column only adds AUTO_INCREMENT (same type); the foreign keys that point here are unaffected.
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE demo_places MODIFY id BIGINT NOT NULL AUTO_INCREMENT;
SET FOREIGN_KEY_CHECKS = 1;

-- CURATED = the three places entered by an admin. KAKAO = picked from Kakao search; the server signed the result,
-- so name/address/coordinate/category cannot be edited by the browser. place_class is the server's classification
-- from the Kakao category: OPEN (park, cafe, library ...) publishes as usual, REVIEW (hospital, care home, pets,
-- schools ...) sends the activity to an admin. BLOCKED places (gas station, bar ...) are refused and never stored.
ALTER TABLE demo_places
    ADD COLUMN source VARCHAR(10) NOT NULL DEFAULT 'CURATED',
    ADD COLUMN kakao_place_id VARCHAR(20) NULL,
    ADD COLUMN category_name VARCHAR(200) NULL,
    ADD COLUMN place_class VARCHAR(10) NOT NULL DEFAULT 'OPEN',
    ADD UNIQUE KEY uk_place_kakao (kakao_place_id),
    ADD CONSTRAINT ck_place_source CHECK (source IN ('CURATED', 'KAKAO')),
    ADD CONSTRAINT ck_place_class CHECK (place_class IN ('OPEN', 'REVIEW'));

-- Where to meet inside the place (e.g. "정문 안내판 앞"). Optional.
ALTER TABLE activities ADD COLUMN meeting_point VARCHAR(100) NULL AFTER place_id;

-- 1365 programs (행정안전부 봉사참여정보서비스) shown next to our activities. Only public program fields are kept:
-- the API also returns the person in charge, phone, fax, address and e-mail, which are never stored or shown.
-- latitude/longitude come from a Kakao lookup of the place text (the API has no coordinates); NULL = not found.
CREATE TABLE volunteer_programs (
    program_no VARCHAR(20) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    organization VARCHAR(255) NULL,
    place VARCHAR(255) NULL,
    field VARCHAR(100) NULL,
    period_start VARCHAR(8) NULL,
    period_end VARCHAR(8) NULL,
    begin_time VARCHAR(5) NULL,
    end_time VARCHAR(5) NULL,
    weekdays VARCHAR(20) NULL,
    recruit_status VARCHAR(10) NULL,
    recruit_end VARCHAR(8) NULL,
    capacity INT NULL,
    youth_ok BOOLEAN NULL,
    adult_ok BOOLEAN NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    fetched_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
