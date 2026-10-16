package com.volink.participation;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Every minute: expire unanswered offers, offer the seat to the next person, close waitlists 2 h before start. Off in tests. */
@Component
@EnableScheduling
@ConditionalOnProperty(name = "volink.scheduler.enabled", havingValue = "true", matchIfMissing = true)
public class ParticipationScheduler {
    private final ParticipationService participations;

    public ParticipationScheduler(ParticipationService participations) {
        this.participations = participations;
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
    public void expire() {
        participations.expireDue();
    }
}
