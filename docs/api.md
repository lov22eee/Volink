# API 명세 · 2주차 확정

2026-10-11 확정. **3주차 행(2026-10-13)과 4주차 행(2026-10-16, 4주차 브랜치)은 구현·테스트 완료**(백엔드 통합 테스트), 5주차 이후 행은 아직 동작하지 않습니다.

## 공통 규칙

- 주소: `/api/...`, JSON, 시간은 한국 시간 ISO-8601(`2026-10-18T10:00:00+09:00`).
- 인증: `Authorization: Bearer <access token>` (3주차, [security-cost.md](security-cost.md)).
- 화면이 보낸 인원 수·상태·역할은 믿지 않습니다. 서버가 DB에서 다시 확인합니다.
- 목록은 `?page=0&size=20`, 응답 `{ items, page, size, total }`.

### 오류 응답

```json
{ "code": "VALIDATION_FAILED", "message": "입력 내용을 확인해 주세요.",
  "fieldErrors": [{ "field": "capacity", "message": "모집 정원은 2~10명입니다." }] }
```

| HTTP | code | 화면 처리 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 칸 아래 오류 + 위쪽 “고칠 항목 N개” |
| 401 | `UNAUTHENTICATED` | 로그인 화면으로 |
| 403 | `FORBIDDEN`, `ACCOUNT_RESTRICTED`, `ORGANIZATION_NOT_APPROVED` | 이유 안내, 버튼 숨김 |
| 404 | `NOT_FOUND` | “찾을 수 없습니다” 화면 (권한 없는 남의 자료도 404) |
| 409 | `DUPLICATE_APPLICATION`, `CAPACITY_FULL`, `INVALID_STATE`, `EMAIL_TAKEN` | 최신 상태 다시 불러오기 |
| 410 | `OFFER_EXPIRED`, `QR_EXPIRED`, `APPEAL_PERIOD_OVER` | 만료 안내 |
| 422 | `ACTIVITY_BLOCKED`, `UNDER_AGE`, `CHECKIN_OUT_OF_TIME`, `CHECKIN_OUT_OF_RANGE` | 이유 + 다음 행동 안내 |
| 429 | `TOO_MANY_REQUESTS` | 잠시 후 다시 |

## API 목록

3주차 구현 메모: `role` 필드는 무시, 로그인 실패 5회/분/이메일 → 429, 리프레시 쿠키 `volink_refresh`(HttpOnly·SameSite=Strict·Path=/api/auth, 사용 시 교체), 관리자 승인 사유는 선택·반려 사유는 필수, 활동 장소는 4주차 전까지 `placeId`(시연 장소 후보 1~3).

권한: 공개 / 회원 / 본인 / 모집자(자기 활동) / 확인된 기관회원 / 관리자.

