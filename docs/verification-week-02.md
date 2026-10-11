# 2주차 검증 기록 · 2026-10-11

실행 환경: Linux 클라우드 컨테이너, Docker 29.8.2, MySQL 8.4(고정 이미지), Java 21, Node 22.22.0, Playwright Chromium 1194.

| 명령 | 결과 | 확인한 것 |
|---|---|---|
| `./scripts/backend.sh test` | **14 실행 · 14 통과** | V1~V3 적용, 테이블 20개(업무 17 + 시연 3)가 ERD와 일치, 회원·기관·활동 유형·신청 상태·신고·증빙·이의제기·제재·관리자 조치 제약, 기존 1주차 제약 |
| `./scripts/start-dev.sh` → `./scripts/check-dev.sh` | **통과** | Vite → Spring Boot → MySQL, 장소 3·활동 3·시연 계정 정의 11(기관 2), 활동 유형 값, status week 2 |
| `npm run ui:export` | **통과** | 타입 검사·빌드, 단일 HTML 갱신 |
| `npx playwright test` (Chromium 경로 지정) | **12 실행 · 12 통과** | 서비스 화면 9개 시나리오(입력 오류·만 14세·관심 분야·지도 장소 필터·유형 필터·모바일 포함), 오프라인 HTML 1개, 보관 발표 2개 |
| 2주차 요약 HTML 직접 로드 | **통과** | 1280px·390px 가로 넘침 없음, 외부 요청 0건, 캡처 `screenshots/week-02-design.png` |

## 발견·수정

- 칸 아래 오류 문구가 `<label>` 안에 있어 입력칸 이름에 섞여 읽혔습니다. `aria-hidden`으로 이름에서 빼고 `aria-describedby`로 설명으로만 읽히게 고쳤습니다.
- 1주차 화면 테스트가 날짜 `2026-10-11`을 고정해 서버 기준일(오늘+3일)이 바뀌면 실패하는 구조였습니다. API의 `baseDate`를 읽도록 고쳤습니다.
- 처음에는 Docker 데몬이 꺼져 있어 백엔드 테스트가 “Docker 환경 없음”으로 실패했습니다. 데몬을 켠 뒤 다시 실행해 통과했습니다(코드 문제 아님).

## 실행하지 않은 것

- 로그인·가입·개설·신청·체크인 등 업무 API 테스트: 기능이 없어 실행 대상 없음([test-cases.md](test-cases.md) 3주차 이후 목록).
- GitHub Actions 원격 실행·Pages 배포: PR 단계라 main 반영 전입니다. 병합 후 Actions에서 확인합니다.
- 장소 좌표·이용 조건 확인: 현장·관리기관 확인이 필요해 미실행.
