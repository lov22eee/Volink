# API 명세 · 2주차 확정

2026-10-11 확정. **3주차 행(2026-10-13), 4·5주차 행(2026-10-16), 6주차 행(2026-11-03 main 기준 이식·고도화)은 구현·테스트 완료**(백엔드 통합 테스트), 7주차 행은 아직 동작하지 않습니다.

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
| 3 | `GET /api/me` · `PUT /api/me/interests` | 본인 | 내 정보(회원 유형·기관 상태), 관심 분야 0~3개(2026-11-05부터 가입 때 묻지 않음, 선택) |
| 3 | `POST /api/activities` | 회원 (기관 주관은 확인된 기관회원, 관리자 불가) | 입력 검증 → 위험도 검사. LOW 201 공개, REVIEW 201 비공개, BLOCKED 422 |
| 3 | `GET /api/activities` | 공개 | **구현 추가:** 모집 중(RECRUITING)이고 시작 전인 활동, 시작 시각 순. 4주차에 반경·날짜·분야 조건 추가 |
| 3 | `GET /api/me/activities` | 본인 | **구현 추가:** 내가 개설한 활동 전체(검토 이유·반려 사유 포함) |
| 3 | `GET /api/activities/{id}` | 공개 (비공개는 모집자·관리자) | 상세 |
| 3 | `GET /api/admin/organizations?status=PENDING` · `POST /api/admin/organizations/{id}/approve` · `.../reject` | 관리자 | 기관 확인, 반려 사유 필수 |
| 3 | `GET /api/admin/activities?risk=REVIEW` · `POST /api/admin/activities/{id}/approve` · `.../reject` | 관리자 | REVIEW 검토, 사유 필수 |
| 5+ | `GET /api/admin/stats/applications?days=14` | 관리자 | **구현(2026-10-28, 관리자 대시보드).** 읽기 전용. `days`(7~60, 기본 14)일 동안 한국 날짜별 신청 수 `days[{date, applications}]`(없는 날 0, 오늘 포함, 첫 신청 시각 기준 · 취소 후 재신청은 같은 행이라 한 번)와 지금 상태별 신청 수 `statuses{APPLIED: n, …}` |
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
| 5 | `POST /api/activities/{id}/participations` | 회원 | **구현.** 자리 있으면 APPLIED, 정원(확정+제안)이 차면 WAITLISTED·순번, 시작 2시간 전 이후 정원 참이면 409 `WAITLIST_CLOSED`. 중복 409 `DUPLICATE_APPLICATION`(첫 취소 뒤 1회·만료 뒤 재신청 허용, 거절은 불가). 내 활동·관리자 403, 제한 계정 403 `ACCOUNT_RESTRICTED`. 응답은 아래 `my-participation`과 같음 |
| 5 | `GET /api/activities/{id}/my-participation` | 공개(로그인 시 내 신청 포함) | **구현.** `{confirmed, offered, waiting, pending, participation: {id, status, waitOrder, offerExpiresAt, cancelCount} 또는 null}` |
| 5 | `GET /api/activities/{id}/participations` | 모집자 | **구현.** `{capacity, confirmed, offered, waiting, pending, items:[{id, name(가림), status, waitOrder, offerExpiresAt, appliedAt}]}`, 남의 활동 404 |
| 5 | `POST /api/participations/{id}/approve` · `.../reject` `{reason?}` | 모집자 | **구현.** 활동 행 잠금 후 확정+제안 수 재확인, 차면 409 `CAPACITY_FULL`. 거절은 승인 대기·대기 중만, 사유 기본값 ‘모집자 판단’. 남의 신청 404 |
| 5 | `POST /api/participations/{id}/cancel` | 본인 | **구현.** 시작 전만. 확정·제안 자리가 비면 대기 1번에게 제안(시작 2시간 전부터는 제안 안 함) |
| 5 | `POST /api/participations/{id}/accept-offer` · `.../decline-offer` | 본인 | **구현.** 수락 시 마감 지났으면 410 `OFFER_EXPIRED`. 거절은 EXPIRED 후 다음 순번 제안. 응답 시간: 시작까지 24시간 이상 6시간, 미만 1시간, 대기 마감 시각을 넘지 않음 |
| 5 | `GET /api/me/participations?status=` | 본인 | **구현.** 활동 제목·일시·장소·상태·순번·제안 마감 |
| 5 | `GET /api/me/notifications?unread=true` · `POST /api/notifications/{id}/read` · `POST /api/notifications/read-all` | 본인 | **구현.** `{items(최근 50), unread}`. 남의 알림 404. 화면은 30초마다 조회(푸시 없음) |
| 6 | `GET /api/me/notification-center?category=APPLY\|ACTIVITY\|TALK&before={id}&size=20` | 본인 | **구현(V16, 2026-11-05 알림센터 A안).** 최신순 페이지(`next`=다음 `before`), 칩별 안 읽은 수 `unread{ALL,APPLY,ACTIVITY,TALK,OTHER}`. 항목: `type`·`category`·`activityId`·`activityTitle`·`activityGone`(지워진 활동)·`ids`·`count`. 같은 활동의 새 참가 신청(`APPLIED`)이 30분 안에 이어지면 한 줄(‘새 참가 신청 3건’, `ids`에 전부). 원본은 묶거나 지우지 않음. 알 수 없는 category·size 1~50 밖은 400 |
| 6 | `POST /api/notifications/read` `{ids}` | 본인 | **구현(V16).** 묶인 줄을 한 번에 읽음(1~200개, 남의 id는 건드리지 않고 건너뜀, 반복해도 같음). `{read: 바뀐 수}` |
| 6 | `GET·PUT /api/me/notification-settings` `{apply, activity, talk, quiet}` | 본인 | **구현(V16).** 휴대폰 알림(푸시) 종류별 켜기·끄기, 조용한 시간(22~08시). 앱 안 알림 목록에는 영향 없음. 푸시는 Firebase 연결 전이라 아직 쓰이지 않음 |
| 6 | `GET /api/activities/{id}/qr` | 모집자 | **구현.** `{open, token(열려 있을 때만), opensAt, closesAt, validSeconds:60, rotateSeconds:30, expected, checkedIn, toComplete, status}`. 값 = `활동번호.발급초.HMAC`. 화면은 30초마다 새 값을 받아 QR을 바꿈(받은 값은 60초 유효). 남의 활동 404 |
| 6 | `POST /api/activities/{id}/check-ins` `{qrToken, lat, lng, accuracy?}` | 본인(확정자) | **구현.** 확인 순서: 확정 아니면 403(이미 체크인 409) → 시간 밖 422 `CHECKIN_OUT_OF_TIME` → QR 60초 지남 410 `QR_EXPIRED`, 위조·다른 활동 400 `QR_INVALID` → 위치 없음·장소 좌표 없음·반경 밖 422 `CHECKIN_OUT_OF_RANGE`(“약 Nm 떨어져 있어요”). 휴대폰이 알려 준 GPS 오차는 **최대 50m까지만** 반경에 더해 줌. 좌표 저장 안 함 |
| 6 | `POST /api/participations/{id}/manual-check-in` `{reason}` | 모집자 | **구현.** 사유 없으면 400, 시작 30분 전~종료 시각, 확정자만 |
| 6 | `POST /api/participations/{id}/complete` | 모집자 | **구현.** 종료 전·체크인 안 한 사람 409. `activity_records` 생성·`RECORD_CONFIRMED` 알림 |
| 6 | `POST /api/activities/{id}/complete` | 모집자 | **구현(고도화).** 종료 후 체크인한 사람 **모두** 완료 → `{completed: n}`. 종료 전 409, 남의 활동 404 |
| 6 | `GET /api/activities/{id}/posts` | 모집자·확정자(체크인·완료·불참 포함)·관리자(읽기만) | **구현(2026-11-04 추가).** 활동 소식 `{canNotice, canAsk, canAnswer, unanswered, notices[], questions[{…, answer}]}`. 이름 일부 가림, 모집자는 ‘모집자’. 그 밖 403 |
| 6 | `POST /api/activities/{id}/notices` `{body}` | 모집자 | **구현.** 1~500자, 확정·체크인한 참가자에게 알림. 끝난 활동 409 |
| 6 | `POST /api/activities/{id}/questions` `{body}` | 확정자 | **구현.** 모집자에게 알림. 전화번호·이메일·오픈채팅 링크는 400(연락처 비공개), 한 시간 10개 넘으면 429 |
| 6 | `POST /api/activity-posts/{id}/answer` `{body}` | 모집자 | **구현.** 질문당 답변 1개(두 번째 409), 질문한 사람에게 알림 |
| 6 | `DELETE /api/activity-posts/{id}` | 작성자, 질문은 모집자도 | **구현.** 지운 표시만 남기고(답변도 함께) 화면에서 숨김 |
| 6 | `GET /api/me/saved` · `PUT /api/me/saved/{activityId}` · `DELETE …` | 본인 | **구현(2026-11-05, V10).** 저장한 봉사. 볼 수 없는 활동 PUT은 404, 같은 활동 두 번 저장해도 1개. 목록은 모집 중·진행·종료만 |
| 6 | `GET /api/community/posts?category=FREE\|QUESTION\|REVIEW&sort=latest\|popular` · `GET …/posts/{id}` · `POST /api/community/posts` `{category, title, body, activityId?}` · `DELETE …/posts/{id}` · `PUT/DELETE …/posts/{id}/like` · `POST …/posts/{id}/comments` `{body}` · `DELETE /api/community/comments/{id}` · `GET /api/community/reviewable` | 회원(쓰기는 관리자·제한 계정 불가) | **구현(2026-11-05, V11).** 제목 2~60자·내용 5~2000자·댓글 1~500자, 연락처 400, 글 하루 10개·댓글 한 시간 30개 429. REVIEW는 내 활동 기록(VALID)이 있는 활동만(아니면 400 `activityId`). 이름 가림, 지우기는 작성자·관리자(표시만 남김). 댓글은 글쓴이에게 `COMMUNITY_COMMENT` 알림 |
| 6 | `GET /api/community/me` · `PUT /api/community/me` `{nickname, agree}` | 회원 | **구현(2026-11-05, V12).** 커뮤니티 닉네임 2~10자(한글·영문·숫자·공백), 중복 409 `NICKNAME_TAKEN`, ‘관리자·운영자·volink’ 등 사칭 400, 30일에 한 번 변경(409 `NICKNAME_CHANGE_LIMIT`), 규칙 동의 필수. 둘 다 없으면 글·댓글 403 `COMMUNITY_SETUP_REQUIRED` |
| 6 | `POST /api/activities/{id}/questions` `{body, privately?}` · `POST /api/activities/{id}/posts/seen` | 확정자 / 모집자·확정자 | **보완(2026-11-05, V13).** `privately`면 질문과 답변을 질문한 사람·모집자·관리자만 봄. `seen`은 소식을 연 시각 기록(204). 목록 응답에 `newNotices`·`newAnswers`(마지막으로 연 뒤 새 글)·`audience`(확정 인원), 각 글 `private`·`unseen`, 모집자에게만 공지별 `readCount` |
| 6 | `GET /api/activities/{id}/qr` → `code`·`codeSecondsLeft` · `POST /api/activities/{id}/check-ins` `{code, lat, lng, accuracy?}` · `POST /api/activities/{id}/manual-check-ins` `{participationIds[], reason}` | 모집자 / 확정자 / 모집자 | **구현(2026-11-05, V14).** 출석 코드 4자리는 QR과 같은 비밀키로 30초 구간마다 만들고 직전 구간까지 인정. 코드 체크인은 QR과 같은 확인(확정·시간·200m), method `CODE`. 틀린 코드는 `CODE_WRONG`으로 기록, 10분에 5번이면 429 `CODE_LOCKED`. 여러 명 수동 확인은 1~10명, 사유 하나, 전부 되거나 전부 안 됨 |
| 6 | `GET /api/auth/oauth/providers` · `GET /api/auth/oauth/{kakao\|google}/start` → 공급자 → `GET …/callback` · `POST /api/auth/oauth/finish` `{code}` · `POST /api/auth/oauth/complete` `{ticket, name, birthDate, interests, agreedNotice}` | 공개 | **구현(2026-11-05, V15).** 개인(GENERAL) 회원만. 연결된 계정은 콜백이 `/#/oauth?code=`(60초 1회용)로 보내고 `finish`가 세션(로그인과 같은 응답·리프레시 쿠키). 처음이면 `/#/social-signup?ticket=`(30분)으로 가입 양식(만 14세·관심 분야·안내 동의) → `complete`. state는 서명+쿠키(nonce)로 묶음, 실패는 `/#/login?oauth=코드`. 공급자 이메일은 ‘인증됨’이고 아무도 안 쓸 때만 저장, 아니면 `…@social.volink.invalid`. 키 없으면 `providers`가 false |
| 6 | `GET /api/me/records` | 본인 | **구현.** 제목·일시·출석 방법·완료 확인 시각·상태. Volink 자체 기록이며 공식 봉사실적이 아님 |
| 6 | `POST /api/activities/{id}/cancel` `{reason}` | 모집자 | **구현(2026-11-04, V9).** 시작 전·DRAFT/RECRUITING만, 사유 2~200자. 활동 CANCELLED + `cancel_reason`, 남은 신청 모두 CANCELLED(본인 취소 횟수는 안 늘림)·알림. 신청했던 사람은 상세에서 사유를 볼 수 있음 |
| 6 | `POST /api/activities/{id}/reschedule` `{date, time, durationMinutes, reason}` | 모집자 | **구현(V9).** 모집 중·활동마다 1회(409 `RESCHEDULE_USED`)·지금 시작 24시간 전까지(409 `RESCHEDULE_TOO_LATE`). 새 시간은 만들기 규칙과 같고 해 진 뒤 끝나면 400. 확정은 유지, 신청·대기 모두 알림, 하루 전·체크인 알림은 새 시간 기준으로 다시 |
| 6 | `POST /api/participations/{id}/late` `{minutes: 10\|20\|30}` | 본인(확정자) | **구현(V9).** 시작 3시간 전~종료, 모집자에게 알림, 신청자 목록에 `lateMinutes` |
| 6 | `POST /api/participations/{id}/cancel` `{reason?}` | 본인 | **보완(V9).** ‘못 가요’: 100자 이내 이유를 모집자 알림에 붙임(본문 없어도 됨) |
| 6 | 활동 응답 `difficulty`(EASY/NORMAL/HARD)·`placeKind`(OUTDOOR/INDOOR/MIXED)·`newcomerOk` | — | **구현(V9).** 만들기·수정 본문에 선택(기본 EASY·OUTDOOR·true). 내 활동 목록에 `pending`·`unanswered`·`checkedIn`. 스케줄러가 시작 24시간 전 확정자에게 ‘내일 함께해요’ 알림 1회 |
| 6 | (스케줄러, 1분마다) | — | **구현.** 시작 24시간 전 승인 대기 신청이 있으면 모집자에게 1번 안내 · 시작 30분 전 체크인 열림을 확정자·모집자에게 1번 안내 · 시작 시 RECRUITING→IN_PROGRESS, 남은 승인 대기·대기·제안은 EXPIRED + 당사자 알림 · 종료 시 FINISHED, 체크인 없는 확정자 NO_SHOW + 모집자 안내 |
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


