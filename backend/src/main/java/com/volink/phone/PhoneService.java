package com.volink.phone;

import com.volink.common.ApiException;
import com.volink.common.Sql;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 1인 1계정 (2026-11-22, user decision, V42). A personal account proves one phone number (Firebase phone sign-in in the
 * app); the number is kept only as an HMAC (unique) plus its last 4 digits. 신청 · 모집글 · 글쓰기 need it, except for
 * accounts that existed before (phone_grace_until, 2026-11-29) and for 기관 · 관리자 accounts. When the check is off
 * (no Firebase on the server, or PHONE_REQUIRED=false) nothing is asked.
 */
@Service
public class PhoneService {
    private static final Logger log = LoggerFactory.getLogger(PhoneService.class);
    private final JdbcTemplate jdbc;
    private com.volink.notification.NotificationService notifications;

    @org.springframework.beans.factory.annotation.Autowired
    void setNotifications(com.volink.notification.NotificationService notifications) { this.notifications = notifications; }
    private final PhoneVerifier verifier;
    private final Clock clock;
    private volatile boolean required;
    private final byte[] key;

    public PhoneService(JdbcTemplate jdbc, PhoneVerifier verifier, Clock clock,
                        @Value("${volink.phone.required:true}") boolean required,
                        @Value("${volink.phone.hash-key:}") String hashKey) {
        this.jdbc = jdbc;
        this.verifier = verifier;
        this.clock = clock;
        this.required = required;
        if (hashKey == null || hashKey.isBlank()) {
            log.warn("PHONE_HASH_KEY / JWT_SECRET is not set; phone numbers are hashed with the development key.");
            hashKey = "volink-development-phone-key";
        }
        this.key = hashKey.getBytes(StandardCharsets.UTF_8);
    }

    private LocalDateTime now() { return LocalDateTime.now(clock); }
    /** Tests only: turn the check on or off. */
    public void enforce(boolean on) { this.required = on; }
    public boolean active() { return required && verifier.enabled(); }

    /** +821012345678 / 010-1234-5678 → +821012345678 (Korean numbers); others kept as given digits. */
    static String normalize(String phone) {
        String digits = phone.replaceAll("[^0-9+]", "");
        if (digits.startsWith("+")) return digits;
        if (digits.startsWith("0")) return "+82" + digits.substring(1);
        return "+" + digits;
    }

