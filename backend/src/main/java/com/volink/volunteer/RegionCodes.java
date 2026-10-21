package com.volink.volunteer;

import java.util.Map;
import java.util.Optional;

/**
 * 1365 region codes (행정표준기관코드) for schSido / schSign1. The API's own sample uses 6110000 (서울) / 3020000 (용산구).
 * City/district codes are listed for Seoul and Gyeonggi (around the service area); elsewhere the province code alone is
 * sent and the nearest programs are picked by distance. Codes are checked against the live API with
 * GET /api/admin/volunteer-programs/check (docs/deploy.md); fix a wrong code here.
 */
final class RegionCodes {
    private static final Map<String, String> PROVINCES = Map.ofEntries(
            Map.entry("서울", "6110000"), Map.entry("부산", "6260000"), Map.entry("대구", "6270000"), Map.entry("인천", "6280000"),
            Map.entry("광주", "6290000"), Map.entry("대전", "6300000"), Map.entry("울산", "6310000"), Map.entry("세종", "5690000"),
            Map.entry("경기", "6410000"), Map.entry("강원", "6530000"), Map.entry("충북", "6430000"), Map.entry("충청북", "6430000"),
            Map.entry("충남", "6440000"), Map.entry("충청남", "6440000"), Map.entry("전북", "6540000"), Map.entry("전라북", "6540000"),
            Map.entry("전남", "6460000"), Map.entry("전라남", "6460000"), Map.entry("경북", "6470000"), Map.entry("경상북", "6470000"),
            Map.entry("경남", "6480000"), Map.entry("경상남", "6480000"), Map.entry("제주", "6500000"));

    private static final Map<String, String> SEOUL = Map.ofEntries(
            Map.entry("종로구", "3000000"), Map.entry("중구", "3010000"), Map.entry("용산구", "3020000"), Map.entry("성동구", "3030000"),
            Map.entry("광진구", "3040000"), Map.entry("동대문구", "3050000"), Map.entry("중랑구", "3060000"), Map.entry("성북구", "3070000"),
            Map.entry("강북구", "3080000"), Map.entry("도봉구", "3090000"), Map.entry("노원구", "3100000"), Map.entry("은평구", "3110000"),
            Map.entry("서대문구", "3120000"), Map.entry("마포구", "3130000"), Map.entry("양천구", "3140000"), Map.entry("강서구", "3150000"),
            Map.entry("구로구", "3160000"), Map.entry("금천구", "3170000"), Map.entry("영등포구", "3180000"), Map.entry("동작구", "3190000"),
            Map.entry("관악구", "3200000"), Map.entry("서초구", "3210000"), Map.entry("강남구", "3220000"), Map.entry("송파구", "3230000"),
            Map.entry("강동구", "3240000"));

    private static final Map<String, String> GYEONGGI = Map.ofEntries(
            Map.entry("수원시", "3740000"), Map.entry("성남시", "3780000"), Map.entry("의정부시", "3820000"), Map.entry("안양시", "3830000"),
            Map.entry("부천시", "3860000"), Map.entry("광명시", "3900000"), Map.entry("평택시", "3910000"), Map.entry("동두천시", "3920000"),
            Map.entry("안산시", "3930000"), Map.entry("고양시", "3940000"), Map.entry("과천시", "3970000"), Map.entry("구리시", "3980000"),
            Map.entry("남양주시", "3990000"), Map.entry("오산시", "4000000"), Map.entry("시흥시", "4010000"), Map.entry("군포시", "4020000"),
            Map.entry("의왕시", "4030000"), Map.entry("하남시", "4040000"), Map.entry("용인시", "4050000"), Map.entry("파주시", "4060000"),
            Map.entry("이천시", "4070000"), Map.entry("안성시", "4080000"), Map.entry("김포시", "4090000"), Map.entry("화성시", "5530000"),
            Map.entry("광주시", "5540000"), Map.entry("양주시", "5590000"), Map.entry("포천시", "5600000"), Map.entry("여주시", "5700000"),
            Map.entry("연천군", "4140000"), Map.entry("가평군", "4160000"), Map.entry("양평군", "4170000"));

    record Codes(String province, String city) {}

    private RegionCodes() {}

    /** province like "경기도"/"서울특별시"/"강원특별자치도", city like "양주시" or "수원시 영통구". */
    static Optional<Codes> of(String province, String city) {
        if (province == null || province.isBlank()) return Optional.empty();
        String provinceCode = PROVINCES.entrySet().stream().filter(entry -> province.startsWith(entry.getKey()))
                .map(Map.Entry::getValue).findFirst().orElse(null);
        if (provinceCode == null) return Optional.empty();
        String first = city == null || city.isBlank() ? "" : city.trim().split("\\s+")[0];
        Map<String, String> cities = provinceCode.equals("6110000") ? SEOUL : provinceCode.equals("6410000") ? GYEONGGI : Map.of();
        return Optional.of(new Codes(provinceCode, cities.get(first)));
    }
}
