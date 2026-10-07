# GitHub에서 현재 서비스 화면 공개하기

AWS 계정 없이 현재 React UI를 주소로 열 수 있도록 수동 실행 워크플로를 준비했습니다. 소스·환경 변수·DB를 사이트에 올리지 않고, 공개 시연 데이터를 포함하는 HTML 하나만 게시합니다.

## 현재 전달 상태

2026-10-08 한국 시간 기준 소스·단일 HTML·배포 워크플로를 main에 푸시했으며 원격 커밋 `3c7ada5`를 확인했습니다. 브라우저 테스트 11개가 통과했습니다. Git 저장소 접근은 동작하지만 GitHub Pages 설정 API 요청은 `Forbidden`으로 차단되어 Pages 활성화와 실제 공개 URL 검증은 완료하지 못했습니다. 다음 두 설정은 저장소 소유자가 GitHub 화면에서 진행합니다. 채팅으로 인증키를 전달할 필요는 없습니다.

## 처음 공개하는 순서

1. 이 변경이 저장소 main에 푸시되어 있는지 확인합니다.
2. [저장소 Pages 설정](https://github.com/lov22eee/Volink/settings/pages)에서 **Build and deployment → Source**를 **GitHub Actions**로 선택합니다.
3. [Publish service UI 워크플로](https://github.com/lov22eee/Volink/actions/workflows/pages.yml)의 **Run workflow**에서 main을 선택해 실행합니다.
4. 워크플로가 성공하면 배포 주소를 눌러 화면을 엽니다. 일반적인 주소는 `https://lov22eee.github.io/Volink/`이며 실제 성공 결과에 표시된 주소가 기준입니다.

공개 주소는 누구나 볼 수 있습니다. 비공개 저장소의 Pages 사용 가능 여부는 GitHub 요금제·설정에 따라 다릅니다. 사용할 수 없으면 저장소를 무단으로 공개 전환하지 않습니다.

이 워크플로는 **수동 실행만** 하며 main에 푸시하는 것만으로 배포하지 않습니다. 현재 실제 배포·주소 접속은 검증하지 않았습니다. 화면 업데이트 후 다시 Run workflow로 게시합니다.

## 공개 화면의 범위

홈·검색 필터·활동 상세·활동 만들기 입력 검증·사용자 흐름·개발 현황입니다. 로그인·활동 저장·신청·지도·체크인은 이후 개발 범위이며 화면에서도 이를 표시합니다. 현재 목적은 지금까지 만든 UI를 발표 때 직접 눌러 보여주는 것입니다.
