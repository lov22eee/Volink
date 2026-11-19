package com.volink.phone;

/** Turns the app's proof of a verified phone (a Firebase ID token) into the number, E.164 (+8210…). */
public interface PhoneVerifier {
    boolean enabled();

    /** The verified number, or an exception when the proof is not valid. */
    String verify(String proof);
}
