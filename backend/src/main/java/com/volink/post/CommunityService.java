package com.volink.post;

import com.volink.auth.AuthService;
import com.volink.auth.AuthUser;
import com.volink.common.ApiException;
import com.volink.common.Sql;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 커뮤니티 (week 6 app, 2026-11-05): 자유 · 질문 · 봉사후기. Any member reads; members who may write post and comment.
 * A review must name an activity the author completed (shown as "참여 확인"). Names are partly hidden, contact details
 * are refused (same rule as 활동 소식), 10 posts a day and 30 comments an hour per person. No example posts are stored.
 */
@Service
public class CommunityService {
    static final List<String> CATEGORIES = List.of("FREE", "QUESTION", "REVIEW");
    static final int TITLE_MAX = 60, BODY_MAX = 2000, COMMENT_MAX = 500, POSTS_PER_DAY = 10, COMMENTS_PER_HOUR = 30;

    private final JdbcTemplate jdbc;
    private final AuthService auth;
    private final NotificationService notifications;
    private final Clock clock;

    public CommunityService(JdbcTemplate jdbc, AuthService auth, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.auth = auth;
        this.notifications = notifications;
        this.clock = clock;
    }

    private static final String COLUMNS = """
            p.id, p.category, p.title, p.body, p.author_id AS authorId, u.display_name AS name, u.community_nickname AS nickname, a.id AS activityId, (p.activity_id IS NOT NULL) AS reviewed,
            a.title AS activityTitle, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS activityDate,
            DATE_FORMAT(KST(p.created_at), '%Y-%m-%dT%H:%i') AS createdAt,
            (SELECT COUNT(*) FROM community_likes l WHERE l.post_id = p.id) AS likes,
            (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comments,
            EXISTS (SELECT 1 FROM community_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
            FROM community_posts p JOIN users u ON u.id = p.author_id LEFT JOIN activities a ON a.id = p.activity_id AND a.status <> 'DELETED'
            """;

    /** sort = latest (default) or popular (likes, then comments, then newest). Up to 50. */
    public List<Map<String, Object>> list(long viewerId, String category, String sort) {
        boolean filter = category != null && CATEGORIES.contains(category);
        String order = "popular".equals(sort) ? "likes DESC, comments DESC, p.created_at DESC, p.id DESC" : "p.created_at DESC, p.id DESC";
        List<Map<String, Object>> rows = jdbc.queryForList(Sql.kst("SELECT " + COLUMNS + " WHERE p.deleted_at IS NULL" + (filter ? " AND p.category = ?" : "") + " ORDER BY " + order + " LIMIT 50"),
                filter ? new Object[]{viewerId, category} : new Object[]{viewerId});
        rows.forEach(row -> {
            String body = (String) row.remove("body");
            row.put("preview", body.length() > 80 ? body.substring(0, 80) + "…" : body);
            shape(row, viewerId);
        });
        return rows;
    }

    public Map<String, Object> detail(long viewerId, long id) {
        Map<String, Object> post = jdbc.queryForList(Sql.kst("SELECT " + COLUMNS + " WHERE p.id = ? AND p.deleted_at IS NULL"), viewerId, id)
                .stream().findFirst().orElseThrow(CommunityService::notFound);
        shape(post, viewerId);
        Long organizer = post.get("activityId") == null ? null
                : jdbc.queryForObject("SELECT organizer_id FROM activities WHERE id = ?", Long.class, post.get("activityId"));
        List<Map<String, Object>> comments = jdbc.queryForList(Sql.kst("""
                SELECT c.id, c.body, c.author_id AS authorId, u.display_name AS name, u.community_nickname AS nickname, DATE_FORMAT(KST(c.created_at), '%Y-%m-%dT%H:%i') AS createdAt
                FROM community_comments c JOIN users u ON u.id = c.author_id WHERE c.post_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at, c.id
                """), id);
        comments.forEach(comment -> {
            long author = ((Number) comment.remove("authorId")).longValue();
            comment.put("author", shown(comment));
            comment.put("mine", author == viewerId);
            comment.put("organizer", organizer != null && organizer == author);
            comment.put("postAuthor", author == ((Number) post.get("authorIdRaw")).longValue());
        });
        post.remove("authorIdRaw");
        post.put("comments", comments);
        return post;
    }

    /** Completed activities the person can write a review about (newest first). */
    public List<Map<String, Object>> reviewable(long userId) {
        return jdbc.queryForList("""
                SELECT a.id, a.title, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS date, TIMESTAMPDIFF(MINUTE, a.starts_at, a.ends_at) AS durationMinutes
                FROM activity_records r JOIN participations p ON p.id = r.participation_id JOIN activities a ON a.id = p.activity_id
                WHERE p.user_id = ? AND r.status = 'VALID' AND a.status <> 'DELETED' ORDER BY a.starts_at DESC
                """, userId);
    }

    public record PostRequest(String category, String title, String body, Long activityId) {}

