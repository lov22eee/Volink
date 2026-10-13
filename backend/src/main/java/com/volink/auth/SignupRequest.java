package com.volink.auth;

import java.util.List;

/** Any "role" field sent by a client is ignored: signup always creates a USER. */
public record SignupRequest(String memberType, String name, String email, String password, String birthDate,
                            List<String> interests, String organizationName, String organizationContact,
                            Boolean agreedNotice) {}
