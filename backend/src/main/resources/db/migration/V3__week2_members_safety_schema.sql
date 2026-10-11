-- Week 2 confirmed schema. These are tables and constraints only.
-- Signup, institution approval, notifications, reports, appeals and sanctions services are NOT implemented yet.

-- Members: general/institution type, birth date for the under-14 signup limit, ADMIN is never an institution.
ALTER TABLE users
    ADD COLUMN member_type VARCHAR(20) NOT NULL DEFAULT 'GENERAL' AFTER role,
    ADD COLUMN birth_date DATE NULL AFTER member_type,
    ADD CONSTRAINT ck_user_member_type CHECK (member_type IN ('GENERAL', 'INSTITUTION')),
    ADD CONSTRAINT ck_user_admin_general CHECK (role <> 'ADMIN' OR member_type = 'GENERAL'),
    ADD CONSTRAINT ck_user_birth_date CHECK (role = 'ADMIN' OR (birth_date IS NOT NULL AND birth_date >= '1900-01-01'));

CREATE TABLE organizations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    manager_user_id BIGINT NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    contact VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reviewed_by BIGINT,
    reviewed_at DATETIME,
    reject_reason VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_org_manager FOREIGN KEY (manager_user_id) REFERENCES users(id),
    CONSTRAINT fk_org_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
    CONSTRAINT ck_org_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')),
    CONSTRAINT ck_org_reviewed CHECK (status = 'PENDING' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
    CONSTRAINT ck_org_reject_reason CHECK (status <> 'REJECTED' OR (reject_reason IS NOT NULL AND CHAR_LENGTH(TRIM(reject_reason)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_interests (
    user_id BIGINT NOT NULL,
    category_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, category_id),
    CONSTRAINT fk_interest_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_interest_category FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Category base risk and check-in radius from the plan ERD (docs/plan.md 6.6). POINT/spatial index is week 4.
ALTER TABLE categories
    ADD COLUMN base_risk VARCHAR(20) NOT NULL DEFAULT 'LOW',
    ADD CONSTRAINT ck_category_base_risk CHECK (base_risk IN ('LOW', 'REVIEW'));
UPDATE categories SET base_risk = 'REVIEW' WHERE name = '지역 돌봄';
ALTER TABLE activity_locations
    ADD COLUMN checkin_radius_m INT NOT NULL DEFAULT 200,
    ADD CONSTRAINT ck_checkin_radius CHECK (checkin_radius_m BETWEEN 50 AND 500);

-- Activities: self-organized (GENERAL) or institution-hosted (INSTITUTION, requires an organization).
ALTER TABLE activities
    ADD COLUMN activity_type VARCHAR(20) NOT NULL DEFAULT 'GENERAL' AFTER category_id,
    ADD COLUMN organization_id BIGINT NULL AFTER activity_type,
    ADD CONSTRAINT fk_activity_organization FOREIGN KEY (organization_id) REFERENCES organizations(id),
    ADD CONSTRAINT ck_activity_type CHECK (activity_type IN ('GENERAL', 'INSTITUTION')),
    ADD CONSTRAINT ck_activity_type_org CHECK ((activity_type = 'GENERAL' AND organization_id IS NULL)
        OR (activity_type = 'INSTITUTION' AND organization_id IS NOT NULL));

-- Participation: organizer rejection is a final state (no re-apply); cancellation keeps the same row.
ALTER TABLE participations
    DROP CHECK ck_participation_status,
    ADD CONSTRAINT ck_participation_status CHECK (status IN ('APPLIED', 'CONFIRMED', 'REJECTED', 'WAITLISTED', 'OFFERED', 'EXPIRED',
        'CANCELLED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'HELD', 'INVALIDATED')),
    ADD CONSTRAINT ck_wait_order CHECK (wait_order IS NULL OR wait_order > 0);

-- Status change record for activity/participation already exists (activity_logs). Admin decisions on other targets:
CREATE TABLE admin_actions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    admin_id BIGINT NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_id BIGINT NOT NULL,
    action VARCHAR(30) NOT NULL,
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    reason VARCHAR(500) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_admin_action_admin FOREIGN KEY (admin_id) REFERENCES users(id),
    CONSTRAINT ck_admin_action_target CHECK (target_type IN ('ORGANIZATION', 'ACTIVITY', 'REPORT', 'APPEAL', 'USER')),
    CONSTRAINT ck_admin_action_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- In-app notifications only (no SMS/e-mail/push).
CREATE TABLE notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(100) NOT NULL,
    body VARCHAR(500) NOT NULL,
    link_path VARCHAR(255),
    read_at DATETIME,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT ck_notification_type CHECK (type IN ('APPLICATION_RESULT', 'WAITLIST_OFFER', 'ACTIVITY_CHANGED', 'ACTIVITY_REMINDER',
        'RECORD_CONFIRMED', 'REPORT_RESULT', 'ORGANIZATION_REVIEW', 'SANCTION')),
    INDEX ix_notification_user_unread (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reports (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    reporter_id BIGINT NOT NULL,
    activity_id BIGINT NOT NULL,
    target_user_id BIGINT,
    reason_type VARCHAR(20) NOT NULL,
    description VARCHAR(1000) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    handled_by BIGINT,
    handled_at DATETIME,
    result_note VARCHAR(500),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id) REFERENCES users(id),
    CONSTRAINT fk_report_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
    CONSTRAINT fk_report_target FOREIGN KEY (target_user_id) REFERENCES users(id),
    CONSTRAINT fk_report_handler FOREIGN KEY (handled_by) REFERENCES users(id),
    CONSTRAINT ck_report_reason CHECK (reason_type IN ('SAFETY', 'FALSE_RECORD', 'HARASSMENT', 'INAPPROPRIATE', 'OTHER')),
    CONSTRAINT ck_report_status CHECK (status IN ('RECEIVED', 'REVIEWING', 'ACTION_TAKEN', 'DISMISSED')),
    CONSTRAINT ck_report_description CHECK (CHAR_LENGTH(TRIM(description)) >= 10),
    CONSTRAINT ck_report_handled CHECK (status IN ('RECEIVED', 'REVIEWING')
        OR (handled_by IS NOT NULL AND handled_at IS NOT NULL AND result_note IS NOT NULL AND CHAR_LENGTH(TRIM(result_note)) > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Evidence files live in a private S3 bucket; only the object key and metadata are stored here.
CREATE TABLE report_evidences (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    report_id BIGINT NOT NULL,
    storage_key VARCHAR(512) NOT NULL UNIQUE,
    content_type VARCHAR(50) NOT NULL,
    size_bytes INT NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_evidence_report FOREIGN KEY (report_id) REFERENCES reports(id),
    CONSTRAINT ck_evidence_type CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    CONSTRAINT ck_evidence_size CHECK (size_bytes BETWEEN 1 AND 10485760)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Appeals against a completion record must be submitted within 7 days (deadline_at = record confirmed_at + 7 days, set by the service).
CREATE TABLE appeals (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    record_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
    submitted_at DATETIME NOT NULL,
    deadline_at DATETIME NOT NULL,
    handled_by BIGINT,
    handled_at DATETIME,
    result_note VARCHAR(500),
    CONSTRAINT uq_appeal_record_user UNIQUE (record_id, user_id),
    CONSTRAINT fk_appeal_record FOREIGN KEY (record_id) REFERENCES activity_records(id),
    CONSTRAINT fk_appeal_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_appeal_handler FOREIGN KEY (handled_by) REFERENCES users(id),
    CONSTRAINT ck_appeal_status CHECK (status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED')),
    CONSTRAINT ck_appeal_deadline CHECK (submitted_at <= deadline_at),
    CONSTRAINT ck_appeal_reason CHECK (CHAR_LENGTH(TRIM(reason)) >= 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sanctions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    type VARCHAR(20) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    report_id BIGINT,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sanction_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_sanction_report FOREIGN KEY (report_id) REFERENCES reports(id),
    CONSTRAINT fk_sanction_admin FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT ck_sanction_type CHECK (type IN ('WARNING', 'RESTRICTION', 'SUSPENSION')),
    CONSTRAINT ck_sanction_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0),
    CONSTRAINT ck_sanction_period CHECK (ends_at IS NULL OR ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Draft risk keywords based on docs/plan.md 6.7 (BLOCKED: medical, electric/gas, height, underwater, fundraising;
-- REVIEW: seniors/children, animals, facility interiors, ending after sunset). The classifier service is week 3; matching here does not prove an activity is safe.
CREATE TABLE risk_keywords (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    keyword VARCHAR(50) NOT NULL UNIQUE,
    risk_level VARCHAR(20) NOT NULL,
    reason VARCHAR(200) NOT NULL,
    CONSTRAINT ck_risk_keyword_level CHECK (risk_level IN ('REVIEW', 'BLOCKED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO risk_keywords (keyword, risk_level, reason) VALUES
    ('사다리', 'BLOCKED', '높은 곳 작업'),
    ('고소작업', 'BLOCKED', '높은 곳 작업'),
    ('지붕', 'BLOCKED', '높은 곳 작업'),
    ('전기 작업', 'BLOCKED', '전기·가스 작업'),
    ('가스 작업', 'BLOCKED', '전기·가스 작업'),
    ('전기톱', 'BLOCKED', '위험 장비'),
    ('예초기', 'BLOCKED', '위험 장비'),
    ('농약', 'BLOCKED', '화학물질'),
    ('화학약품', 'BLOCKED', '화학물질'),
    ('입수', 'BLOCKED', '물속 작업'),
    ('의료', 'BLOCKED', '의료행위'),
    ('주사', 'BLOCKED', '의료행위'),
    ('모금', 'BLOCKED', '금전 모금'),
    ('후원금', 'BLOCKED', '금전 모금'),
    ('음주', 'BLOCKED', '안전·운영 원칙'),
    ('어르신', 'REVIEW', '취약 대상'),
    ('어린이', 'REVIEW', '취약 대상'),
    ('아동', 'REVIEW', '취약 대상'),
    ('동물', 'REVIEW', '동물 관련 활동'),
    ('시설', 'REVIEW', '시설 내부 활동'),
    ('가정 방문', 'REVIEW', '비공개 장소'),
    ('야간', 'REVIEW', '일몰 이후 종료'),
    ('일몰', 'REVIEW', '일몰 이후 종료'),
    ('차도', 'REVIEW', '교통 위험'),
    ('운전', 'REVIEW', '차량 이동'),
    ('하천', 'REVIEW', '물가 위험'),
    ('등산', 'REVIEW', '산행 위험'),
    ('낫', 'REVIEW', '날붙이 도구'),
    ('칼', 'REVIEW', '날붙이 도구'),
    ('조리', 'REVIEW', '화기·위생'),
    ('무거운', 'REVIEW', '부상 위험'),
    ('공사', 'REVIEW', '공사 구역');

-- Demo data: activity type on templates and two institution scenarios. Still NOT login accounts.
ALTER TABLE demo_activity_templates
    ADD COLUMN activity_type VARCHAR(20) NOT NULL DEFAULT 'GENERAL',
    ADD CONSTRAINT ck_demo_activity_type CHECK (activity_type IN ('GENERAL', 'INSTITUTION'));

ALTER TABLE demo_personas
    DROP CHECK ck_demo_persona_role,
    ADD COLUMN scenario VARCHAR(100) NOT NULL DEFAULT '',
    ADD CONSTRAINT ck_demo_persona_role CHECK (persona_role IN ('ORGANIZER', 'PARTICIPANT', 'INSTITUTION', 'ADMIN'));
UPDATE demo_personas SET scenario = '자율 활동 개설·승인·출석 처리' WHERE persona_role = 'ORGANIZER';
UPDATE demo_personas SET scenario = '신청·대기·출석·완료 기록' WHERE persona_role = 'PARTICIPANT';
UPDATE demo_personas SET scenario = '위험 검토·기관 승인·신고 처리' WHERE persona_role = 'ADMIN';
INSERT INTO demo_personas (code, display_name, persona_role, scenario) VALUES
    ('institution-01', '기관 담당자 01', 'INSTITUTION', '기관 승인 완료 · 기관 주관 활동 개설'),
    ('institution-02', '기관 담당자 02', 'INSTITUTION', '기관 승인 대기 · 주관 활동 개설 불가');