## 지도에서 직접 찍은 위치 (2026-10-26)

`GET /api/places/point?lat=&lng=` · 공개 · 장소 검색과 같은 횟수 제한

응답은 장소 검색 결과 한 건과 같은 모양이며 `picked: true`, `placeClass: REVIEW`, `classLabel: 이름 없는 장소(길·골목·공터)`, 이름은 카카오 좌표→주소 결과 + ‘근처’(키가 없으면 ‘지도에서 고른 위치’), `kakaoId: p:위도,경도`(소수 5자리), 서버 서명 `token`. 활동 저장 시 일반 장소와 같이 서명을 확인합니다.

## 활동 입력 중 위험 단어 확인 (2026-10-25)

`POST /api/activities/check` · 로그인 필요 · 저장하지 않음

요청 `{ title, description, supplies: [이름] }` → 응답 `{ title: [hit], description: [hit], supplies: [hit] }`, hit = `{ keyword, level: BLOCKED|REVIEW, reason }`. 저장 시 검사(`RiskClassifier`)와 같은 단어표·띄어쓰기 무시 비교이며, 화면이 칸 밑에 ‘검토 후 승인 예정 / 모집을 올릴 수 없어요’를 보여줄 때만 씁니다. 긴 입력은 2000자로 잘라 봅니다.
