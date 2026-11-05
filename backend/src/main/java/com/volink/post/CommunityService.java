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
            p.id, p.category, p.title, p.body, p.author_id AS authorId, u.display_name AS name, p.activity_id AS activityId,
            a.title AS activityTitle, DATE_FORMAT(a.starts_at, '%Y-%m-%d') AS activityDate,
            DATE_FORMAT(KST(p.created_at), '%Y-%m-%dT%H:%i') AS createdAt,
            (SELECT COUNT(*) FROM community_likes l WHERE l.post_id = p.id) AS likes,
            (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comments,
            EXISTS (SELECT 1 FROM community_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
            FROM community_posts p JOIN users u ON u.id = p.author_id LEFT JOIN activities a ON a.id = p.activity_id
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
                SELECT c.id, c.body, c.author_id AS authorId, u.display_name AS name, DATE_FORMAT(KST(c.created_at), '%Y-%m-%dT%H:%i') AS createdAt
                FROM community_comments c JOIN users u ON u.id = c.author_id WHERE c.post_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at, c.id
                """), id);
        comments.forEach(comment -> {
            long author = ((Number) comment.remove("authorId")).longValue();
            comment.put("author", PostService.mask((String) comment.remove("name")));
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
                WHERE p.user_id = ? AND r.status = 'VALID' ORDER BY a.starts_at DESC
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
        row.put("author", PostService.mask((String) row.remove("name")));
        row.put("mine", author == viewerId);
        row.put("liked", ((Number) row.get("liked")).intValue() == 1);
        row.put("verified", row.get("activityId") != null);
        if (!row.containsKey("body")) row.remove("authorIdRaw");
    }

    private void writer(long userId) {
        AuthUser user = auth.findById(userId);
        if (user.admin()) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 계정은 글을 쓸 수 없습니다.");
        if (!user.canWrite()) throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_RESTRICTED", "이용이 제한된 계정은 글을 쓸 수 없습니다.");
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
