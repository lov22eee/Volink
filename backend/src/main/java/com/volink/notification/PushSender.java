package com.volink.notification;

/** Sends one phone notification. The real one is {@link FcmPushSender}; tests use a fake. */
public interface PushSender {
    enum Result { SENT, GONE, FAILED }

    /** False when the server has no Firebase key: nothing is sent and nothing pretends to be. */
    boolean enabled();

    /** {@code link} is the app route (#/activity/12) opened when the notification is tapped. */
    Result send(String token, String title, String body, String link);
}
