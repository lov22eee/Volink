-- Week 4: place coordinates entered by an admin, and a spatial index for radius search.
-- Coordinates are NOT guessed in this migration: an admin enters them (Kakao map "좌표 복사") and the
-- status becomes ENTERED. Site access/permission is still unverified until someone checks it on location.
ALTER TABLE demo_places
    ADD COLUMN meeting_point VARCHAR(255) NULL AFTER address_note,
    ADD COLUMN latitude DECIMAL(10,7) NULL AFTER meeting_point,
    ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude,
    ADD COLUMN coordinates_updated_by BIGINT NULL,
    ADD COLUMN coordinates_updated_at DATETIME NULL,
    ADD CONSTRAINT fk_place_coordinates_admin FOREIGN KEY (coordinates_updated_by) REFERENCES users(id),
    ADD CONSTRAINT ck_place_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
    ADD CONSTRAINT ck_place_latitude_korea CHECK (latitude IS NULL OR latitude BETWEEN 33 AND 39),
    ADD CONSTRAINT ck_place_longitude_korea CHECK (longitude IS NULL OR longitude BETWEEN 124 AND 132);

-- One location row per activity that has a coordinate (copied from its place). SRID 4326 = WGS84 (GPS/Kakao).
-- A spatial index needs a NOT NULL geometry with a fixed SRID; the table has been empty until now.
ALTER TABLE activity_locations
    ADD COLUMN location POINT NOT NULL SRID 4326,
    ADD SPATIAL INDEX sx_activity_location (location);

-- Admin place edits are recorded like every other admin action.
ALTER TABLE admin_actions
    DROP CHECK ck_admin_action_target,
    ADD CONSTRAINT ck_admin_action_target CHECK (target_type IN ('ORGANIZATION', 'ACTIVITY', 'REPORT', 'APPEAL', 'USER', 'PLACE'));
