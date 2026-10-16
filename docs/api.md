# API 명세 · 2주차 확정

2026-10-11 확정. **3주차 행(2026-10-13)과 4~7주차 행(2026-10-16, 주차 브랜치)은 구현·테스트 완료**(백엔드 통합 테스트).

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
| 5 | `POST /api/activities/{id}/participations` | 회원 | **구현.** 자리 있으면 APPLIED, 정원(확정+제안)이 차면 WAITLISTED·순번, 시작 2시간 전 이후 정원 참이면 409 `WAITLIST_CLOSED`. 중복 409 `DUPLICATE_APPLICATION`(첫 취소 뒤 1회·만료 뒤 재신청 허용, 거절은 불가). 내 활동·관리자 403, 제한 계정 403 `ACCOUNT_RESTRICTED`. 응답은 아래 `my-participation`과 같음 |
| 5 | `GET /api/activities/{id}/my-participation` | 공개(로그인 시 내 신청 포함) | **구현.** `{confirmed, offered, waiting, pending, participation: {id, status, waitOrder, offerExpiresAt, cancelCount} 또는 null}` |
| 5 | `GET /api/activities/{id}/participations` | 모집자 | **구현.** `{capacity, confirmed, offered, waiting, pending, items:[{id, name(가림), status, waitOrder, offerExpiresAt, appliedAt}]}`, 남의 활동 404 |
| 5 | `POST /api/participations/{id}/approve` · `.../reject` `{reason?}` | 모집자 | **구현.** 활동 행 잠금 후 확정+제안 수 재확인, 차면 409 `CAPACITY_FULL`. 거절은 승인 대기·대기 중만, 사유 기본값 ‘모집자 판단’. 남의 신청 404 |
| 5 | `POST /api/participations/{id}/cancel` | 본인 | **구현.** 시작 전만. 확정·제안 자리가 비면 대기 1번에게 제안(시작 2시간 전부터는 제안 안 함) |
| 5 | `POST /api/participations/{id}/accept-offer` · `.../decline-offer` | 본인 | **구현.** 수락 시 마감 지났으면 410 `OFFER_EXPIRED`. 거절은 EXPIRED 후 다음 순번 제안. 응답 시간: 시작까지 24시간 이상 6시간, 미만 1시간, 대기 마감 시각을 넘지 않음 |
| 5 | `GET /api/me/participations?status=` | 본인 | **구현.** 활동 제목·일시·장소·상태·순번·제안 마감 |
| 5 | `GET /api/me/notifications?unread=true` · `POST /api/notifications/{id}/read` · `POST /api/notifications/read-all` | 본인 | **구현.** `{items(최근 50), unread}`. 남의 알림 404. 화면은 30초마다 조회(푸시 없음) |
| 6 | `GET /api/activities/{id}/qr` | 모집자 | **구현.** `{open, token(열려 있을 때만), opensAt, closesAt, validSeconds:60}`. 값 = `활동번호.발급초.HMAC`. 남의 활동 404 |
| 6 | `POST /api/activities/{id}/check-ins` `{qrToken, lat, lng}` | 본인(확정자) | **구현.** 확인 순서: 확정 아니면 403(이미 체크인 409) → 시간 밖 422 `CHECKIN_OUT_OF_TIME` → QR 60초 지남 410 `QR_EXPIRED`, 위조·다른 활동 400 `QR_INVALID` → 위치 없음·장소 좌표 없음·200m 밖 422 `CHECKIN_OUT_OF_RANGE`. 좌표 저장 안 함 |
| 6 | `POST /api/participations/{id}/manual-check-in` `{reason}` | 모집자 | **구현.** 사유 없으면 400, 시작 30분 전~종료 시각, 확정자만 |
| 6 | `POST /api/participations/{id}/complete` | 모집자 | **구현.** 종료 전·체크인 안 한 사람 409. `activity_records` 생성·`RECORD_CONFIRMED` 알림 |
| 6 | `GET /api/me/records` | 본인 | **구현.** 제목·일시·출석 방법·완료 확인 시각·이의 신청 마감(+7일)·상태 |
| 7 | `POST /api/records/{id}/appeals` `{reason}` | 기록 본인·모집자·함께 완료한 참가자 | **구현.** 10~1000자, 완료 확인 7일 지나면 410 `APPEAL_PERIOD_OVER`, 같은 사람 중복 409 `DUPLICATE_APPEAL`, 관계없는 사람 404. 기록 보류 |
| 7 | `GET /api/admin/appeals` · `POST /api/admin/appeals/{id}/accept`·`reject` `{reason}` | 관리자 | **구현.** 사유 필수. 인정 = 기록·참가 무효, 기각 = 다시 유효 |
| 7 | `POST /api/reports` `{activityId, targetUserId?, reasonType, description}` · `POST /api/reports/{id}/evidences` (multipart `file`) | 참여자·모집자 | **구현.** 사유 SAFETY·FALSE_RECORD·HARASSMENT·INAPPROPRIATE·OTHER, 10~1000자, 1시간 10건(429). 증빙: 앞부분 바이트로 jpeg·png·pdf 확인(확장자도 일치), 10MB, 최대 3개, 사진은 다시 저장해 메타데이터 제거. **보관은 서버 비공개 폴더**(S3는 아직) |
| 7 | `GET /api/me/reports` · `GET /api/me/sanctions` | 본인 | **구현.** 내 신고와 처리 결과, 내 제재(진행 중 여부) |
| 7 | `GET /api/admin/reports?status=` · `POST /api/admin/reports/{id}/resolve` `{action, reason}` | 관리자 | **구현.** action = HOLD(대상자 출석·기록 또는 활동 보류)·DISMISS·ACTION(보류 해제)·INVALIDATE(대상자 기록 무효). 사유 필수, 처리 끝난 신고 409 |
| 7 | `GET /api/admin/users?email=` · `POST /api/admin/users/{id}/sanctions` `{type, days, reason, reportId?}` | 관리자 | **구현.** 3글자 이상 검색(최근 90일 불참 수·제재 이력). WARNING·RESTRICTION·SUSPENSION, 사유 필수, 제한·정지는 1~365일, 관리자 제재 불가. 노쇼 3회/90일 → 자동 14일 제한 |
| 7 | `GET /api/activities/recommended?lat&lng` | 회원 | **구현.** 점수 = 0.4×관심 분야 + 0.35×거리(0km 1 → 5km 0, 위치 없으면 모두 0.5) + 0.25×일정(내일 1 → 14일 뒤 0), 이유 목록, 내 활동·신청한 활동 제외, 상위 6개 |
| 7 | `GET /api/admin/reports/{id}/evidences/{eid}/url` → `GET /api/evidence-files/{eid}?exp&sig` | 관리자 → 링크 | **구현.** 5분짜리 HMAC 서명 링크. 서명 틀림 403, 만료 410, `no-store`·`nosniff` |

