import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  PurchaseDigestFrequency,
  RefundPayoutStatus,
  RefundStatus,
  UserRole,
  comments,
  coupons,
  lessons,
  modules,
  purchases,
  refunds,
  teams,
  users,
} from "~/db/schema";
import {
  InMemoryNotificationAdapter,
  getNotificationPreferences,
  notifyCommentPosted,
  notifyRefundRequestDecided,
  notifyRefundRequestOpened,
  notifyRefundStatusChanged,
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

  describe("refund lifecycle notifications", () => {
    function createAdmin(name: string, email: string) {
      return db
        .insert(users)
        .values({ name, email, role: UserRole.Admin })
        .returning()
        .get();
    }

    function createIndividualRefundRequest(
      status: RefundStatus = RefundStatus.Open,
      options: {
        refundStatus?: RefundPayoutStatus | null;
        decisionNote?: string | null;
      } = {}
    ) {
      const purchase = db
        .insert(purchases)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          amountPaid: 4900,
          country: "US",
        })
        .returning()
        .get();

      const refundRequest = db
        .insert(refunds)
        .values({
          purchaseId: purchase.id,
          status,
          refundStatus: options.refundStatus ?? null,
          reason: "Bought the wrong course by mistake.",
          amountRefunded: status === RefundStatus.Approved ? 4900 : null,
          decisionNote: options.decisionNote ?? null,
        })
        .returning()
        .get();

      return { purchase, refundRequest };
    }

    function createTeamRefundRequest() {
      const purchase = db
        .insert(purchases)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          amountPaid: 19900,
          country: "US",
        })
        .returning()
        .get();
      const team = db.insert(teams).values({}).returning().get();
      db.insert(coupons)
        .values([
          {
            teamId: team.id,
            courseId: base.course.id,
            code: "SEAT-1",
            purchaseId: purchase.id,
          },
          {
            teamId: team.id,
            courseId: base.course.id,
            code: "SEAT-2",
            purchaseId: purchase.id,
          },
        ])
        .run();

      const refundRequest = db
        .insert(refunds)
        .values({
          purchaseId: purchase.id,
          status: RefundStatus.Open,
          reason: "Team no longer needs these seats.",
        })
        .returning()
        .get();

      return { purchase, refundRequest };
    }

    it("emits refund-request-opened to Buyer and all Platform Admins without notifying the Instructor", async () => {
      const admin1 = createAdmin("Admin One", "admin1@example.com");
      const admin2 = createAdmin("Admin Two", "admin2@example.com");
      const { refundRequest } = createIndividualRefundRequest();
      const adapter = new InMemoryNotificationAdapter();

      await notifyRefundRequestOpened(
        db,
        { refundRequestId: refundRequest.id },
        adapter
      );

      expect(adapter.triggered).toHaveLength(2);

      const buyerTrigger = adapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(base.user.id))
      );
      expect(buyerTrigger?.workflow).toBe("refund-request-opened");
      expect(buyerTrigger?.data).toMatchObject({
        subkind: "refund_open",
        deepLink: "/settings",
        courseTitle: base.course.title,
        purchaseKind: "individual_purchase",
        amountPaid: 4900,
        reason: "Bought the wrong course by mistake.",
      });

      const adminTrigger = adapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(admin1.id))
      );
      expect(adminTrigger?.workflow).toBe("refund-request-opened");
      expect(adminTrigger?.recipients.map((r) => r.id).sort()).toEqual(
        [String(admin1.id), String(admin2.id)].sort()
      );
      expect(adminTrigger?.data.deepLink).toBe("/admin/refunds?status=open");

      const instructorFeed = await adapter.listFeed(String(base.instructor.id));
      expect(instructorFeed).toHaveLength(0);
    });

    it("routes Team Licence refund-request-opened deepLink to /team for the Buyer", async () => {
      createAdmin("Admin One", "admin1@example.com");
      const { refundRequest } = createTeamRefundRequest();
      const adapter = new InMemoryNotificationAdapter();

      await notifyRefundRequestOpened(
        db,
        { refundRequestId: refundRequest.id },
        adapter
      );

      const buyerTrigger = adapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(base.user.id))
      );
      expect(buyerTrigger?.data).toMatchObject({
        deepLink: "/team",
        purchaseKind: "team_licence",
      });
    });

    it("emits unified refund-request-approved to Buyer and Instructor", async () => {
      const { refundRequest } = createIndividualRefundRequest(
        RefundStatus.Approved,
        {
          refundStatus: RefundPayoutStatus.Pending,
          decisionNote: "Approved as a one-time courtesy.",
        }
      );
      const adapter = new InMemoryNotificationAdapter();

      await notifyRefundRequestDecided(
        db,
        { refundRequestId: refundRequest.id, decision: "approved" },
        adapter
      );

      expect(adapter.triggered).toHaveLength(2);

      const buyerTrigger = adapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(base.user.id))
      );
      expect(buyerTrigger?.workflow).toBe("refund-request-approved");
      expect(buyerTrigger?.data).toMatchObject({
        subkind: "refund_approved",
        deepLink: "/settings",
        refundStatus: RefundPayoutStatus.Pending,
        decisionNote: "Approved as a one-time courtesy.",
        amountRefunded: 4900,
      });

      const instructorTrigger = adapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(base.instructor.id))
      );
      expect(instructorTrigger?.workflow).toBe("refund-request-approved");
      expect(instructorTrigger?.data.deepLink).toBe(
        `/instructor/${base.course.id}/students`
      );
    });

    it("emits refund-request-declined exclusively to Buyer with decisionNote", async () => {
      const { refundRequest } = createIndividualRefundRequest(
        RefundStatus.Declined,
        { decisionNote: "More than half the course was completed." }
      );
      const adapter = new InMemoryNotificationAdapter();

      await notifyRefundRequestDecided(
        db,
        { refundRequestId: refundRequest.id, decision: "declined" },
        adapter
      );

      expect(adapter.triggered).toHaveLength(1);
      expect(adapter.triggered[0].workflow).toBe("refund-request-declined");
      expect(adapter.triggered[0].recipients.map((r) => r.id)).toEqual([
        String(base.user.id),
      ]);
      expect(adapter.triggered[0].data).toMatchObject({
        subkind: "refund_declined",
        deepLink: "/settings",
        decisionNote: "More than half the course was completed.",
      });
      expect(await adapter.listFeed(String(base.instructor.id))).toHaveLength(0);
    });

    it("emits refund-issued to Buyer and refund-failed to Buyer and all Platform Admins", async () => {
      const admin1 = createAdmin("Admin One", "admin1@example.com");
      const { refundRequest } = createIndividualRefundRequest(
        RefundStatus.Approved,
        { refundStatus: RefundPayoutStatus.Issued }
      );
      const issuedAdapter = new InMemoryNotificationAdapter();

      await notifyRefundStatusChanged(
        db,
        { refundRequestId: refundRequest.id, refundStatus: "issued" },
        issuedAdapter
      );

      expect(issuedAdapter.triggered).toHaveLength(1);
      expect(issuedAdapter.triggered[0].workflow).toBe("refund-issued");
      expect(issuedAdapter.triggered[0].recipients.map((r) => r.id)).toEqual([
        String(base.user.id),
      ]);
      expect(issuedAdapter.triggered[0].data).toMatchObject({
        subkind: "refund_issued",
        deepLink: "/settings",
        amountRefunded: 4900,
      });

      const failedAdapter = new InMemoryNotificationAdapter();
      await notifyRefundStatusChanged(
        db,
        { refundRequestId: refundRequest.id, refundStatus: "failed" },
        failedAdapter
      );

      expect(failedAdapter.triggered).toHaveLength(2);
      const buyerTrigger = failedAdapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(base.user.id))
      );
      expect(buyerTrigger?.workflow).toBe("refund-failed");
      expect(buyerTrigger?.data).toMatchObject({
        subkind: "refund_failed",
        deepLink: "/settings",
        urgent: true,
      });

      const adminTrigger = failedAdapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(admin1.id))
      );
      expect(adminTrigger?.workflow).toBe("refund-failed");
      expect(adminTrigger?.data).toMatchObject({
        subkind: "refund_failed",
        deepLink: "/admin/refunds?status=approved",
        urgent: true,
      });
    });
  });
});
