-- 4주차 보완 7 (2026-10-25): 계획서의 '2~10명 활동'은 모집자 포함 인원.
-- capacity는 모집자를 뺀 참가 정원이므로 새 활동은 서버 규칙으로 1~9명만 받는다(ActivityRules).
-- 이미 저장된 정원 10 활동이 남아 있을 수 있어 DB 제약은 1~10으로 넓히기만 한다.
ALTER TABLE activities DROP CHECK ck_capacity;
ALTER TABLE activities ADD CONSTRAINT ck_capacity CHECK (capacity BETWEEN 1 AND 10);
