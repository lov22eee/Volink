export type Place = { id: number; name: string; area: string; addressNote: string; coordinateStatus: string }
export type Persona = { code: string; displayName: string; role: 'ORGANIZER' | 'PARTICIPANT' | 'ADMIN' }
export type Activity = { id: number; title: string; description: string; category: string; placeId: number; placeName: string; startTime: string; durationMinutes: number; capacity: number; confirmed: number }
export type Catalog = { demo: boolean; baseDate: string; places: Place[]; personas: Persona[]; activities: Activity[]; notice: string }
export type ProjectStatus = { week: number; database: string; authenticationImplemented: boolean; mapIntegrated: boolean }

declare global {
  interface Window {
    __VOLINK_UI_DEMO__?: { catalog: Catalog }
  }
}

export const weekOne = [
  { area: '화면', items: ['React·Vite 개발환경 구성', '참가자·모집자·관리자 화면 흐름도', '주요 화면 UI 초안 및 발표 화면'] },
  { area: '서버', items: ['Spring Boot·MySQL 개발환경 구성', '핵심 테이블·ERD 초안', '사용자 역할·소유권 기반 권한 초안'] },
  { area: '데이터', items: ['양주 공공장소 후보 3곳 선정', '모집자 2·참가자 6·관리자 1 페르소나 정의', '시연 데이터 항목·DB 연결 검증'] },
]
export const roadmap = [
  ['01', '개발 기반과 화면 설계', '환경 · ERD · UI 초안'],
  ['02', '명세와 데이터 확정', 'API · 상태 전이 · 권한표'],
  ['03', '인증과 활동 개설', '로그인 · 개설 · 위험도'],
  ['04', '위치 검색과 첫 배포', '지도 · 반경 검색 · HTTPS'],
  ['05', '신청과 대기열', '정원 잠금 · 승격 제안'],
  ['06', '현장 체크인', 'QR · 시간 · 위치 검증'],
  ['07', '완료와 안전 관리', '기록 · 신고 · 관리자'],
  ['08', '통합 검증과 최종 시연', '회귀 테스트 · 운영 문서'],
]
export const roleFlows = {
  '참가자': ['주변 활동 탐색', '활동 상세 확인', '참가 신청', '승인 또는 대기', '현장 체크인', '완료 기록 확인'],
  '모집자': ['활동 정보 입력', '안전 안내 확인', '위험도 검사', '신청 승인·정원 관리', 'QR·출석 관리', '활동 완료 확인'],
  '관리자': ['검토 대상 조회', 'REVIEW 활동 검토', '신고·증빙 확인', '기록 보류·조치', '사유·처리 로그 저장'],
}
