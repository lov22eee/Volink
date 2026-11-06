package com.volink.post;

import com.volink.common.ApiException;
import com.volink.common.Sql;
import com.volink.notification.NotificationService;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * An activity's notices and Q&A ("활동 소식"): the organizer posts notices and answers, participants whose place is
 * confirmed ask questions, and everyone in the activity reads the same thread. No real-time chat and no contact details:
 * a body that looks like a phone number, an e-mail or an open-chat link is refused (plan: 연락처 비공개).
 */
@Service
public class PostService {
    /** Who may read and write: the organizer, and participants who hold (or held) a confirmed place. */
    static final List<String> MEMBER = List.of("CONFIRMED", "CHECKED_IN", "COMPLETED", "NO_SHOW");
    static final int MAX_LENGTH = 500;
    /** A person can post this many times per activity per hour (keeps the thread readable and stops spam). */
    static final int PER_HOUR = 10;
    public static final Pattern CONTACT = Pattern.compile(
            "01[016789][-\\s.]?\\d{3,4}[-\\s.]?\\d{4}|[\\w.+-]+@[\\w-]+\\.[\\w.]+|open\\.kakao\\.com|오픈\\s*채팅|카톡\\s*아이디|카카오톡\\s*아이디");

    private final JdbcTemplate jdbc;
    private final NotificationService notifications;
    private final Clock clock;