| 주차 | 요청 | 권한 | 내용 |
|---|---|---|---|
| 3 | `POST /api/auth/signup` | 공개 | 일반·기관 가입. 만 14세 미만 422 `UNDER_AGE`, `role` 필드 무시(ADMIN 불가), 기관이면 organizations PENDING 생성 |
| 3 | `POST /api/auth/login` · `POST /api/auth/refresh` · `POST /api/auth/logout` | 공개/회원 | 토큰 발급·갱신·폐기 |
| 3 | `GET /api/me` · `PUT /api/me/interests` | 본인 | 내 정보(회원 유형·기관 상태), 관심 분야 1~3개 |
| 3 | `POST /api/activities` | 회원 (기관 주관은 확인된 기관회원, 관리자 불가) | 입력 검증 → 위험도 검사. LOW 201 공개, REVIEW 201 비공개, BLOCKED 422 |
| 3 | `GET /api/activities` | 공개 | **구현 추가:** 모집 중(RECRUITING)이고 시작 전인 활동, 시작 시각 순. 4주차에 반경·날짜·분야 조건 추가 |
| 3 | `GET /api/me/activities` | 본인 | **구현 추가:** 내가 개설한 활동 전체(검토 이유·반려 사유 포함) |
| 3 | `GET /api/activities/{id}` | 공개 (비공개는 모집자·관리자) | 상세 |
| 3 | `GET /api/admin/organizations?status=PENDING` · `POST /api/admin/organizations/{id}/approve` · `.../reject` | 관리자 | 기관 확인, 반려 사유 필수 |
| 3 | `GET /api/admin/activities?risk=REVIEW` · `POST /api/admin/activities/{id}/approve` · `.../reject` | 관리자 | REVIEW 검토, 사유 필수 |
| 4 | `GET /api/activities?lat&lng&radiusKm&date&category&type` | 공개 | **구현.** 모든 조건 선택. `lat`+`lng`가 있으면 반경(기본 3km, 0.5~10km) 안만 가까운 순·`distanceKm` 포함. `date`=YYYY-MM-DD, `category`=분야 이름, `type`=GENERAL/INSTITUTION. 모집 중·시작 전만(REVIEW 미승인·반려 제외, BLOCKED는 저장 안 함). 위치 하나만 오면 400 `location`. 내 위치는 저장·기록 안 함 |
| 4 | `GET /api/places` | 공개 | **구현.** 장소 이름·지역·만남 지점·좌표(없으면 null)·`coordinateStatus`(UNVERIFIED/ENTERED) |
| 4 | `PUT /api/admin/places/{id}` `{latitude, longitude, meetingPoint, reason?}` | 관리자 | **구현.** 국내 범위(위도 33~39, 경도 124~132) 검사, 그 장소의 활동 위치도 갱신, `admin_actions`(PLACE) 기록 |
| 4+ | `GET /api/activities?…&q&from&to&part` | 공개 | **구현(2026-10-21 보완).** `q` 제목·소개·장소 이름 검색(50자), `from`·`to` 날짜 범위, `part`=AM(정오 전 시작)/PM, 반경 최대 **20km** |
| 4+ | `GET /api/places/search?query&lat&lng` | 공개(분당 40회) | **구현.** `{mode: KAKAO\|LOCAL, items[]}`. 항목: kakaoId·name·address·categoryName·latitude·longitude·distanceMeters·`placeClass`(OPEN/REVIEW/BLOCKED)·`classLabel`·`token`(BLOCKED는 없음). Kakao REST 키가 없으면 LOCAL: 관리자 등록 장소(`placeId`) |
| 4+ | `GET /api/places/nearby?lat&lng` | 공개(분당 40회) | **구현.** 지도 핀 주변 약 150m 장소(관광·문화·공공기관·카페·음식점·병원 분류), 형식은 위와 같음 |
| 4+ | `POST /api/activities` `{…, place: {kakaoId, name, address, categoryName, latitude, longitude, placeClass, classLabel, token}, meetingPoint, supplies: [{name, provided}]}` | 회원 | **구현.** `placeId` 대신 검색 장소. 서명이 다르거나 3시간이 지나면 400 `place`. REVIEW 장소는 위험도 REVIEW(이유 ‘장소가 ○○’). `meetingPoint` 100자. `supplies` 최대 6개·이름 1~10자·중복 불가(400 `supplies`), 이름도 위험 단어 검사. 활동 조회 응답에 `supplies`(없으면 `[]`)·`meetingPoint`·`placeAddress` |
| 4+ | `GET /api/volunteer-programs?lat&lng&radiusKm&q&youth&recruiting` | 공개(분당 40회) | **구현.** `{enabled, region, items[]}`. 1365 활동: programNo·title·organization·place·periodStart/End·beginTime/endTime·weekdays·recruitStatus·youthOk·latitude/longitude(없으면 null)·distanceKm·link. 기본 모집중·20km 안. 키 없으면 `enabled:false` |
| 4+ | `GET /api/admin/volunteer-programs/check?lat&lng` | 관리자 | **구현.** 키 여부·지역·코드·목록 건수·응답 필드 **이름**·오늘 사용 횟수(값은 보여주지 않음) |
| 4+ | `PUT /api/activities/{id}` (만들기와 같은 본문) | 모집자(남은 404) | **구현(보완 2).** 시작 전·DRAFT/RECRUITING만(아니면 409 `INVALID_STATE`), 신청자가 있으면 409 `HAS_APPLICANTS`. 위험도 재검사: BLOCKED 422(변경 없음), REVIEW면 DRAFT로 다시 숨김. 지금 장소는 `placeId`로 그대로 둘 수 있음 |
| 4+ | `PATCH /api/activities/{id}/notes` `{description, meetingPoint}` | 모집자 | **구현.** 신청자가 있어도 가능, 위험 단어 검사 |
| 4+ | `DELETE /api/activities/{id}` | 모집자 | **구현.** 204. 신청자 0명·시작 전만, 상태 DELETED(기록 유지)로 모든 목록·상세에서 숨김 |
| 5 | `POST /api/activities/{id}/participations` | 회원 | 신청. 중복 409, 정원 차면 대기 순번 |
| 5 | `GET /api/activities/{id}/participations` | 모집자 | 신청자 목록(이름 일부 가림, 연락처 없음) |
| 5 | `POST /api/participations/{id}/approve` · `.../reject` | 모집자 | 행 잠금 후 정원 재확인, 초과면 409 |
| 5 | `POST /api/participations/{id}/cancel` | 본인 | 시작 전 취소, 빈자리 승격 |
| 5 | `POST /api/participations/{id}/accept-offer` · `.../decline-offer` | 본인 | 승격 제안 응답, 만료 410 |
| 5 | `GET /api/me/participations?status=` | 본인 | 내 신청 |
| 5 | `GET /api/me/notifications?unread=true` · `POST /api/notifications/{id}/read` | 본인 | 화면 안 알림(주기 조회, 푸시 없음) |
| 6 | `GET /api/activities/{id}/qr` | 모집자 | 60초 서명 QR 값 |
| 6 | `POST /api/activities/{id}/check-ins` `{qrToken, lat, lng}` | 본인(확정자) | 시간(시작 30분 전~30분 후)·QR·200m 확인, 좌표 저장 안 함 |
| 6 | `POST /api/participations/{id}/manual-check-in` `{reason}` | 모집자 | 사유 필수 |
| 6 | `POST /api/participations/{id}/complete` | 모집자 | 종료 후, 체크인한 사람만. 기록 생성 |
| 6 | `GET /api/me/records` | 본인 | 활동 기록 |
| 7 | `POST /api/records/{id}/appeals` | 본인 | 완료 확인 7일 안, 지나면 410 |
| 7 | `POST /api/reports` · `POST /api/reports/{id}/evidences` | 참여자·모집자 | 신고, 증빙 jpeg·png·pdf 10MB·최대 3개, 메타데이터 제거 후 비공개 S3 |
| 7 | `GET /api/admin/reports` · `POST /api/admin/reports/{id}/resolve` | 관리자 | 보류·재개·무효, 사유 필수 |
| 7 | `POST /api/admin/users/{id}/sanctions` | 관리자 | 경고·제한·정지, 사유 필수 |
| 7 | `GET /api/activities/recommended` | 회원 | 거리+시간+관심 분야 점수 합(단순 추천) |
| 7 | `GET /api/reports/{id}/evidences/{eid}/url` | 관리자 | 제한시간 URL(5분) |

