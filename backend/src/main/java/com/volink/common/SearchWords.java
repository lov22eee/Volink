package com.volink.common;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Search words (2026-11-06): what people type is not what the posts say ("강아지" vs "유기견 보호소 산책"). A typed word that
 * belongs to a group also finds the group's other words, and a group can point to one of the 7 categories. Used by Volink
 * activity search and by the 1365 list (whose gateway ignores the keyword, so results are filtered here).
 */
public final class SearchWords {
    private record Group(String category, List<String> words) {}

    private static final List<Group> GROUPS = List.of(
            new Group("동물", List.of("강아지", "반려견", "유기견", "반려동물", "동물", "고양이", "유기묘", "보호소", "유기동물", "애견", "펫")),
            new Group("복지", List.of("어르신", "노인", "경로당", "요양", "실버", "독거")),
            new Group("복지", List.of("배식", "급식", "도시락", "무료급식", "반찬", "밑반찬", "식사")),
            new Group("복지", List.of("장애인", "장애", "발달장애", "휠체어")),
            new Group("교육", List.of("아이", "아동", "어린이", "청소년", "학생", "공부방", "멘토링", "멘토", "학습지도", "독서")),
            new Group("환경", List.of("쓰레기", "플로깅", "줍깅", "쓰담", "하천", "정화", "분리수거", "환경정화")),
            new Group("문화·예술", List.of("공연", "전시", "미술", "음악", "축제", "도서관")),
            new Group("지역사회", List.of("마을", "방범", "캠페인", "벼룩시장", "장터")));

    private SearchWords() {}

    private static String norm(String value) { return value == null ? "" : value.replaceAll("\\s+", "").toLowerCase(Locale.ROOT); }

    /** The typed word first, then the other words of each group it belongs to (at most 12). */
    public static List<String> expand(String q) {
        String typed = q == null ? "" : q.trim();
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (typed.isEmpty()) return List.of();
        out.add(typed);
        String key = norm(typed);
        for (Group g : GROUPS) if (g.words().stream().anyMatch(w -> key.contains(norm(w)) || norm(w).equals(key))) out.addAll(g.words());
        return new ArrayList<>(out).subList(0, Math.min(out.size(), 12));
    }

    private static final List<String> CATEGORIES = List.of("환경", "교육", "복지", "문화·예술", "동물", "지역사회");

    /**
     * The whole category a typed word stands for: a category name itself, or an animal word (강아지 → 동물). Other words only
     * widen the words (쓰레기 finds 플로깅·정화, not every 환경 activity).
     */
    public static Optional<String> category(String q) {
        String key = norm(q).replace("·", "");
        if (key.isEmpty()) return Optional.empty();
        for (String c : CATEGORIES) if (norm(c).replace("·", "").equals(key)) return Optional.of(c);
        if (GROUPS.get(0).words().stream().anyMatch(w -> key.contains(norm(w)))) return Optional.of("동물");
        return Optional.empty();
    }

    /** True when any of the words is in the text (spaces ignored). */
    public static boolean matches(String text, List<String> words) {
        String t = norm(text);
        return words.stream().anyMatch(w -> !norm(w).isEmpty() && t.contains(norm(w)));
    }
}
