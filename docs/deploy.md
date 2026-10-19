# 서버 배포 (4주차 '첫 배포'를 3주차 발표 전에 앞당김)

2026-10-13 **배포 완료: https://3-104-31-169.sslip.io** (HTTPS 인증서 발급, 서버 상태 확인 `{"status":"UP"}`, 첫 화면 접속을 사용자가 브라우저로 확인). 3주차 발표에서 로그인·활동 저장을 주소로 라이브 시연하려고 4주차 계획 중 **서버 배포만** 먼저 합니다. 지도·반경 검색은 4주차 그대로입니다.

## 구성 (계획서·security-cost.md 기준)

| 항목 | 값 |
|---|---|
| 서버 | EC2 1대, Ubuntu 24.04, t3.small(안 되면 t3.micro) + 스왑 2GB, 디스크 20GB |
| 지역 | **시드니(ap-southeast-2)**. AWS 무료 플랜은 처음 정해진 지역만 사용 가능해 서울을 쓰지 못함. 유료 전환은 하지 않음 |
| 구성 | Nginx(화면 파일 + `/api` 전달) → Spring Boot(systemd, 127.0.0.1:8080) → MySQL 8.4(Docker, 127.0.0.1:3307) |
| 주소 | 고정 IP + `IP.sslip.io` 무료 주소, Let's Encrypt HTTPS(실패하면 http로 열림) |
| 방화벽 | 80·443 공개, 22는 EC2 Instance Connect만. 3306·8080 비공개 |
| 비밀값 | 서버에서 `scripts/setup-env.sh`로 생성해 `/opt/volink/.env`(root만 읽기)에 보관. Git·채팅·로그에 남기지 않음. `AUTH_COOKIE_SECURE=true` |
| 시연 계정 | 시연 서버라서 dev 프로필로 시연 계정 11명을 만듦(관리자 검토 시연용). 실제 운영 전환 시 제거 |
| 비용 | 무료 플랜 크레딧에서 차감(월 약 25달러 추정, 확인 전). 크레딧이 끝나면 서버가 멈추고 카드 결제는 없음 |

## 처음 만들기 (한 번)

AWS 콘솔 왼쪽 아래 **CloudShell**을 열고 한 줄 실행합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/lov22eee/Volink/<브랜치>/scripts/aws/launch.sh | REF=<브랜치> bash
```

보안 그룹·고정 IP·서버를 만들고 주소를 출력합니다. 서버는 15~20분 동안 스스로 설치합니다(`scripts/aws/server-setup.sh`).

## 확인·업데이트

- EC2 → 인스턴스 → `volink` → 연결 → EC2 Instance Connect
- 설치 진행: `sudo tail -f /var/log/volink-setup.log` (마지막에 `DONE`)
- 새 코드 반영: `sudo bash /opt/volink/scripts/aws/server-setup.sh`
- 따라갈 브랜치 바꾸기: `echo main | sudo tee /etc/volink/ref`
- 시연 계정 비밀번호는 서버 화면에서만 확인: `sudo grep DEMO_ACCOUNT_PASSWORD /opt/volink/.env` (채팅·문서에 붙이지 않음)
- 관리자 만들기: 사이트에서 일반회원으로 가입한 뒤 서버에서 `sudo bash /opt/volink/scripts/aws/make-admin.sh 이메일` → 다시 로그인. 공개 가입으로는 관리자를 만들 수 없는 규칙은 그대로이며, 서버 접속 권한이 있는 사람만 지정 가능
- 안 쓸 때 비용 줄이기: 인스턴스 **중지**(고정 IP라 주소는 유지)

## 첫 배포 기록 (2026-10-13)

1. CloudShell에서 `launch.sh` 실행 → t3.small·고정 IP 3.104.31.169 생성.
2. 첫 설치가 백엔드 빌드에서 멈춤: 서버에 `unzip`이 없어 Maven 래퍼가 tar.gz를 받았고, zip용 체크섬과 달라 검증 실패(안전장치 정상 동작). `unzip`을 설치 목록에 추가해 해결. 체크섬 검사는 끄지 않음.
3. 다시 실행 → DB·API·화면·Nginx·Let's Encrypt 완료, `DONE`.
4. 업데이트 스크립트가 자기 자신을 고친 버전으로 다시 실행하도록 수정(옛 버전으로 설치 단계를 지나가던 문제).

## 자동 반영 (보류)

지금은 main에 합쳐도 서버가 자동으로 바뀌지 않습니다. 반영하려면 서버에서 `server-setup.sh`를 직접 실행합니다. 2026-10-13 사용자 결정: 4~5주차가 끝난 뒤 **A안(서버가 5분마다 깃허브를 확인해 스스로 업데이트)**으로 자동 반영을 만듭니다. A안을 고른 이유는 서버 열쇠를 깃허브에 넣거나 22번 포트를 열 필요가 없기 때문입니다. 대신 반영까지 최대 10분이 걸리고, 재시작하는 10~20초 동안 접속이 끊기며, 빌드에 실패해도 알림이 없습니다(이전 버전이 계속 동작). 발표 당일에는 합치지 않습니다.

## Kakao 지도 키 넣기 (4주차)

1. https://developers.kakao.com → 내 애플리케이션 → 앱 추가 → **JavaScript 키** 복사
2. 플랫폼 → Web → 사이트 도메인에 `https://3-104-31-169.sslip.io`, `http://127.0.0.1:5173` 등록 (다른 주소에서는 키가 동작하지 않음)
3. 서버에서 `echo 키 | sudo tee /etc/volink/kakao_js_key` 후 `sudo bash /opt/volink/scripts/aws/server-setup.sh`
4. 로컬은 `frontend/.env.local`에 `VITE_KAKAO_JS_KEY=키` (커밋 안 됨)

키가 없으면 지도 자리에 좌표의 상대 위치만 그린 그림이 나옵니다.
