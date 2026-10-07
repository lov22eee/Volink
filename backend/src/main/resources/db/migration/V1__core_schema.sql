-- First-week core schema draft. Authentication and transactional workflows are not implemented yet.
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL UNIQUE,
    display_name VARCHAR(40) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_user_role CHECK (role IN ('USER', 'ADMIN')),
    CONSTRAINT ck_user_status CHECK (status IN ('ACTIVE', 'RESTRICTED', 'SUSPENDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(40) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activities (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    organizer_id BIGINT NOT NULL,
    category_id BIGINT NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    capacity INT NOT NULL,
    risk_level VARCHAR(20) NOT NULL DEFAULT 'REVIEW',
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_activity_organizer FOREIGN KEY (organizer_id) REFERENCES users(id),
    CONSTRAINT fk_activity_category FOREIGN KEY (category_id) REFERENCES categories(id),
    CONSTRAINT ck_capacity CHECK (capacity BETWEEN 2 AND 10),
    CONSTRAINT ck_activity_duration CHECK (ends_at > starts_at AND ends_at <= DATE_ADD(starts_at, INTERVAL 3 HOUR)),
    CONSTRAINT ck_risk_level CHECK (risk_level IN ('LOW', 'REVIEW', 'BLOCKED')),
    CONSTRAINT ck_activity_status CHECK (status IN ('DRAFT', 'RECRUITING', 'IN_PROGRESS', 'FINISHED', 'CANCELLED', 'HELD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activity_locations (
    activity_id BIGINT PRIMARY KEY,
    place_name VARCHAR(100) NOT NULL,
    address VARCHAR(255) NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    CONSTRAINT fk_location_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT ck_latitude CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT ck_longitude CHECK (longitude BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE participations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    activity_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'APPLIED',
    wait_order INT,
    offer_expires_at DATETIME,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_participation UNIQUE (activity_id, user_id),
    CONSTRAINT fk_participation_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT fk_participation_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT ck_participation_status CHECK (status IN ('APPLIED', 'CONFIRMED', 'WAITLISTED', 'OFFERED', 'EXPIRED', 'CANCELLED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'HELD', 'INVALIDATED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE check_ins (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    participation_id BIGINT NOT NULL UNIQUE,
    method VARCHAR(20) NOT NULL,
    within_radius BOOLEAN,
    reason VARCHAR(500),
    checked_by BIGINT NOT NULL,
    checked_at DATETIME NOT NULL,
    CONSTRAINT fk_checkin_participation FOREIGN KEY (participation_id) REFERENCES participations(id),
    CONSTRAINT fk_checkin_actor FOREIGN KEY (checked_by) REFERENCES users(id),
    CONSTRAINT ck_checkin_method CHECK (method IN ('QR', 'MANUAL')),
    CONSTRAINT ck_manual_reason CHECK (method <> 'MANUAL' OR (reason IS NOT NULL AND CHAR_LENGTH(TRIM(reason)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activity_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    participation_id BIGINT NOT NULL UNIQUE,
    check_in_id BIGINT NOT NULL UNIQUE,
    confirmed_by BIGINT NOT NULL,
    confirmed_at DATETIME NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'VALID',
    CONSTRAINT fk_record_participation FOREIGN KEY (participation_id) REFERENCES participations(id),
    CONSTRAINT fk_record_checkin FOREIGN KEY (check_in_id) REFERENCES check_ins(id),
    CONSTRAINT fk_record_actor FOREIGN KEY (confirmed_by) REFERENCES users(id),
    CONSTRAINT ck_record_status CHECK (status IN ('VALID', 'HELD', 'INVALIDATED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE activity_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    activity_id BIGINT NOT NULL,
    participation_id BIGINT,
    actor_id BIGINT NOT NULL,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    reason VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_log_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT fk_log_participation FOREIGN KEY (participation_id) REFERENCES participations(id),
    CONSTRAINT fk_log_actor FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