## 화면별 API 요구사항

| 화면 | 쓰는 API | 화면이 받아야 할 값 | 오류·빈 상태 |
|---|---|---|---|
| 활동 찾기 | `GET /api/activities`, `GET /api/places` | id, title, category, activityType, placeName, distanceKm, date·startTime, durationMinutes, capacity, confirmed, latitude/longitude (대기열 정보는 5주차) | 결과 0건 안내(반경 넓히기), 위치 거부 시 활동 장소 중심, 실패 시 다시 시도 |
| 활동 상세 | `GET /api/activities/{id}` + 내 신청 상태 | 위 + description, organizer 표시명, myParticipationStatus, 보험 비적용 안내 | 404, 마감·정원 참 |
| 활동 만들기 | `POST /api/activities`, `GET /api/me` | riskLevel, riskReasons[], status | 칸별 `fieldErrors`, BLOCKED 이유, 기관 미확인 403 |
| 내 활동 · 신청 | `GET /api/me/participations`, offer 응답 | status, waitOrder, offerExpiresAt | 상태 이름 5종 안내(화면 반영 완료) |
| 내 활동 · 개설 | 신청자 목록·승인·QR | 확정/제안/대기 수, 남은 응답 시간, 상태 기록 | 정원 초과 409 |
| 내 활동 · 기록 | `GET /api/me/records`, 이의제기 | confirmedAt, appealDeadline, status | 7일 지나면 버튼 숨김 |
| 로그인 | `POST /api/auth/login` | 토큰, 회원 유형 | 이메일·비밀번호 오류는 하나의 문구로 |
| 회원가입 | `POST /api/auth/signup` | 생성된 회원, 기관 상태 PENDING | `UNDER_AGE`, `EMAIL_TAKEN`, 칸별 오류 |

화면 입력 규칙과 서버 검증 문구는 [rules.md](rules.md)로 맞춥니다.
