package com.volink.volunteer;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class VolunteerParsingTest {
    @Test
    void readsItemsAndIgnoresGatewayErrorsAndDoctypes() {
        String ok = "<response><header><resultCode>00</resultCode></header><body><items><item><progrmRegistNo>1</progrmRegistNo><progrmSj> 제목 </progrmSj></item></items></body></response>";
        assertThat(DataGoKrVolunteerApi.items(ok)).hasSize(1).first().satisfies(item -> assertThat(item.get("progrmSj")).isEqualTo("제목"));
        String error = "<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
        assertThat(DataGoKrVolunteerApi.items(error)).isEmpty();
        String xxe = "<?xml version=\"1.0\"?><!DOCTYPE r [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><response><body><items><item><a>&x;</a></item></items></body></response>";
        assertThat(DataGoKrVolunteerApi.items(xxe)).isEmpty();
        assertThat(DataGoKrVolunteerApi.items("not xml")).isEmpty();
        String json = "{\"response\":{\"header\":{\"resultCode\":\"00\"},\"body\":{\"items\":{\"item\":[{\"progrmRegistNo\":\"7\",\"progrmSj\":\"제목\"}]}}}}";
        assertThat(DataGoKrVolunteerApi.items(json)).hasSize(1).first().satisfies(item -> assertThat(item.get("progrmRegistNo")).isEqualTo("7"));
        String one = "{\"response\":{\"body\":{\"items\":{\"item\":{\"progrmRegistNo\":\"8\"}}}}}";
        assertThat(DataGoKrVolunteerApi.items(one)).hasSize(1);
        assertThat(DataGoKrVolunteerApi.items("SERVICE KEY IS NOT REGISTERED ERROR.")).isEmpty();
    }

    @Test
    void formatsTimesWeekdaysAndStatus() {
        assertThat(VolunteerService.hour("9")).isEqualTo("09:00");
        assertThat(VolunteerService.hour("0930")).isEqualTo("09:30");
        assertThat(VolunteerService.hour("14:00")).isEqualTo("14:00");
        assertThat(VolunteerService.weekdays("1111100")).isEqualTo("월 화 수 목 금");
        assertThat(VolunteerService.weekdays("주말")).isEqualTo("주말");
        assertThat(VolunteerService.status("2")).isEqualTo("모집중");
        assertThat(RegionCodes.of("경기도", "양주시")).hasValueSatisfying(c -> assertThat(c.city()).isEqualTo("5590000"));
        assertThat(RegionCodes.of("경기도", "수원시 영통구")).hasValueSatisfying(c -> assertThat(c.city()).isEqualTo("3740000"));
        assertThat(RegionCodes.of("부산광역시", "해운대구")).hasValueSatisfying(c -> assertThat(c.city()).isNull());
    }
}
