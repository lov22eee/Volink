// Regions for the find filter. 시·도 nationwide; 시·군·구 for Seoul and Gyeonggi, where 1365 district codes are known
// (backend RegionCodes) — elsewhere only the whole province can be chosen.
export const provinces = ['서울특별시', '경기도', '인천광역시', '부산광역시', '대구광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시',
  '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도']

export const districts: Record<string, string[]> = {
  서울특별시: ['종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구', '강북구', '도봉구', '노원구', '은평구', '서대문구', '마포구',
    '양천구', '강서구', '구로구', '금천구', '영등포구', '동작구', '관악구', '서초구', '강남구', '송파구', '강동구'],
  경기도: ['수원시', '성남시', '의정부시', '안양시', '부천시', '광명시', '평택시', '동두천시', '안산시', '고양시', '과천시', '구리시', '남양주시', '오산시',
    '시흥시', '군포시', '의왕시', '하남시', '용인시', '파주시', '이천시', '안성시', '김포시', '화성시', '광주시', '양주시', '포천시', '여주시', '연천군', '가평군', '양평군'],
}

/** "서울특별시" → "서울" for short labels. */
export const shortProvince = (name: string) => name.replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, '').replace(/^(충청|전라|경상)(북|남)$/, (_, a: string, b: string) => a[0] + b)