    @Transactional
    public Map<String, Object> create(long userId, PostRequest request) {
        writer(userId);
        String category = request.category() == null ? "" : request.category().trim();
        String title = clean(request.title()), body = clean(request.body());
        Map<String, String> errors = new LinkedHashMap<>();
        if (!CATEGORIES.contains(category)) errors.put("category", "글 종류를 골라 주세요.");
        if (title.length() < 2 || title.length() > TITLE_MAX) errors.put("title", "제목은 2~" + TITLE_MAX + "자로 적어 주세요.");
        if (body.length() < 5 || body.length() > BODY_MAX) errors.put("body", "내용은 5~" + BODY_MAX + "자로 적어 주세요.");
        if (contact(title) || contact(body)) errors.put(contact(title) ? "title" : "body", "전화번호·이메일·오픈채팅 같은 연락처는 올릴 수 없어요.");
        Long activityId = null;
        if ("REVIEW".equals(category)) {
            activityId = request.activityId();
            if (activityId == null || reviewable(userId).stream().noneMatch(row -> ((Number) row.get("id")).longValue() == request.activityId()))
                errors.put("activityId", "후기는 내가 참여를 마친 활동에만 쓸 수 있어요.");
        }
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        int today = jdbc.queryForObject("SELECT COUNT(*) FROM community_posts WHERE author_id = ? AND created_at > NOW() - INTERVAL 1 DAY", Integer.class, userId);
        if (today >= POSTS_PER_DAY) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_POSTS", "글은 하루에 " + POSTS_PER_DAY + "개까지 쓸 수 있어요.");
        jdbc.update("INSERT INTO community_posts(author_id, category, title, body, activity_id) VALUES (?, ?, ?, ?, ?)", userId, category, title, body, activityId);
        return detail(userId, jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class));
    }

    @Transactional
    public void delete(long userId, long id) {
        long author = authorOf("community_posts", id);
        if (author != userId && !auth.findById(userId).admin()) throw notFound();
        jdbc.update("UPDATE community_posts SET deleted_at = ? WHERE id = ?", now(), id);
    }

    @Transactional
    public Map<String, Object> like(long userId, long id, boolean on) {
        authorOf("community_posts", id);
        if (on) jdbc.update("INSERT IGNORE INTO community_likes(post_id, user_id) VALUES (?, ?)", id, userId);
        else jdbc.update("DELETE FROM community_likes WHERE post_id = ? AND user_id = ?", id, userId);
        return Map.of("liked", on, "likes", jdbc.queryForObject("SELECT COUNT(*) FROM community_likes WHERE post_id = ?", Integer.class, id));
    }

    public record CommentRequest(String body) {}

    @Transactional
    public Map<String, Object> comment(long userId, long postId, CommentRequest request) {
        writer(userId);
        long postAuthor = authorOf("community_posts", postId);
        String body = clean(request.body());
        if (body.isEmpty() || body.length() > COMMENT_MAX) throw ApiException.validation(Map.of("body", "댓글은 1~" + COMMENT_MAX + "자로 적어 주세요."));
        if (contact(body)) throw ApiException.validation(Map.of("body", "전화번호·이메일·오픈채팅 같은 연락처는 올릴 수 없어요."));
        int recent = jdbc.queryForObject("SELECT COUNT(*) FROM community_comments WHERE author_id = ? AND created_at > NOW() - INTERVAL 1 HOUR", Integer.class, userId);
        if (recent >= COMMENTS_PER_HOUR) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_POSTS", "잠시 후 다시 써 주세요.");
        jdbc.update("INSERT INTO community_comments(post_id, author_id, body) VALUES (?, ?, ?)", postId, userId, body);
        if (postAuthor != userId) {
            String title = jdbc.queryForObject("SELECT title FROM community_posts WHERE id = ?", String.class, postId);
            notifications.send(postAuthor, "COMMUNITY_COMMENT", "내 글에 댓글이 달렸어요", title + " · " + (body.length() > 40 ? body.substring(0, 40) + "…" : body), "#/post/" + postId);
        }
        return detail(userId, postId);
    }

    @Transactional
    public void deleteComment(long userId, long id) {
        long author = authorOf("community_comments", id);
        if (author != userId && !auth.findById(userId).admin()) throw notFound();
        jdbc.update("UPDATE community_comments SET deleted_at = ? WHERE id = ?", now(), id);
    }

    // ---- internals ----

    private void shape(Map<String, Object> row, long viewerId) {
        long author = ((Number) row.remove("authorId")).longValue();
        row.put("authorIdRaw", author);
        row.put("author", shown(row));
        row.put("mine", author == viewerId);
        row.put("liked", ((Number) row.get("liked")).intValue() == 1);
        // A deleted activity (organizer withdrew or deleted it) drops its title and link; the review stays verified.
        row.put("verified", ((Number) row.remove("reviewed")).intValue() == 1);
        if (!row.containsKey("body")) row.remove("authorIdRaw");
    }

    private void writer(long userId) {
        AuthUser user = auth.findById(userId);
        if (user.admin()) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 계정은 글을 쓸 수 없습니다.");
        if (!user.canWrite()) throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_RESTRICTED", "이용이 제한된 계정은 글을 쓸 수 없습니다.");
        if (!Boolean.TRUE.equals(profile(userId).get("ready")))
            throw new ApiException(HttpStatus.FORBIDDEN, "COMMUNITY_SETUP_REQUIRED", "커뮤니티 닉네임을 정하고 이용 규칙에 동의해 주세요.");
    }

    /** Nickname when set; otherwise the partly hidden real name (posts from before nicknames existed). */
    private static String shown(Map<String, Object> row) {
        Object nickname = row.remove("nickname");
        String name = (String) row.remove("name");
        return nickname != null ? (String) nickname : PostService.mask(name);
    }

    // ---- nickname and rules ----

    static final int NICK_MIN = 2, NICK_MAX = 10, NICK_CHANGE_DAYS = 30;
    private static final java.util.regex.Pattern NICK = java.util.regex.Pattern.compile("[가-힣A-Za-z0-9 ]+");
    private static final List<String> RESERVED = List.of("관리자", "운영자", "운영팀", "volink", "볼링크", "admin", "모집자");

    public Map<String, Object> profile(long userId) {
        Map<String, Object> row = jdbc.queryForMap("SELECT community_nickname AS nickname, community_agreed_at IS NOT NULL AS agreed, nickname_changed_at AS changedAt FROM users WHERE id = ?", userId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("nickname", row.get("nickname"));
        result.put("agreed", ((Number) row.get("agreed")).intValue() == 1);
        result.put("ready", row.get("nickname") != null && ((Number) row.get("agreed")).intValue() == 1);
        LocalDateTime changed = (LocalDateTime) row.get("changedAt");
        result.put("nextChange", changed == null ? null : changed.plusDays(NICK_CHANGE_DAYS).toLocalDate().toString());
        return result;
    }

    public record ProfileRequest(String nickname, Boolean agree) {}

    @Transactional
    public Map<String, Object> setProfile(long userId, ProfileRequest request) {
        AuthUser user = auth.findById(userId);
        if (user.admin()) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 계정은 커뮤니티 닉네임을 쓰지 않습니다.");
        String nickname = clean(request.nickname()).replaceAll("\\s+", " ");
        Map<String, String> errors = new LinkedHashMap<>();
        if (nickname.length() < NICK_MIN || nickname.length() > NICK_MAX) errors.put("nickname", "닉네임은 " + NICK_MIN + "~" + NICK_MAX + "자로 정해 주세요.");
        else if (!NICK.matcher(nickname).matches()) errors.put("nickname", "한글·영문·숫자만 쓸 수 있어요.");
        else if (RESERVED.stream().anyMatch(word -> nickname.replace(" ", "").toLowerCase(java.util.Locale.ROOT).contains(word))) errors.put("nickname", "운영자로 오해할 수 있는 닉네임은 쓸 수 없어요.");
        else if (contact(nickname)) errors.put("nickname", "연락처가 들어간 닉네임은 쓸 수 없어요.");
        if (!Boolean.TRUE.equals(request.agree())) errors.put("agree", "커뮤니티 이용 규칙에 동의해 주세요.");
        if (!errors.isEmpty()) throw ApiException.validation(errors);
        Map<String, Object> current = jdbc.queryForMap("SELECT community_nickname AS nickname, nickname_changed_at AS changedAt FROM users WHERE id = ? FOR UPDATE", userId);
        boolean changing = current.get("nickname") != null && !nickname.equals(current.get("nickname"));
        LocalDateTime changed = (LocalDateTime) current.get("changedAt");
        Integer taken = jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE community_nickname = ? AND id <> ?", Integer.class, nickname, userId);
        if (taken > 0) throw new ApiException(HttpStatus.CONFLICT, "NICKNAME_TAKEN", "이미 쓰는 닉네임이에요. 다른 닉네임을 골라 주세요.", Map.of("nickname", "이미 쓰는 닉네임이에요."));
        if (changing && changed != null && changed.plusDays(NICK_CHANGE_DAYS).isAfter(now()))
            throw new ApiException(HttpStatus.CONFLICT, "NICKNAME_CHANGE_LIMIT", "닉네임은 " + NICK_CHANGE_DAYS + "일에 한 번 바꿀 수 있어요. " + changed.plusDays(NICK_CHANGE_DAYS).toLocalDate() + "부터 바꿀 수 있어요.");
        // MySQL applies SET left to right, so the change time is decided before the nickname is overwritten.
        jdbc.update("UPDATE users SET nickname_changed_at = CASE WHEN community_nickname IS NULL OR community_nickname <> ? THEN ? ELSE nickname_changed_at END, community_nickname = ?, community_agreed_at = COALESCE(community_agreed_at, ?) WHERE id = ?",
                nickname, now(), nickname, now(), userId);
        return profile(userId);
    }

    private long authorOf(String table, long id) {
        return jdbc.queryForList("SELECT author_id FROM " + table + " WHERE id = ? AND deleted_at IS NULL", Long.class, id).stream().findFirst().orElseThrow(CommunityService::notFound);
    }

    private static boolean contact(String text) {
        return PostService.CONTACT.matcher(text.replace(" ", "")).find() || PostService.CONTACT.matcher(text).find();
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private LocalDateTime now() {
        return LocalDateTime.now(clock);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "글을 찾을 수 없습니다.");
    }
}
