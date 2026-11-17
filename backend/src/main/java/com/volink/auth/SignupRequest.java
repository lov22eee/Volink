package com.volink.auth;

import java.util.List;

/** Any "role" field sent by a client is ignored: signup always creates a USER. */
public record SignupRequest(String memberType, String name, String email, String password, String birthDate,
                            List<String> interests, String organizationName, String organizationContact,
                            Boolean agreedNotice, String organizationType, String organizationAddress,
                            Boolean vmsRegistered, String vmsCode, String phoneProof) {
    /** Before 1인 1계정 (V42): no phone proof. */
    public SignupRequest(String memberType, String name, String email, String password, String birthDate,
                         List<String> interests, String organizationName, String organizationContact,
                         Boolean agreedNotice, String organizationType, String organizationAddress,
                         Boolean vmsRegistered, String vmsCode) {
        this(memberType, name, email, password, birthDate, interests, organizationName, organizationContact, agreedNotice,
                organizationType, organizationAddress, vmsRegistered, vmsCode, null);
    }
    /** The web form and older clients: the four organization profile fields (V23) are optional. */
    public SignupRequest(String memberType, String name, String email, String password, String birthDate,
                         List<String> interests, String organizationName, String organizationContact, Boolean agreedNotice) {
        this(memberType, name, email, password, birthDate, interests, organizationName, organizationContact, agreedNotice, null, null, null, null);
    }
}
