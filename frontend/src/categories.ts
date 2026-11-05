// The 7 activity categories (V17, 2026-11-05) for the whole service, in the order the server sorts them.
// Old ones: 환경 정화 → 환경, 생활 지원 → 복지, 지역 돌봄 → 복지 (stored in category_changes_v17).
export const categories: string[] = ['환경', '교육', '복지', '문화·예술', '동물', '지역사회', '기타']

/** Tone number for the app's coloured icon boxes (`f1` … `f7`); 0 when unknown. */
export const categoryTone = (name: string | null | undefined) => categories.indexOf(name ?? '') + 1

/** One short line under each category in the create form. */
export const categoryHint: Record<string, string> = {
  환경: '공원·거리 정리, 화단 가꾸기, 플로깅',
  교육: '학습 도움, 독서·멘토링',
  복지: '어르신·이웃 돌봄, 나눔·배식',
  '문화·예술': '행사 진행 돕기, 전시·공연 안내',
  동물: '보호소 산책·청소 돕기',
  지역사회: '마을 행사, 안전·방범 캠페인, 나눔 장터',
  기타: '위에 맞는 분야가 없을 때',
}
