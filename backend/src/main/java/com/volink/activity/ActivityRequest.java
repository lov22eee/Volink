package com.volink.activity;

public record ActivityRequest(String activityType, String title, String category, Long placeId, String date, String time,
                              Integer capacity, Integer durationMinutes, String description, Boolean safetyConfirmed) {}
