package com.volink.volunteer;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** 행정안전부 봉사참여정보서비스 (data.go.kr, 1365). Items are plain field-name → text maps exactly as the API returns them. */
public interface VolunteerApi {
    boolean enabled();

    /** getVltrAreaList: programs in a province (and city/district when known). Empty on any failure. */
    List<Map<String, String>> areaList(String provinceCode, String cityCode, String keyword, int rows);

    /** getVltrPartcptnItem: one program's detail. */
    Optional<Map<String, String>> detail(String programNo);
}
