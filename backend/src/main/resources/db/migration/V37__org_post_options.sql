-- 기관 모집글 (2026-11-11): 청소년 참여 가능 여부, 신청할 때 묻는 질문 하나와 그 답, 기관 공개 페이지 소개.
ALTER TABLE activities
    ADD COLUMN youth_ok BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN apply_question VARCHAR(100) NULL;
ALTER TABLE participations ADD COLUMN apply_answer VARCHAR(200) NULL;
ALTER TABLE organizations ADD COLUMN intro VARCHAR(300) NULL;
