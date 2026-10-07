# 1주차 검증 기록

실행일: **2026-10-07 (한국 기준)**. 환경: Debian Linux x86_64, Node 24.19.0, JDK 21.0.12.1, Maven 3.9.11, Spring Boot 3.5.16, MySQL 8.4.11, Docker 28.4.0, Compose 2.40.3.

## 통과한 검증

| 검증 | 실제 명령·방법 | 결과 |
|---|---|---|
| 잠금파일 설치 | `frontend/`에서 `npm ci --cache /workspace/.cache/npm` | 성공·잠금파일 기준 설치 |
| 타입 검사·빌드 | `frontend/`에서 `npm run build` | TypeScript + Vite 빌드 성공 |
| 백엔드 통합 | 최상위에서 `./scripts/backend.sh -B test` | **8 실행 · 실패 0 · 오류 0 · 건너뜀 0** |
| 백엔드 패키징 | `./scripts/backend.sh -DskipTests package` | 실행 가능한 JAR 생성 |
| 전체 시작 | `./scripts/start-dev.sh` | MySQL 건강 확인·백엔드·Vite 실행 |
| 기능 요청 | `./scripts/check-dev.sh` | Vite→API→DB, 장소 3·활동 시안 3·페르소나 9 확인 |
| 브라우저 | `frontend/`에서 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | **8 실행 · 8 통과** |
| 재실행 | 실행 중 `start-dev.sh` 및 `check-dev.sh` | 기존 서비스 재사용·중복 시작 없음 |
| 종료·재시작 | `stop-dev.sh`→기존 서버 응답 중지 확인→`start-dev.sh`→`check-dev.sh` | 정상 중지·재시작·데이터 보존 |
| 마이그레이션 반복 | 재시작 후 DB에서 이력·페르소나 수 확인 | 성공 이력 2건·페르소나 9명 유지, 중복 삽입 없음 |
| 설정 반복 | `setup-env.sh`, `install-cloud-jdk.sh` 재실행 | 기존 .env·JDK 보존 |
| 운영 프로필 제한 | 임시 8081 서버 `--spring.profiles.active=prod --server.port=8081` | health 200, 개발 API 두 개 접근 차단, 확인 후 서버 종료 |
| 제외 파일 | `git check-ignore` | .env·.cache·.tools·node_modules·빌드 캐시 제외 확인 |

### MySQL 통합 테스트 8개

1. V1/V2 마이그레이션·분야 3개·실제 사용자 0명 확인.
2. 실제 DB의 장소 3·페르소나 9·활동 시안 3 조회 및 역할별 2/6/1 구성 확인.
3. 건강 확인과 1주차 상태 확인, 인증 구현 여부 false 확인.
4. 보호 API 접근 및 쓰기 요청 차단.
5. 2~10명 밖 정원 거부.
6. 0분 또는 180분 초과 활동 거부, 정확히 180분 허용.
7. 같은 사용자·같은 활동 중복 참가 행 거부.
8. 사유가 공백인 수동 체크인 행 거부, 사유가 있는 행 허용.

이 테스트는 **현재 DB 제약·읽기 API를 검증**합니다. 업무 서비스의 정원 잠금·권한·QR·완료 규칙 테스트를 대신하지 않습니다. Testcontainers가 별도 실제 MySQL을 만들며 개발 DB의 데이터를 바꾸지 않습니다.

### 브라우저 테스트 8개

1. API/DB 연결 배지와 활동 카드 3건 표시.
2. 분야·검색어 필터와 검색 결과 없음 처리.
3. 상세 창·미구현 신청 버튼·Escape 닫기.
4. 정원 11명 거부, 정상 입력 확인, 서버 쓰기 요청 없음.
5. 역할별 흐름과 완료 체크리스트·페르소나 표시.
6. 4장 발표 전환·현재 DB 연결 증거·다음주 인수인계.
7. API 장애 시 오류를 표시하고 가짜 데이터를 채우지 않음.
8. 390px 모바일 가로 넘침 없음·메뉴 동작.

실행 후 생성한 실제 캡처 5장은 `docs/screenshots/`에서 확인할 수 있습니다.

## 설치 중 해결한 문제

- npm 기본 캐시 경로에 쓸 수 없어 쓰기 가능한 `/workspace/.cache/npm`을 사용했습니다.
- Maven은 환경의 HTTPS 프록시를 자동 적용하지 않아 로컬 settings.xml을 생성하고 제공된 CA를 Java 신뢰 저장소에 추가했습니다. TLS 검증을 유지했습니다.
- 기본 Java에는 전체 JDK 컴파일러가 없어 서명된 Debian 저장소의 Java 21 JDK 패키지를 로컬 `.tools/`에 설치했습니다.
- Testcontainers의 digest 이미지 인식에 맞춰 공식 MySQL 이미지를 호환 이름으로 선언했습니다. digest 고정을 유지했습니다.
- MySQL CHECK 위반의 실제 오류는 `HY000/3819`입니다. 테스트가 예상했던 Spring 예외 하위 타입 대신 실제 DB 오류 코드로 제약 거부를 확인하도록 수정했습니다.
- 임시 운영 서버의 포트는 .env보다 우선하는 Spring Boot 명령행 옵션으로 지정해 기본 개발 서버와 충돌하지 않게 확인했습니다.

## 미실행·남은 한계

- 원격 GitHub Actions 결과는 이 로컬 검증의 성공과 별개입니다. 워크플로를 추가했으며 원격 실행 결과는 GitHub에서 확인합니다.
- Windows/macOS 팀 PC 실행은 아직 검증하지 않았습니다.
- 새 클라우드 작업에서의 스냅샷 복원·게시 이후 동작은 아직 검증하지 않았습니다. 저장한 설치·시작 지침은 현재 인스턴스에서 사용한 절차입니다.
- Flyway 관리 버전 11.7.2가 MySQL 8.4에 대한 지원 범위 경고를 출력합니다. 현재 실제 MySQL 8.4.11의 마이그레이션·재시작·제약·API 테스트는 통과했습니다. 추후 Flyway 변경 시 새 버전을 같은 테스트로 검증해야 합니다.
- 학교 캠퍼스·장소 좌표·이용 조건은 현장 검증 전입니다. Kakao·S3·JWT·배포는 아직 적용하지 않았습니다.
