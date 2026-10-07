-- These personas are design fixtures, NOT login accounts. No passwords or tokens are seeded.
INSERT INTO categories (name) VALUES ('환경 정화'), ('생활 지원'), ('지역 돌봄');

CREATE TABLE demo_places (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    area VARCHAR(100) NOT NULL,
    address_note VARCHAR(255) NOT NULL,
    coordinate_status VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO demo_places VALUES
    (1, '옥정중앙공원', '양주 · 옥정동', '경동대학교 메트로폴캠퍼스 주변 후보. 현장·주소·좌표 확인 필요.', 'UNVERIFIED'),
    (2, '독바위공원', '양주 · 옥정 생활권', '공공장소 후보. 이동 거리·활동 허용 여부·좌표 확인 필요.', 'UNVERIFIED'),
    (3, '회암사지 역사공원', '양주 · 회암동', '공공장소 후보. 유적 보호구역 제외·활동 허용 여부·좌표 확인 필요.', 'UNVERIFIED');

CREATE TABLE demo_personas (
    code VARCHAR(30) PRIMARY KEY,
    display_name VARCHAR(40) NOT NULL,
    persona_role VARCHAR(20) NOT NULL,
    CONSTRAINT ck_demo_persona_role CHECK (persona_role IN ('ORGANIZER', 'PARTICIPANT', 'ADMIN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO demo_personas VALUES
    ('organizer-01', '모집자 01', 'ORGANIZER'), ('organizer-02', '모집자 02', 'ORGANIZER'),
    ('participant-01', '참가자 01', 'PARTICIPANT'), ('participant-02', '참가자 02', 'PARTICIPANT'),
    ('participant-03', '참가자 03', 'PARTICIPANT'), ('participant-04', '참가자 04', 'PARTICIPANT'),
    ('participant-05', '참가자 05', 'PARTICIPANT'), ('participant-06', '참가자 06', 'PARTICIPANT'),
    ('admin-01', '관리자 01', 'ADMIN');

CREATE TABLE demo_activity_templates (
    id BIGINT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(500) NOT NULL,
    category_id BIGINT NOT NULL,
    place_id BIGINT NOT NULL,
    start_time VARCHAR(5) NOT NULL,
    duration_minutes INT NOT NULL,
    capacity INT NOT NULL,
    example_confirmed INT NOT NULL,
    CONSTRAINT fk_demo_category FOREIGN KEY (category_id) REFERENCES categories(id),
    CONSTRAINT fk_demo_place FOREIGN KEY (place_id) REFERENCES demo_places(id),
    CONSTRAINT ck_demo_capacity CHECK (capacity BETWEEN 2 AND 10),
    CONSTRAINT ck_demo_duration CHECK (duration_minutes BETWEEN 1 AND 180),
    CONSTRAINT ck_demo_confirmed CHECK (example_confirmed BETWEEN 0 AND capacity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO demo_activity_templates VALUES
    (1, '공원에서 시작하는 작은 변화', '함께 산책하며 공원 주변의 가벼운 쓰레기를 정리하는 활동 시안입니다.', 1, 1, '10:00', 90, 6, 3),
    (2, '우리 동네, 가벼운 플로깅', '공개된 산책로에서 짧게 걷고 주변을 정리하는 활동 시안입니다.', 1, 2, '14:00', 60, 8, 5),
    (3, '깨끗한 공원 함께 만들기', '유적 보호구역 밖의 허용된 공원 구역에서 진행할 환경 정화 시안입니다.', 1, 3, '11:00', 120, 4, 2);
