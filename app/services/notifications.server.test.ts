import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  PurchaseDigestFrequency,
  UserRole,
  comments,
  lessons,
  modules,
  users,
} from "~/db/schema";
import {
  InMemoryNotificationAdapter,
  getNotificationPreferences,
  notifyCommentPosted,
  updateNotificationPreferences,
} from "./notifications.server";

describe("notifications.server", () => {
  let db: ReturnType<typeof createTestDb>;
  let base: ReturnType<typeof seedBaseData>;

  beforeEach(() => {
    db = createTestDb();
    base = seedBaseData(db);
  });

  describe("notification preferences", () => {
    it("returns default preferences when a user has no saved row", () => {
      const prefs = getNotificationPreferences(db, base.user.id);

      expect(prefs).toEqual({
        userId: base.user.id,
        commentsEnabled: true,
        seatClaimedEnabled: true,
        purchaseDigestFrequency: PurchaseDigestFrequency.Daily,
        adherenceRemindersEnabled: true,
        courseRecommendationsEnabled: true,
      });
    });

    it("persists updates to commentsEnabled and preserves other defaults", () => {
      const updated = updateNotificationPreferences(db, base.user.id, {
        commentsEnabled: false,
      });

      expect(updated.commentsEnabled).toBe(false);
      expect(updated.seatClaimedEnabled).toBe(true);
      expect(updated.purchaseDigestFrequency).toBe(PurchaseDigestFrequency.Daily);

      const reloaded = getNotificationPreferences(db, base.user.id);
      expect(reloaded.commentsEnabled).toBe(false);

      const reenabled = updateNotificationPreferences(db, base.user.id, {
        commentsEnabled: true,
      });
      expect(reenabled.commentsEnabled).toBe(true);
      expect(getNotificationPreferences(db, base.user.id).commentsEnabled).toBe(true);
    });
  });

  describe("notifyCommentPosted - root comments", () => {
    function createLesson() {
      const mod = db
        .insert(modules)
        .values({ courseId: base.course.id, title: "Module 1", position: 1 })
        .returning()
        .get();
      return db
        .insert(lessons)
        .values({
          moduleId: mod.id,
          title: "Intro Lesson",
          content: "Welcome",
          position: 1,
        })
        .returning()
        .get();
    }

    it("notifies the course instructor when a student posts a root comment with plain-text excerpt and anchor deep-link", async () => {
      const lesson = createLesson();
      const adapter = new InMemoryNotificationAdapter();
      const longMarkdown =
        "**Great lesson!** Here is a `const x = 1` question with [a link](https://example.com) that is definitely longer than one hundred and twenty characters overall so we check truncation.";
      const comment = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.user.id,
          parentId: null,
          body: longMarkdown,
        })
        .returning()
        .get();

      await notifyCommentPosted(
        db,
        { commentId: comment.id, lessonId: lesson.id, authorId: base.user.id },
        adapter
      );

      expect(adapter.triggered).toHaveLength(1);
      const trigger = adapter.triggered[0];
      expect(trigger.workflow).toBe("comment-root-posted");
      expect(trigger.recipients.map((r) => r.id)).toEqual([
        String(base.instructor.id),
      ]);
      expect(trigger.actor?.id).toBe(String(base.user.id));
      expect(trigger.data.deepLink).toBe(
        `/courses/${base.course.slug}/lessons/${lesson.id}#comment-${comment.id}`
      );
      const excerpt = String(trigger.data.excerpt);
      expect(excerpt.length).toBeLessThanOrEqual(123);
      expect(excerpt).not.toContain("**");
      expect(excerpt).not.toContain("`");
      expect(excerpt).not.toContain("https://example.com");
    });

    it("does not notify the instructor when they post a root comment on their own course", async () => {
      const lesson = createLesson();
      const adapter = new InMemoryNotificationAdapter();
      const comment = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.instructor.id,
          parentId: null,
          body: "Instructor announcement",
        })
        .returning()
        .get();

      await notifyCommentPosted(
        db,
        {
          commentId: comment.id,
          lessonId: lesson.id,
          authorId: base.instructor.id,
        },
        adapter
      );

      expect(adapter.triggered).toHaveLength(0);
    });

    it("does not notify the instructor when commentsEnabled is false", async () => {
      const lesson = createLesson();
      const adapter = new InMemoryNotificationAdapter();
      updateNotificationPreferences(db, base.instructor.id, {
        commentsEnabled: false,
      });

      const comment = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.user.id,
          parentId: null,
          body: "Question for instructor",
        })
        .returning()
        .get();

      await notifyCommentPosted(
        db,
        { commentId: comment.id, lessonId: lesson.id, authorId: base.user.id },
        adapter
      );

      expect(adapter.triggered).toHaveLength(0);
    });
  });

  describe("notifyCommentPosted - replies", () => {
    function createLesson() {
      const mod = db
        .insert(modules)
        .values({ courseId: base.course.id, title: "Module 1", position: 1 })
        .returning()
        .get();
      return db
        .insert(lessons)
        .values({
          moduleId: mod.id,
          title: "Intro Lesson",
          content: "Welcome",
          position: 1,
        })
        .returning()
        .get();
    }

    function createStudent(name: string, email: string) {
      return db
        .insert(users)
        .values({ name, email, role: UserRole.Student })
        .returning()
        .get();
    }

    it("notifies root author, previous thread participants, and instructor while excluding reply author", async () => {
      const lesson = createLesson();
      const student2 = createStudent("Student Two", "student2@example.com");
      const student3 = createStudent("Student Three", "student3@example.com");
      const adapter = new InMemoryNotificationAdapter();

      const root = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.user.id,
          parentId: null,
          body: "Root question",
        })
        .returning()
        .get();

      db.insert(comments)
        .values({
          lessonId: lesson.id,
          userId: student2.id,
          parentId: root.id,
          body: "First reply",
        })
        .run();

      const reply = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: student3.id,
          parentId: root.id,
          body: "Second reply from student3",
        })
        .returning()
        .get();

      await notifyCommentPosted(
        db,
        { commentId: reply.id, lessonId: lesson.id, authorId: student3.id },
        adapter
      );

      expect(adapter.triggered).toHaveLength(1);
      const trigger = adapter.triggered[0];
      expect(trigger.workflow).toBe("comment-reply-posted");
      const recipientIds = trigger.recipients.map((r) => r.id).sort();
      expect(recipientIds).toEqual(
        [
          String(base.user.id),
          String(student2.id),
          String(base.instructor.id),
        ].sort()
      );
      expect(trigger.data.deepLink).toBe(
        `/courses/${base.course.slug}/lessons/${lesson.id}#comment-${reply.id}`
      );
    });

    it("excludes authors whose comments in the thread were deleted and users with commentsEnabled=false", async () => {
      const lesson = createLesson();
      const deletedReplyAuthor = createStudent(
        "Deleted Author",
        "deleted@example.com"
      );
      const optedOutAuthor = createStudent("Opted Out", "optedout@example.com");
      const activeAuthor = createStudent("Active Author", "active@example.com");
      const adapter = new InMemoryNotificationAdapter();

      updateNotificationPreferences(db, optedOutAuthor.id, {
        commentsEnabled: false,
      });

      const root = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.user.id,
          parentId: null,
          body: "Root question",
          deletedAt: "2026-10-01T10:00:00.000Z",
        })
        .returning()
        .get();

      db.insert(comments)
        .values({
          lessonId: lesson.id,
          userId: deletedReplyAuthor.id,
          parentId: root.id,
          body: "Deleted reply",
          deletedAt: "2026-10-01T10:05:00.000Z",
        })
        .run();

      db.insert(comments)
        .values({
          lessonId: lesson.id,
          userId: optedOutAuthor.id,
          parentId: root.id,
          body: "Opted out reply",
        })
        .run();

      db.insert(comments)
        .values({
          lessonId: lesson.id,
          userId: activeAuthor.id,
          parentId: root.id,
          body: "Active reply",
        })
        .run();

      const instructorReply = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.instructor.id,
          parentId: root.id,
          body: "Instructor answer",
        })
        .returning()
        .get();

      await notifyCommentPosted(
        db,
        {
          commentId: instructorReply.id,
          lessonId: lesson.id,
          authorId: base.instructor.id,
        },
        adapter
      );

      expect(adapter.triggered).toHaveLength(1);
      expect(adapter.triggered[0].recipients.map((r) => r.id)).toEqual([
        String(activeAuthor.id),
      ]);
    });
  });

  describe("InMemoryNotificationAdapter feed", () => {
    it("records triggered notifications per user and supports markAsRead and markAllAsRead", async () => {
      const mod = db
        .insert(modules)
        .values({ courseId: base.course.id, title: "Module 1", position: 1 })
        .returning()
        .get();
      const lesson = db
        .insert(lessons)
        .values({
          moduleId: mod.id,
          title: "Intro Lesson",
          content: "Welcome",
          position: 1,
        })
        .returning()
        .get();
      const adapter = new InMemoryNotificationAdapter();

      const c1 = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.user.id,
          parentId: null,
          body: "First question",
        })
        .returning()
        .get();

      const c2 = db
        .insert(comments)
        .values({
          lessonId: lesson.id,
          userId: base.user.id,
          parentId: null,
          body: "Second question",
        })
        .returning()
        .get();

      await notifyCommentPosted(
        db,
        { commentId: c1.id, lessonId: lesson.id, authorId: base.user.id },
        adapter
      );
      await notifyCommentPosted(
        db,
        { commentId: c2.id, lessonId: lesson.id, authorId: base.user.id },
        adapter
      );

      const feedBefore = await adapter.listFeed(String(base.instructor.id));
      expect(feedBefore).toHaveLength(2);
      expect(feedBefore.every((i) => i.unread)).toBe(true);

      await adapter.markAsRead(String(base.instructor.id), feedBefore[0].id);
      const feedAfterOne = await adapter.listFeed(String(base.instructor.id));
      expect(feedAfterOne[0].unread).toBe(false);
      expect(feedAfterOne[1].unread).toBe(true);

      await adapter.markAllAsRead(String(base.instructor.id));
      const feedAfterAll = await adapter.listFeed(String(base.instructor.id));
      expect(feedAfterAll.every((i) => !i.unread)).toBe(true);
    });
  });
});
