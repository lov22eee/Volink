-- Community 봉사 홍보 (2026-11-06, user request): an organizer introduces one of their own recruiting activities in the
-- community; the post carries the live activity card with 바로 신청하기 (applying stays in the activity, with its rules).
ALTER TABLE community_posts
    DROP CHECK ck_community_category,
    DROP CHECK ck_community_review,
    ADD CONSTRAINT ck_community_category CHECK (category IN ('FREE', 'QUESTION', 'REVIEW', 'PROMO')),
    ADD CONSTRAINT ck_community_activity CHECK ((category IN ('REVIEW', 'PROMO')) = (activity_id IS NOT NULL));
