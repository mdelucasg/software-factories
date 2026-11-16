import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  PurchaseDigestFrequency,
  TeamMemberRole,
  UserRole,
  comments,
  coupons,
  lessons,
  modules,
  purchases,
  teamMembers,
  teams,
  users,
} from "~/db/schema";
import {
  InMemoryNotificationAdapter,
  getNotificationPreferences,
  notifyCommentPosted,
  notifyPurchaseCompleted,
  notifySeatClaimed,
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

    it("persists updates to seatClaimedEnabled and purchaseDigestFrequency", () => {
      const updated = updateNotificationPreferences(db, base.instructor.id, {
        seatClaimedEnabled: false,
        purchaseDigestFrequency: PurchaseDigestFrequency.Monthly,
      });

      expect(updated.seatClaimedEnabled).toBe(false);
      expect(updated.purchaseDigestFrequency).toBe(
        PurchaseDigestFrequency.Monthly
      );

      const reloaded = getNotificationPreferences(db, base.instructor.id);
      expect(reloaded.seatClaimedEnabled).toBe(false);
      expect(reloaded.purchaseDigestFrequency).toBe(
        PurchaseDigestFrequency.Monthly
      );
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

  describe("notifyPurchaseCompleted", () => {
    it("emits individual-purchase-completed to the student buyer and instructor-purchase-digest to the instructor", async () => {
      const adapter = new InMemoryNotificationAdapter();
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

      await notifyPurchaseCompleted(db, { purchaseId: purchase.id }, adapter);

      expect(adapter.triggered).toHaveLength(2);

      const studentEvent = adapter.triggered.find(
        (t) => t.workflow === "individual-purchase-completed"
      );
      expect(studentEvent).toBeDefined();
      expect(studentEvent?.recipients.map((r) => r.id)).toEqual([
        String(base.user.id),
      ]);
      expect(studentEvent?.data).toMatchObject({
        kind: "transactional",
        subkind: "individual_purchase",
        courseTitle: base.course.title,
        amountPaid: 4900,
        deepLink: `/courses/${base.course.slug}/welcome`,
      });

      const digestEvent = adapter.triggered.find(
        (t) => t.workflow === "instructor-purchase-digest"
      );
      expect(digestEvent).toBeDefined();
      expect(digestEvent?.recipients.map((r) => r.id)).toEqual([
        String(base.instructor.id),
      ]);
      expect(digestEvent?.data).toMatchObject({
        kind: "transactional",
        subkind: "purchase_digest",
        courseTitle: base.course.title,
        amountPaid: 4900,
        individualCount: 1,
        teamLicenceCount: 0,
        seatCount: 0,
        digestFrequency: PurchaseDigestFrequency.Daily,
        deepLink: "/instructor/analytics",
      });

      const studentFeed = await adapter.listFeed(String(base.user.id));
      expect(studentFeed).toHaveLength(1);
      expect(studentFeed[0].kind).toBe("transactional");
      expect(studentFeed[0].subkind).toBe("individual_purchase");
      expect(studentFeed[0].deepLink).toBe(`/courses/${base.course.slug}/welcome`);
    });

    it("emits team-licence-purchased to the team admin buyer and instructor-purchase-digest with seatCount", async () => {
      const teamAdmin = db
        .insert(users)
        .values({
          name: "Team Admin",
          email: "teamadmin@test.com",
          role: UserRole.Student,
        })
        .returning()
        .get();

      const team = db.insert(teams).values({}).returning().get();
      db.insert(teamMembers)
        .values({
          teamId: team.id,
          userId: teamAdmin.id,
          role: TeamMemberRole.Admin,
        })
        .run();

      const purchase = db
        .insert(purchases)
        .values({
          userId: teamAdmin.id,
          courseId: base.course.id,
          amountPaid: 14700,
          country: "US",
        })
        .returning()
        .get();

      for (let i = 0; i < 3; i++) {
        db.insert(coupons)
          .values({
            teamId: team.id,
            courseId: base.course.id,
            code: `SEAT-${i}`,
            purchaseId: purchase.id,
          })
          .run();
      }

      const adapter = new InMemoryNotificationAdapter();
      await notifyPurchaseCompleted(db, { purchaseId: purchase.id }, adapter);

      expect(adapter.triggered).toHaveLength(2);

      const teamEvent = adapter.triggered.find(
        (t) => t.workflow === "team-licence-purchased"
      );
      expect(teamEvent).toBeDefined();
      expect(teamEvent?.recipients.map((r) => r.id)).toEqual([
        String(teamAdmin.id),
      ]);
      expect(teamEvent?.data).toMatchObject({
        kind: "transactional",
        subkind: "team_licence_purchase",
        courseTitle: base.course.title,
        amountPaid: 14700,
        seatCount: 3,
        deepLink: "/team",
      });

      const digestEvent = adapter.triggered.find(
        (t) => t.workflow === "instructor-purchase-digest"
      );
      expect(digestEvent).toBeDefined();
      expect(digestEvent?.data).toMatchObject({
        individualCount: 0,
        teamLicenceCount: 1,
        seatCount: 3,
        amountPaid: 14700,
        deepLink: "/instructor/analytics",
      });
    });

    it("skips instructor-purchase-digest when purchaseDigestFrequency is off and respects weekly/monthly windows", async () => {
      updateNotificationPreferences(db, base.instructor.id, {
        purchaseDigestFrequency: PurchaseDigestFrequency.Off,
      });

      const p1 = db
        .insert(purchases)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          amountPaid: 4900,
          country: "US",
        })
        .returning()
        .get();

      const adapter = new InMemoryNotificationAdapter();
      await notifyPurchaseCompleted(db, { purchaseId: p1.id }, adapter);

      expect(adapter.triggered).toHaveLength(1);
      expect(adapter.triggered[0].workflow).toBe(
        "individual-purchase-completed"
      );

      updateNotificationPreferences(db, base.instructor.id, {
        purchaseDigestFrequency: PurchaseDigestFrequency.Weekly,
      });

      const p2 = db
        .insert(purchases)
        .values({
          userId: base.user.id,
          courseId: base.course.id,
          amountPaid: 4900,
          country: "US",
        })
        .returning()
        .get();

      await notifyPurchaseCompleted(db, { purchaseId: p2.id }, adapter);
      const weeklyDigest = adapter.triggered.find(
        (t) => t.workflow === "instructor-purchase-digest"
      );
      expect(weeklyDigest?.data).toMatchObject({
        digestFrequency: PurchaseDigestFrequency.Weekly,
        window: PurchaseDigestFrequency.Weekly,
        batchKey: `instructor-purchase-digest:${base.instructor.id}:weekly`,
      });
    });
  });

  describe("notifySeatClaimed", () => {
    it("notifies the team admin (mandatory) and instructor (when seatClaimedEnabled=true), never notifying the claiming student", async () => {
      const teamAdmin = db
        .insert(users)
        .values({
          name: "Team Admin",
          email: "admin@team.com",
          role: UserRole.Student,
        })
        .returning()
        .get();

      const team = db.insert(teams).values({}).returning().get();
      db.insert(teamMembers)
        .values({
          teamId: team.id,
          userId: teamAdmin.id,
          role: TeamMemberRole.Admin,
        })
        .run();

      const purchase = db
        .insert(purchases)
        .values({
          userId: teamAdmin.id,
          courseId: base.course.id,
          amountPaid: 9800,
          country: "US",
        })
        .returning()
        .get();

      const claimedCoupon = db
        .insert(coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: "CLAIM-1",
          purchaseId: purchase.id,
          redeemedByUserId: base.user.id,
          redeemedAt: "2026-10-06T12:00:00.000Z",
        })
        .returning()
        .get();

      db.insert(coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: "CLAIM-2",
          purchaseId: purchase.id,
        })
        .run();

      const adapter = new InMemoryNotificationAdapter();
      await notifySeatClaimed(
        db,
        { couponId: claimedCoupon.id, claimedByUserId: base.user.id },
        adapter
      );

      expect(adapter.triggered).toHaveLength(2);

      const adminEvent = adapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(teamAdmin.id))
      );
      expect(adminEvent?.workflow).toBe("seat-claimed");
      expect(adminEvent?.data).toMatchObject({
        kind: "transactional",
        subkind: "seat_claimed",
        courseTitle: base.course.title,
        studentName: base.user.name,
        studentEmail: base.user.email,
        claimedSeatCount: 1,
        seatCount: 2,
        deepLink: "/team",
      });

      const instructorEvent = adapter.triggered.find((t) =>
        t.recipients.some((r) => r.id === String(base.instructor.id))
      );
      expect(instructorEvent?.workflow).toBe("seat-claimed");
      expect(instructorEvent?.data).toMatchObject({
        kind: "transactional",
        subkind: "seat_claimed",
        courseTitle: base.course.title,
        studentName: base.user.name,
        studentEmail: base.user.email,
        deepLink: `/instructor/${base.course.id}/students`,
      });

      expect(await adapter.listFeed(String(base.user.id))).toHaveLength(0);
    });

    it("skips instructor when seatClaimedEnabled is false and excludes the claiming user even if they are the team admin", async () => {
      updateNotificationPreferences(db, base.instructor.id, {
        seatClaimedEnabled: false,
      });

      const teamAdmin = db
        .insert(users)
        .values({
          name: "Self Claiming Admin",
          email: "selfadmin@team.com",
          role: UserRole.Student,
        })
        .returning()
        .get();

      const team = db.insert(teams).values({}).returning().get();
      db.insert(teamMembers)
        .values({
          teamId: team.id,
          userId: teamAdmin.id,
          role: TeamMemberRole.Admin,
        })
        .run();

      const purchase = db
        .insert(purchases)
        .values({
          userId: teamAdmin.id,
          courseId: base.course.id,
          amountPaid: 4900,
          country: "US",
        })
        .returning()
        .get();

      const coupon1 = db
        .insert(coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: "SELF-1",
          purchaseId: purchase.id,
          redeemedByUserId: base.user.id,
          redeemedAt: "2026-10-06T12:00:00.000Z",
        })
        .returning()
        .get();

      const adapter = new InMemoryNotificationAdapter();
      await notifySeatClaimed(
        db,
        { couponId: coupon1.id, claimedByUserId: base.user.id },
        adapter
      );

      // Only Team Admin notified; instructor opted out, claiming student excluded
      expect(adapter.triggered).toHaveLength(1);
      expect(adapter.triggered[0].recipients.map((r) => r.id)).toEqual([
        String(teamAdmin.id),
      ]);

      // Now if teamAdmin claims a seat themselves, they must not be notified either
      const coupon2 = db
        .insert(coupons)
        .values({
          teamId: team.id,
          courseId: base.course.id,
          code: "SELF-2",
          purchaseId: purchase.id,
          redeemedByUserId: teamAdmin.id,
          redeemedAt: "2026-10-06T12:05:00.000Z",
        })
        .returning()
        .get();

      const adapter2 = new InMemoryNotificationAdapter();
      await notifySeatClaimed(
        db,
        { couponId: coupon2.id, claimedByUserId: teamAdmin.id },
        adapter2
      );

      expect(adapter2.triggered).toHaveLength(0);
    });
  });
});
