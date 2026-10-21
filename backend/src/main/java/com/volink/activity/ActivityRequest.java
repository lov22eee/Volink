package com.volink.activity;

import com.volink.place.PlaceSearchService;
import java.util.List;

/** placeId = an admin-entered place; place = a place picked from Kakao search (signed by the server). One of the two. */
public record ActivityRequest(String activityType, String title, String category, Long placeId, String date, String time,
                              Integer capacity, Integer durationMinutes, String description, Boolean safetyConfirmed,
                              PlaceSearchService.Choice place, String meetingPoint, List<Supply> supplies) {
    /** Something to bring; provided = the organizer brings it for everyone. */
    public record Supply(String name, Boolean provided) {}
}
