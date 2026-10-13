package com.volink.common;

import java.time.Clock;
import java.time.ZoneId;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TimeConfig {
    public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    @Bean
    Clock clock() {
        return Clock.system(SEOUL);
    }
}