    String hash(String phone) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(normalize(phone).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    private String proven(String proof) {
        try { return normalize(verifier.verify(proof)); }
        catch (RuntimeException error) { throw new ApiException(HttpStatus.BAD_REQUEST, "PHONE_UNVERIFIED", "휴대폰 인증을 다시 해 주세요."); }
    }

    private static String last4(String phone) { return phone.substring(Math.max(0, phone.length() - 4)); }

    /** For the app: whether to ask, and until when an existing account may wait. */
    public Map<String, Object> status(long userId) {
        Map<String, Object> row = jdbc.queryForMap("SELECT role, member_type, phone_last4, phone_verified_at, phone_grace_until FROM users WHERE id = ?", userId);
        boolean exempt = "ADMIN".equals(row.get("role")) || "INSTITUTION".equals(row.get("member_type"));
        LocalDateTime grace = (LocalDateTime) row.get("phone_grace_until");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("active", active() && !exempt);
        out.put("verified", row.get("phone_last4") != null);
        out.put("last4", row.get("phone_last4"));
        out.put("graceUntil", grace == null ? null : grace.toString().substring(0, 10));
        out.put("required", active() && !exempt && row.get("phone_last4") == null && (grace == null || now().isAfter(grace)));
        out.put("dispute", jdbc.queryForList("SELECT status FROM phone_disputes WHERE user_id = ? ORDER BY id DESC LIMIT 1", String.class, userId).stream().findFirst().orElse(null));
        return out;
    }

    /** 신청 · 모집글 · 글쓰기: stops an account that has to prove a number and has not. */
    public void require(long userId) {
        if (!active()) return;
        Map<String, Object> row = jdbc.queryForList("SELECT role, member_type, phone_hash, phone_grace_until FROM users WHERE id = ?", userId).stream().findFirst().orElse(null);
        if (row == null || "ADMIN".equals(row.get("role")) || "INSTITUTION".equals(row.get("member_type")) || row.get("phone_hash") != null) return;
        LocalDateTime grace = (LocalDateTime) row.get("phone_grace_until");
        if (grace != null && !now().isAfter(grace)) return;
        throw new ApiException(HttpStatus.FORBIDDEN, "PHONE_REQUIRED", "휴대폰 인증 후 이용할 수 있어요.");
    }

    /**
     * 1365 연결 (2026-11-19, user decision): bringing in 1365 records needs a verified phone even during the grace period
     * (the 1365 account will be matched with this number). 기관 · 관리자 accounts never get here.
     */
    public void requireVerified(long userId) {
        if (!active()) return;
        Map<String, Object> row = jdbc.queryForList("SELECT role, member_type, phone_hash FROM users WHERE id = ?", userId).stream().findFirst().orElse(null);
        if (row == null || "ADMIN".equals(row.get("role")) || "INSTITUTION".equals(row.get("member_type")) || row.get("phone_hash") != null) return;
        throw new ApiException(HttpStatus.FORBIDDEN, "PHONE_REQUIRED", "휴대폰 인증 후 1365를 연결할 수 있어요.");
    }

    /** Who holds this number, masked, or null. Used before an e-mail sign-up and when a number is taken. */
    private Map<String, Object> holder(String hash, Long except) {
        Map<String, Object> row = jdbc.queryForList(Sql.kst("""
                SELECT u.id, u.email, DATE_FORMAT(KST(u.created_at), '%Y-%m-%d') AS joinedAt,
                       (SELECT GROUP_CONCAT(s.provider) FROM social_accounts s WHERE s.user_id = u.id) AS providers
                FROM users u WHERE u.phone_hash = ? AND u.status <> 'WITHDRAWN'"""), hash).stream().findFirst().orElse(null);
        if (row == null || (except != null && except.equals(((Number) row.get("id")).longValue()))) return null;
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("email", mask((String) row.get("email")));
        // Only the person who just proved this number gets here: the full address fills the login screen for them
        // ("이 계정으로 로그인"). Kakao / Google placeholder addresses are not sent.
        String email = (String) row.get("email");
        out.put("loginEmail", row.get("providers") == null && email != null && !email.endsWith(".invalid") ? email : null);
        out.put("provider", row.get("providers") == null ? "EMAIL" : ((String) row.get("providers")).split(",")[0]);
        out.put("joinedAt", row.get("joinedAt"));
        return out;
    }

    static String mask(String email) {
        if (email == null || email.endsWith(".invalid")) return null;
        int at = email.indexOf('@');
        if (at <= 0) return null;
        return email.substring(0, Math.min(2, at)) + "***" + email.substring(at);
    }

    /** Before an e-mail sign-up: FREE, or TAKEN with the masked account. */
    public Map<String, Object> check(String proof) {
        Map<String, Object> taken = holder(hash(proven(proof)), null);
        return taken == null ? Map.of("status", "FREE") : Map.of("status", "TAKEN", "account", taken);
    }

    /** At e-mail sign-up, inside its transaction: the proven number goes on the new account (or the sign-up stops). */
    public void attachAtSignup(long userId, String proof) {
        // Without a proof the account is made unverified (older apps, Kakao / Google); require() stops it at 신청 · 글쓰기.
        if (proof == null || proof.isBlank()) return;
        Map<String, Object> result = register(userId, proof);
        if ("TAKEN".equals(result.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "PHONE_TAKEN", "이미 가입된 번호예요.");
    }

    /** 마이 · 신청할 때 · 소셜 가입 뒤: put the proven number on this account. */
    @Transactional
    public Map<String, Object> register(long userId, String proof) {
        String phone = proven(proof), hash = hash(phone);
        Map<String, Object> taken = holder(hash, userId);
        if (taken != null) return Map.of("status", "TAKEN", "account", taken);
        jdbc.update("UPDATE users SET phone_hash = ?, phone_last4 = ?, phone_verified_at = ? WHERE id = ?", hash, last4(phone), now(), userId);
        return Map.of("status", "VERIFIED", "last4", last4(phone));
    }

    /** "제 번호가 아니에요": the number is proven by this person but held by another account; an admin decides. */
    @Transactional
    public Map<String, Object> dispute(long userId, String proof, String note) {
        String phone = proven(proof), hash = hash(phone);
        Long holder = jdbc.queryForList("SELECT id FROM users WHERE phone_hash = ? AND status <> 'WITHDRAWN' AND id <> ?", Long.class, hash, userId).stream().findFirst().orElse(null);
        if (holder == null) return register(userId, proof);
        if (!jdbc.queryForList("SELECT id FROM phone_disputes WHERE user_id = ? AND status = 'OPEN'", Long.class, userId).isEmpty())
            throw new ApiException(HttpStatus.CONFLICT, "DISPUTE_OPEN", "이미 확인을 요청했어요. 결과를 알림으로 알려 드릴게요.");
        String text = note == null ? null : note.trim();
        jdbc.update("INSERT INTO phone_disputes(user_id, holder_id, phone_hash, phone_last4, note, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                userId, holder, hash, last4(phone), text == null || text.isEmpty() ? null : text.substring(0, Math.min(300, text.length())), now());
        return Map.of("status", "DISPUTED");
    }

    /** 관리자 할 일: open disputes, oldest first. */
    public List<Map<String, Object>> openDisputes() {
        return jdbc.queryForList(Sql.kst("""
                SELECT d.id, d.phone_last4 AS last4, d.note, DATE_FORMAT(d.created_at, '%Y-%m-%dT%H:%i') AS createdAt,
                       a.id AS userId, a.display_name AS name, a.email, DATE_FORMAT(KST(a.created_at), '%Y-%m-%d') AS joinedAt,
                       h.id AS holderId, h.display_name AS holderName, h.email AS holderEmail, DATE_FORMAT(KST(h.created_at), '%Y-%m-%d') AS holderJoinedAt,
                       DATE_FORMAT(h.phone_verified_at, '%Y-%m-%d') AS holderVerifiedAt
                FROM phone_disputes d JOIN users a ON a.id = d.user_id JOIN users h ON h.id = d.holder_id
                WHERE d.status = 'OPEN' ORDER BY d.created_at"""));
    }

    /** MOVE: the number leaves the holder (who will be asked again) and goes to the requester. KEEP: nothing moves. */
    @Transactional
    public Map<String, Object> decide(long adminId, long disputeId, String decision, String reason) {
        Map<String, Object> d = jdbc.queryForList("SELECT * FROM phone_disputes WHERE id = ? FOR UPDATE", disputeId).stream().findFirst().orElse(null);
        if (d == null) throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청을 찾을 수 없어요.");
        if (!"OPEN".equals(d.get("status"))) throw new ApiException(HttpStatus.CONFLICT, "ALREADY_HANDLED", "이미 처리한 요청이에요.");
        if (!List.of("MOVE", "KEEP").contains(decision)) throw ApiException.validation(Map.of("decision", "옮기기 또는 유지를 골라 주세요."));
        String why = reason == null ? "" : reason.trim();
        if (why.isEmpty() || why.length() > 300) throw ApiException.validation(Map.of("reason", "처리 사유를 적어 주세요."));
        long user = ((Number) d.get("user_id")).longValue(), holder = ((Number) d.get("holder_id")).longValue();
        if ("MOVE".equals(decision)) {
            jdbc.update("UPDATE users SET phone_hash = NULL, phone_last4 = NULL, phone_verified_at = NULL, phone_grace_until = NULL WHERE id = ? AND phone_hash = ?", holder, d.get("phone_hash"));
            jdbc.update("UPDATE users SET phone_hash = ?, phone_last4 = ?, phone_verified_at = ? WHERE id = ?", d.get("phone_hash"), d.get("phone_last4"), now(), user);
        }
        jdbc.update("UPDATE phone_disputes SET status = ?, handled_by = ?, handled_at = ?, result_note = ? WHERE id = ?", "MOVE".equals(decision) ? "MOVED" : "KEPT", adminId, now(), why, disputeId);
        jdbc.update("INSERT INTO admin_actions(admin_id, target_type, target_id, action, from_status, to_status, reason) VALUES (?, 'USER', ?, ?, 'OPEN', ?, ?)",
                adminId, user, "PHONE_" + decision, "MOVE".equals(decision) ? "MOVED" : "KEPT", why);
        if (notifications != null) {
            String last = (String) d.get("phone_last4");
            notifications.send(user, "SANCTION", "MOVE".equals(decision) ? "번호 확인을 마쳤어요" : "번호를 옮기지 않았어요",
                    ("MOVE".equals(decision) ? "***-" + last + " 번호가 이 계정으로 옮겨졌어요" : "다른 번호로 인증해 주세요") + " · " + why, "#/phone");
            if ("MOVE".equals(decision))
                notifications.send(holder, "SANCTION", "휴대폰 인증을 다시 해 주세요", "***-" + last + " 번호가 다른 계정으로 옮겨졌어요 · " + why, "#/phone");
        }
        return Map.of("status", "MOVE".equals(decision) ? "MOVED" : "KEPT");
    }

    /** A withdrawn account frees its number. */
    public void release(long userId) {
        jdbc.update("UPDATE users SET phone_hash = NULL, phone_last4 = NULL WHERE id = ?", userId);
    }
}
