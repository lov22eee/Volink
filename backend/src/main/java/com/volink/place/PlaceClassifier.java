package com.volink.place;

import java.util.List;
import java.util.Locale;

/**
 * Decides from Kakao's category (and, for risky words, the place name) whether an activity there is published as usual (OPEN),
 * checked by an admin first (REVIEW) or refused (BLOCKED). First matching rule wins; BLOCKED rules come first.
 * Known kinds of place are public and busy, so they open (the activity's own words are still checked for risk);
 * only a place Kakao cannot tell us about is REVIEW (user decision 2026-10-25).
 */
public final class PlaceClassifier {
    public enum Level { OPEN, REVIEW, BLOCKED }

    public record Result(Level level, String label) {}

    private record Rule(Level level, String label, List<String> words, boolean nameToo) {}

    private static final List<Rule> RULES = List.of(
            new Rule(Level.BLOCKED, "주유소·충전소", List.of("주유소", "충전소", "lpg"), true),
            new Rule(Level.BLOCKED, "술집·유흥시설", List.of("술집", "주점", "호프", "유흥", "나이트", "단란"), true),
            new Rule(Level.BLOCKED, "숙박업소", List.of("모텔", "여관"), true),
            new Rule(Level.BLOCKED, "위험 시설", List.of("사격", "카지노", "성인용품", "군부대", "교도소", "공사현장"), true),
            new Rule(Level.OPEN, "요양·복지시설", List.of("요양", "노인복지", "복지관", "복지시설", "장애인", "아동센터", "보육"), true),
            new Rule(Level.OPEN, "병원·약국", List.of("병원", "의원", "의료", "약국", "보건"), true),
            new Rule(Level.OPEN, "반려동물 시설", List.of("반려", "애견", "애완", "동물"), true),
            new Rule(Level.OPEN, "학교·어린이집", List.of("학교", "어린이집", "유치원", "학원"), true),
            new Rule(Level.OPEN, "종교시설", List.of("종교", "교회", "성당", "사찰"), false),
            new Rule(Level.OPEN, "주거·숙박시설", List.of("아파트", "주거", "숙박", "호텔", "펜션", "캠핑"), false),
            new Rule(Level.OPEN, "물가·산업시설", List.of("수영", "물놀이", "해수욕", "계곡", "저수지", "공장", "산업", "주차장"), false),
            new Rule(Level.OPEN, "공원", List.of("공원", "광장", "산책", "둘레길", "수목원", "하천", "천변"), false),
            new Rule(Level.OPEN, "도서관·문화시설", List.of("도서관", "문화", "박물관", "미술관", "전시"), false),
            new Rule(Level.OPEN, "공공기관", List.of("공공기관", "행정", "주민센터", "복합청사", "시청", "구청", "자원봉사센터"), false),
            new Rule(Level.OPEN, "관광명소", List.of("관광", "명소", "여행"), false),
            new Rule(Level.OPEN, "카페", List.of("카페", "제과"), false),
            new Rule(Level.OPEN, "음식점", List.of("음식점"), false),
            new Rule(Level.OPEN, "체육시설", List.of("운동장", "체육", "스포츠"), false));

    private PlaceClassifier() {}

    public static Result classify(String categoryName, String categoryGroup, String name) {
        String category = (categoryName == null ? "" : categoryName).toLowerCase(Locale.ROOT) + " ";
        String place = (name == null ? "" : name).toLowerCase(Locale.ROOT);
        String group = categoryGroup == null ? "" : categoryGroup;
        if (group.equals("OL7")) return new Result(Level.BLOCKED, "주유소·충전소");
        for (Rule rule : RULES)
            for (String word : rule.words())
                if (category.contains(word) || rule.nameToo() && place.contains(word.trim())) return new Result(rule.level(), rule.label());
        return switch (group) {
            case "HP8", "PM9" -> new Result(Level.OPEN, "병원·약국");
            case "SC4", "PS3", "AC5" -> new Result(Level.OPEN, "학교·어린이집");
            case "AD5" -> new Result(Level.OPEN, "주거·숙박시설");
            case "AT4" -> new Result(Level.OPEN, "관광명소");
            case "CT1" -> new Result(Level.OPEN, "도서관·문화시설");
            case "PO3" -> new Result(Level.OPEN, "공공기관");
            case "CE7" -> new Result(Level.OPEN, "카페");
            case "FD6" -> new Result(Level.OPEN, "음식점");
            default -> new Result(Level.REVIEW, "확인이 필요한 장소");
        };
    }
}
