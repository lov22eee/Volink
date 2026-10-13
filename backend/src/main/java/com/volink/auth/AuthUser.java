package com.volink.auth;

public record AuthUser(long id, String email, String displayName, String role, String memberType, String status) {
    public boolean admin() { return "ADMIN".equals(role); }
    public boolean canWrite() { return "ACTIVE".equals(status); }
}
