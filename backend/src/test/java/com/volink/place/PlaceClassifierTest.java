package com.volink.place;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

/** Kakao category → OPEN / REVIEW / BLOCKED (docs/rules.md 장소 분류). */
class PlaceClassifierTest {
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "여행 > 공원 > 도시근린공원|AT4|옥정호수공원|OPEN|공원",
            "음식점 > 카페|CE7|동네카페|OPEN|카페",
            "음식점 > 한식|FD6|김밥집|OPEN|음식점",
            "사회,공공기관 > 행정기관 > 행정복지센터|PO3|옥정동행정복지센터|OPEN|공공기관",
            "교육,학문 > 도서관|CT1|덕정도서관|OPEN|도서관·문화시설",
            "의료,건강 > 병원 > 요양병원|HP8|행복요양병원|OPEN|요양·복지시설",
            "사회,공공기관 > 사회복지 > 노인복지시설||양주노인복지관|OPEN|요양·복지시설",
            "가정,생활 > 반려동물 > 애견카페|CE7|멍멍카페|OPEN|반려동물 시설",
            "여행 > 공원 > 반려견놀이터||반려견 놀이터|OPEN|반려동물 시설",
            "교육,학문 > 학교 > 초등학교|SC4|옥정초등학교|OPEN|학교·어린이집",
            "교통,수송 > 자동차 > 주유,가스 > 주유소|OL7|SK주유소|BLOCKED|주유소·충전소",
            "음식점 > 술집 > 호프,요리주점|FD6|동네호프|BLOCKED|술집·유흥시설",
            "가정,생활 > 생활용품|| 생활용품점|REVIEW|확인이 필요한 장소",
    })
    void classifiesByCategory(String category, String group, String name, String level, String label) {
        PlaceClassifier.Result result = PlaceClassifier.classify(category, group, name);
        assertThat(result.level().name()).isEqualTo(level);
        assertThat(result.label()).isEqualTo(label);
    }
}