## 화면별 API 요구사항

| 화면 | 쓰는 API | 화면이 받아야 할 값 | 오류·빈 상태 |
|---|---|---|---|
| 활동 찾기 | `GET /api/activities`, `GET /api/volunteer-programs`, `GET /api/places/search`(지역 고르기) | id, title, category, activityType, placeName, distanceKm, date·startTime, durationMinutes, capacity, confirmed, latitude/longitude (대기열 정보는 5주차) | 결과 0건 안내(반경 넓히기), 위치 거부 시 활동 장소 중심, 실패 시 다시 시도 |
| 활동 상세 | `GET /api/activities/{id}` + 내 신청 상태 | 위 + description, organizer 표시명, myParticipationStatus, 보험 비적용 안내 | 404, 마감·정원 참 |
| 활동 만들기 | `POST /api/activities`, `GET /api/me` | riskLevel, riskReasons[], status | 칸별 `fieldErrors`, BLOCKED 이유, 기관 미확인 403 |
| 내 활동 · 신청 | `GET /api/me/participations`, offer 응답 | status, waitOrder, offerExpiresAt | 상태 이름 5종 안내(화면 반영 완료) |
| 내 활동 · 개설 | 신청자 목록·승인·QR | 확정/제안/대기 수, 남은 응답 시간, 상태 기록 | 정원 초과 409 |
| 내 활동 · 기록 | `GET /api/me/records`, 이의제기 | confirmedAt, appealDeadline, status | 7일 지나면 버튼 숨김 |
| 로그인 | `POST /api/auth/login` | 토큰, 회원 유형 | 이메일·비밀번호 오류는 하나의 문구로 |
| 회원가입 | `POST /api/auth/signup` | 생성된 회원, 기관 상태 PENDING | `UNDER_AGE`, `EMAIL_TAKEN`, 칸별 오류 |

화면 입력 규칙과 서버 검증 문구는 [rules.md](rules.md)로 맞춥니다.


## 활동 입력 중 위험 단어 확인 (2026-10-25)

`POST /api/activities/check` · 로그인 필요 · 저장하지 않음

요청 `{ title, description, supplies: [이름] }` → 응답 `{ title: [hit], description: [hit], supplies: [hit] }`, hit = `{ keyword, level: BLOCKED|REVIEW, reason }`. 저장 시 검사(`RiskClassifier`)와 같은 단어표·띄어쓰기 무시 비교이며, 화면이 칸 밑에 ‘검토 후 승인 예정 / 모집을 올릴 수 없어요’를 보여줄 때만 씁니다. 긴 입력은 2000자로 잘라 봅니다.