    public PostService(JdbcTemplate jdbc, NotificationService notifications, Clock clock) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.clock = clock;
    }

    record Activity(long id, long organizerId, String title, String status) {
        String link() { return "#/activity/" + id; }
        boolean open() { return List.of("RECRUITING", "IN_PROGRESS").contains(status); }
    }

    enum Role { ORGANIZER, PARTICIPANT, ADMIN }

    public Map<String, Object> list(long viewerId, long activityId) {
        Activity activity = activity(activityId);
        Role role = role(viewerId, activity);
        List<Map<String, Object>> rows = jdbc.queryForList(Sql.kst("""
                SELECT p.id, p.kind, p.parent_id AS parentId, p.body, p.author_id AS authorId, u.display_name AS name, p.private_post AS privatePost,
                       DATE_FORMAT(KST(p.created_at), '%Y-%m-%dT%H:%i') AS createdAt,
                       p.created_at > COALESCE((SELECT s.seen_at FROM activity_post_seen s WHERE s.activity_id = p.activity_id AND s.user_id = ?), '1970-01-02') AS unseen,
                       (SELECT COUNT(*) FROM activity_post_seen s JOIN participations m ON m.activity_id = s.activity_id AND m.user_id = s.user_id
                         WHERE s.activity_id = p.activity_id AND s.seen_at >= p.created_at AND m.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')) AS readCount
                FROM activity_posts p JOIN users u ON u.id = p.author_id
                WHERE p.activity_id = ? AND p.deleted_at IS NULL ORDER BY p.created_at DESC, p.id DESC
                """), viewerId, activityId);
        // A private question (and its answer) is shown only to the asker, the organizer and admins.
        boolean staff = role != Role.PARTICIPANT;
        java.util.Set<Long> hidden = new java.util.HashSet<>();
        for (Map<String, Object> row : rows)
            if ("QUESTION".equals(row.get("kind")) && truthy(row.get("privatePost")) && !staff && ((Number) row.get("authorId")).longValue() != viewerId)
                hidden.add(((Number) row.get("id")).longValue());
        rows.removeIf(row -> hidden.contains(((Number) row.get("id")).longValue()) || row.get("parentId") != null && hidden.contains(((Number) row.get("parentId")).longValue()));
        Map<Long, Map<String, Object>> answers = new LinkedHashMap<>();
        for (Map<String, Object> row : rows)
            if ("ANSWER".equals(row.get("kind"))) answers.putIfAbsent(((Number) row.get("parentId")).longValue(), row);
        List<Map<String, Object>> notices = new ArrayList<>(), questions = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            if ("ANSWER".equals(row.get("kind"))) continue;
            Map<String, Object> item = view(row, activity, viewerId);
            if ("QUESTION".equals(row.get("kind"))) {
                Map<String, Object> answer = answers.get(((Number) row.get("id")).longValue());
                item.put("answer", answer == null ? null : view(answer, activity, viewerId));
                questions.add(item);
            } else notices.add(item);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("canNotice", role == Role.ORGANIZER && activity.open());
        result.put("canAsk", role == Role.PARTICIPANT && activity.open());
        result.put("canAnswer", role == Role.ORGANIZER && activity.open());
        result.put("unanswered", questions.stream().filter(q -> q.get("answer") == null).count());
        // For the entry card: what is new since this person last opened the news (their own posts do not count).
        result.put("newNotices", rows.stream().filter(r -> "NOTICE".equals(r.get("kind")) && truthy(r.get("unseen")) && ((Number) r.get("authorId")).longValue() != viewerId).count());
        result.put("newAnswers", questions.stream().filter(q -> Boolean.TRUE.equals(q.get("mine")) && q.get("answer") != null && Boolean.TRUE.equals(((Map<?, ?>) q.get("answer")).get("unseen"))).count());
        result.put("audience", jdbc.queryForObject("SELECT COUNT(*) FROM participations WHERE activity_id = ? AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')", Integer.class, activityId));
        result.put("notices", notices);
        result.put("questions", questions);
        return result;
    }

    @Transactional
    public Map<String, Object> notice(long organizerId, long activityId, String rawBody) {
        Activity activity = activity(activityId);
        if (role(organizerId, activity) != Role.ORGANIZER) throw forbidden("모집자만 공지를 쓸 수 있습니다.");
        String body = checked(organizerId, activity, rawBody);
        long id = insert(activity.id(), organizerId, "NOTICE", null, body);
        for (long user : jdbc.queryForList("SELECT user_id FROM participations WHERE activity_id = ? AND status IN ('CONFIRMED', 'CHECKED_IN')", Long.class, activityId))
            notifications.send(user, "NOTICE", "새 공지가 올라왔어요", activity.title() + " · " + preview(body), activity.link());
        return Map.of("id", id);
    }

    @Transactional
    public Map<String, Object> ask(long userId, long activityId, String rawBody) {
        return ask(userId, activityId, rawBody, false);
    }

    /** privately = only the organizer (and the asker) sees the question and its answer. */
    @Transactional
    public Map<String, Object> ask(long userId, long activityId, String rawBody, boolean privately) {
        Activity activity = activity(activityId);
        if (role(userId, activity) != Role.PARTICIPANT) throw forbidden("참가가 확정된 사람만 질문할 수 있습니다.");
        String body = checked(userId, activity, rawBody);
        long id = insert(activity.id(), userId, "QUESTION", null, body);
        if (privately) jdbc.update("UPDATE activity_posts SET private_post = TRUE WHERE id = ?", id);
        notifications.send(activity.organizerId(), "QUESTION", privately ? "모집자에게만 보이는 질문이 있어요" : "새 질문이 있어요", activity.title() + " · " + preview(body), activity.link(), activity.id(), null, id);
        return Map.of("id", id);
    }

    @Transactional
    public Map<String, Object> answer(long organizerId, long questionId, String rawBody) {
        Map<String, Object> question = post(questionId);
        if (!"QUESTION".equals(question.get("kind"))) throw notFound();
        Activity activity = activity(((Number) question.get("activity_id")).longValue());
        if (role(organizerId, activity) != Role.ORGANIZER) throw forbidden("모집자만 답변할 수 있습니다.");
        if (jdbc.queryForObject("SELECT COUNT(*) FROM activity_posts WHERE parent_id = ? AND deleted_at IS NULL", Integer.class, questionId) > 0)
            throw new ApiException(HttpStatus.CONFLICT, "ALREADY_ANSWERED", "이미 답변한 질문입니다. 고치려면 답변을 지우고 다시 써 주세요.");
        String body = checked(organizerId, activity, rawBody);
        long id = insert(activity.id(), organizerId, "ANSWER", questionId, body);
        notifications.send(((Number) question.get("author_id")).longValue(), "ANSWER", "질문에 답변이 달렸어요", activity.title() + " · " + preview(body), activity.link());
        return Map.of("id", id);
    }

    /** The person opened the news: everything up to now counts as seen (entry card badge, notice read count). */
    @Transactional
    public void seen(long userId, long activityId) {
        role(userId, activity(activityId));
        jdbc.update("INSERT INTO activity_post_seen(activity_id, user_id, seen_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE seen_at = CURRENT_TIMESTAMP", activityId, userId);
    }

    private static boolean truthy(Object value) {
        return value instanceof Boolean b ? b : value instanceof Number n && n.intValue() != 0;
    }

    /** The author deletes their own post; the organizer may also remove a participant's question from their activity. */
    @Transactional
    public void delete(long userId, long postId) {
        Map<String, Object> post = post(postId);
        Activity activity = activity(((Number) post.get("activity_id")).longValue());
        boolean author = ((Number) post.get("author_id")).longValue() == userId;
        if (!author && activity.organizerId() != userId) throw notFound();
        LocalDateTime now = LocalDateTime.now(clock);
        jdbc.update("UPDATE activity_posts SET deleted_at = ? WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL", now, postId, postId);
    }

    // ---- internals ----

    private Role role(long userId, Activity activity) {
        if (activity.organizerId() == userId) return Role.ORGANIZER;
        String role = jdbc.queryForList("SELECT role FROM users WHERE id = ?", String.class, userId).stream().findFirst().orElse("");
        if ("ADMIN".equals(role)) return Role.ADMIN;
        String status = jdbc.queryForList("SELECT status FROM participations WHERE activity_id = ? AND user_id = ?", String.class, activity.id(), userId)
                .stream().findFirst().orElse(null);
        if (status != null && MEMBER.contains(status)) return Role.PARTICIPANT;
        throw forbidden("참가가 확정된 사람과 모집자만 활동 소식을 볼 수 있습니다.");
    }

    private String checked(long userId, Activity activity, String raw) {
        if (!activity.open()) throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "끝났거나 공개되지 않은 활동에는 글을 쓸 수 없습니다.");
        String body = raw == null ? "" : raw.trim();
        if (body.isEmpty()) throw ApiException.validation(Map.of("body", "내용을 입력해 주세요."));
        if (body.length() > MAX_LENGTH) throw ApiException.validation(Map.of("body", "500자 이내로 입력해 주세요."));
        if (CONTACT.matcher(body.replace(" ", "")).find() || CONTACT.matcher(body).find())
            throw ApiException.validation(Map.of("body", "전화번호·이메일·오픈채팅 같은 연락처는 올릴 수 없어요. 필요한 안내는 이곳에서 해 주세요."));
        int recent = jdbc.queryForObject("SELECT COUNT(*) FROM activity_posts WHERE author_id = ? AND activity_id = ? AND created_at > NOW() - INTERVAL 1 HOUR",
                Integer.class, userId, activity.id());
        if (recent >= PER_HOUR) throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_POSTS", "잠시 후 다시 써 주세요. 한 시간에 10개까지 쓸 수 있어요.");
        return body;
    }

    private long insert(long activityId, long authorId, String kind, Long parentId, String body) {
        jdbc.update("INSERT INTO activity_posts(activity_id, author_id, kind, parent_id, body) VALUES (?, ?, ?, ?, ?)", activityId, authorId, kind, parentId, body);
        return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
    }

    private Map<String, Object> view(Map<String, Object> row, Activity activity, long viewerId) {
        long author = ((Number) row.get("authorId")).longValue();
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", row.get("id"));
        item.put("kind", row.get("kind"));
        item.put("body", row.get("body"));
        item.put("createdAt", row.get("createdAt"));
        // Names stay partly hidden, as in the applicant list; the organizer is just "모집자".
        item.put("author", author == activity.organizerId() ? "모집자" : mask((String) row.get("name")));
        item.put("mine", author == viewerId);
        item.put("private", truthy(row.get("privatePost")));
        item.put("unseen", truthy(row.get("unseen")) && author != viewerId);
        // Only the organizer sees how many confirmed people opened the news after a notice.
        if ("NOTICE".equals(row.get("kind")) && activity.organizerId() == viewerId) item.put("readCount", row.get("readCount"));
        return item;
    }

    private Activity activity(long id) {
        return jdbc.queryForList("SELECT id, organizer_id, title, status FROM activities WHERE id = ?", id).stream().findFirst()
                .map(r -> new Activity(((Number) r.get("id")).longValue(), ((Number) r.get("organizer_id")).longValue(), (String) r.get("title"), (String) r.get("status")))
                .orElseThrow(PostService::notFound);
    }

    private Map<String, Object> post(long id) {
        return jdbc.queryForList("SELECT id, activity_id, author_id, kind FROM activity_posts WHERE id = ? AND deleted_at IS NULL", id).stream().findFirst()
                .orElseThrow(PostService::notFound);
    }

    private static String preview(String body) {
        return body.length() > 40 ? body.substring(0, 40) + "…" : body;
    }

    static String mask(String name) {
        if (com.volink.auth.AccountService.WITHDRAWN_NAME.equals(name)) return name;
        if (name == null || name.length() <= 1) return "*";
        if (name.length() == 2) return name.charAt(0) + "*";
        return name.charAt(0) + "*".repeat(name.length() - 2) + name.charAt(name.length() - 1);
    }

    private static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "글을 찾을 수 없습니다.");
    }
}
