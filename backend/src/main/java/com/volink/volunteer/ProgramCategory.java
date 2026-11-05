package com.volink.volunteer;

import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 1365 program → one of Volink's 7 categories (V17).
 * <ol>
 *   <li>OFFICIAL: the program's own service field (srvcClCode, stored as {@code field}) names a known 1365 field.</li>
 *   <li>ESTIMATED: no usable field, but words in the title point to one category (a guess; shown as such).</li>
 *   <li>UNKNOWN: neither → 기타, so a program is never hidden by a wrong guess under some other category.</li>
 * </ol>
 * The 1365 field names below are the categories shown on 1365 (생활편의지원, 주거환경, …). The live value format of
 * srvcClCode is not confirmed yet (this environment cannot reach data.go.kr): a value that matches none falls back to
 * the title, and the admin check page lists the live field names.
 */
public final class ProgramCategory {
    public record Result(String category, String basis) {}

    private static final Map<String, String> OFFICIAL = Map.ofEntries(
            Map.entry("환경보호", "환경"),
            Map.entry("교육", "교육"), Map.entry("멘토링", "교육"),
            Map.entry("생활편의지원", "복지"), Map.entry("주거환경", "복지"), Map.entry("상담", "복지"), Map.entry("보건의료", "복지"),
            Map.entry("문화행사", "문화·예술"), Map.entry("문화", "문화·예술"),
            Map.entry("행정보조", "지역사회"), Map.entry("안전예방", "지역사회"), Map.entry("공익인권", "지역사회"),
            Map.entry("재해재난", "지역사회"), Map.entry("농어촌봉사", "지역사회"),
            Map.entry("국제협력", "기타"), Map.entry("해외봉사", "기타"));

    /** Title words, checked in this order (동물 first: "유기견 보호소 환경 정리" is about animals). */
    private static final List<Map.Entry<String, Pattern>> WORDS = List.of(
            Map.entry("동물", Pattern.compile("동물|유기견|유기묘|반려|보호소|길고양이|강아지|고양이")),
            Map.entry("환경", Pattern.compile("환경|정화|플로깅|쓰레기|숲|하천|공원|생태|분리수거|나무|꽃")),
            Map.entry("교육", Pattern.compile("교육|멘토|학습|공부|교실|도서|독서|코딩|과외|방과후")),
            Map.entry("문화·예술", Pattern.compile("문화|예술|공연|전시|축제|음악|미술|박물관|행사")),
            Map.entry("복지", Pattern.compile("노인|어르신|장애|돌봄|말벗|요양|복지관|병원|호스피스|배식|급식|도시락|김장|목욕|빨래|생활지원")),
            Map.entry("지역사회", Pattern.compile("지역|마을|주민|방범|순찰|안전|교통|캠페인|행정|재난|농촌|어촌")));

    private ProgramCategory() {}

    public static Result of(String field, String title) {
        if (field != null && !field.isBlank()) {
            String compact = field.replaceAll("\\s+", "");
            for (Map.Entry<String, String> entry : OFFICIAL.entrySet())
                if (compact.contains(entry.getKey())) return new Result(entry.getValue(), "OFFICIAL");
            if (compact.contains("기타")) return new Result("기타", "OFFICIAL");
        }
        String text = title == null ? "" : title;
        for (Map.Entry<String, Pattern> words : WORDS)
            if (words.getValue().matcher(text).find()) return new Result(words.getKey(), "ESTIMATED");
        return new Result("기타", "UNKNOWN");
    }
}
