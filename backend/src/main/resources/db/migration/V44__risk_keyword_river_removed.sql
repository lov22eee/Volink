-- 2026-11-26 사용자 결정: '하천'은 하천 주변 산책로·공원 정리처럼 물에 들어가지 않는 활동에도 쓰여 검토 단어에서 뺍니다.
-- 물에 들어가는 활동은 '입수'(등록 불가)로 그대로 막힙니다. 되돌릴 수 있게 V17의 보관 표에 남깁니다.
INSERT INTO risk_keywords_removed_v17(keyword, risk_level, reason) SELECT keyword, risk_level, reason FROM risk_keywords WHERE keyword = '하천';
DELETE FROM risk_keywords WHERE keyword = '하천';
-- 같은 날 규칙이 '일몰 이후 시작만 검토'로 바뀌어, 두 단어의 이유 문구를 맞춥니다.
UPDATE risk_keywords SET reason = '어두울 때 하는 활동' WHERE keyword IN ('야간', '일몰');
