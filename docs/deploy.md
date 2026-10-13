# 서버 배포 (4주차 '첫 배포'를 3주차 발표 전에 앞당김)

2026-10-13 준비. 3주차 발표에서 로그인·활동 저장을 주소로 라이브 시연하려고 4주차 계획 중 **서버 배포만** 먼저 합니다. 지도·반경 검색은 4주차 그대로입니다.

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
- 안 쓸 때 비용 줄이기: 인스턴스 **중지**(고정 IP라 주소는 유지)
