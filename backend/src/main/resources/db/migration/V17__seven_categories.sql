-- 7 categories for the whole service (2026-11-05, user decision B): 환경 · 교육 · 복지 · 문화·예술 · 동물 · 지역사회 · 기타.
-- Old → new: 환경 정화 → 환경, 생활 지원 → 복지, 지역 돌봄 → 복지. Nothing is deleted except user_interests rows that
-- are copied to 복지 first (a person may have had both 생활 지원 and 지역 돌봄). Every changed row is written to
-- category_changes_v17 with its old category, so the change can be checked or undone (rollback notes in docs/rules.md).

CREATE TABLE category_changes_v17 (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    table_name VARCHAR(40) NOT NULL,
    row_key VARCHAR(60) NOT NULL,
    old_category VARCHAR(50) NOT NULL,
    new_category VARCHAR(50) NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE categories
    ADD COLUMN sort_order INT NOT NULL DEFAULT 99,
    ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN legacy_name VARCHAR(50) NULL;

-- Originals first.
INSERT INTO category_changes_v17(table_name, row_key, old_category, new_category)
    SELECT 'activities', a.id, c.name, CASE c.name WHEN '환경 정화' THEN '환경' ELSE '복지' END
    FROM activities a JOIN categories c ON c.id = a.category_id WHERE c.name IN ('환경 정화', '생활 지원', '지역 돌봄');
INSERT INTO category_changes_v17(table_name, row_key, old_category, new_category)
    SELECT 'demo_activity_templates', t.id, c.name, CASE c.name WHEN '환경 정화' THEN '환경' ELSE '복지' END
    FROM demo_activity_templates t JOIN categories c ON c.id = t.category_id WHERE c.name IN ('환경 정화', '생활 지원', '지역 돌봄');
INSERT INTO category_changes_v17(table_name, row_key, old_category, new_category)
    SELECT 'user_interests', i.user_id, c.name, CASE c.name WHEN '환경 정화' THEN '환경' ELSE '복지' END
    FROM user_interests i JOIN categories c ON c.id = i.category_id WHERE c.name IN ('환경 정화', '생활 지원', '지역 돌봄');

-- Rename in place (ids and links stay).
UPDATE categories SET legacy_name = name, name = '환경', sort_order = 1 WHERE name = '환경 정화';
UPDATE categories SET legacy_name = name, name = '복지', sort_order = 3 WHERE name = '지역 돌봄';

-- 생활 지원 → 복지: move every reference, then keep the old row as inactive history (never offered again).
SET @welfare = (SELECT id FROM categories WHERE name = '복지');
SET @life = (SELECT id FROM categories WHERE name = '생활 지원');
UPDATE activities SET category_id = @welfare WHERE category_id = @life;
UPDATE demo_activity_templates SET category_id = @welfare WHERE category_id = @life;
INSERT IGNORE INTO user_interests(user_id, category_id) SELECT user_id, @welfare FROM user_interests WHERE category_id = @life;
DELETE FROM user_interests WHERE category_id = @life;
UPDATE categories SET legacy_name = name, name = '생활 지원(복지로 통합)', active = FALSE, sort_order = 999 WHERE id = @life;

INSERT INTO categories(name, sort_order) VALUES ('교육', 2), ('문화·예술', 4), ('동물', 5), ('지역사회', 6), ('기타', 7);

-- User decision (2026-11-05): 복지 (was 지역 돌봄, REVIEW), animal work and posts mentioning 어르신 are published at
-- once; only the remaining risk keywords and after-sunset ends still need an admin review.
UPDATE categories SET base_risk = 'LOW' WHERE name = '복지';
-- The two keyword rows are kept in risk_keywords_removed_v17 so they can be put back.
CREATE TABLE risk_keywords_removed_v17 (
    keyword VARCHAR(50) PRIMARY KEY,
    risk_level VARCHAR(20) NOT NULL,
    reason VARCHAR(200) NOT NULL,
    removed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO risk_keywords_removed_v17(keyword, risk_level, reason) SELECT keyword, risk_level, reason FROM risk_keywords WHERE keyword IN ('동물', '어르신');
DELETE FROM risk_keywords WHERE keyword IN ('동물', '어르신');
