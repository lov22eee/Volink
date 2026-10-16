package com.volink.participation;

import com.volink.checkin.CheckInService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Every minute: expire unanswered offers, offer the seat to the next person, close waitlists 2 h before start (week 5);
 * start and finish activities and mark confirmed people who never checked in as no-shows (week 6). Off in tests.
 */
@Component
@EnableScheduling
@ConditionalOnProperty(name = "volink.scheduler.enabled", havingValue = "true", matchIfMissing = true)
public class ParticipationScheduler {
    private final ParticipationService participations;
    private final CheckInService checkIns;

    public ParticipationScheduler(ParticipationService participations, CheckInService checkIns) {
        this.participations = participations;
        this.checkIns = checkIns;
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
    public void expire() {
        participations.expireDue();
        checkIns.advance();
    }
}
