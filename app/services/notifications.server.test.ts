import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import {
  CourseStatus,
  PurchaseDigestFrequency,
  RefundPayoutStatus,
  RefundStatus,
  TeamMemberRole,
  UserRole,
  categories,
  comments,
  coupons,
  courses,
  enrollments,
  lessons,
  modules,
  purchases,
  refunds,
  teamMembers,
  teams,
  users,
} from "~/db/schema";
import {
  InMemoryNotificationAdapter,
  getNotificationPreferences,
  notifyCommentPosted,
  notifyCourseStatusChanged,
  notifyPurchaseCompleted,
  notifyRefundRequestDecided,
  notifyRefundRequestOpened,
  notifyRefundStatusChanged,
  notifySeatClaimed,
  transitionCourseStatus,
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

  describe("notifyCourseStatusChanged - course status transitions", () => {
    it("notifies the instructor when a Platform Admin changes their course status", async () => {
      const admin = db
        .insert(users)
        .values({
          name: "Platform Admin",
          email: "admin@example.com",
          role: UserRole.Admin,
        })
        .returning()
        .get();

      const draftCourse = db
        .insert(courses)
        .values({
          title: "Admin Moderated Course",
          slug: "admin-moderated-course",
          description: "A course moderated by admin",
          salesCopy: "Sales copy",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: CourseStatus.Archived,
          firstPublishedAt: "2026-01-01T00:00:00.000Z",
        })
        .returning()
        .get();

      const adapter = new InMemoryNotificationAdapter();

      await notifyCourseStatusChanged(
        db,
        {
          courseId: draftCourse.id,
          previousStatus: CourseStatus.Published,
          newStatus: CourseStatus.Archived,
          actorUserId: admin.id,
          isFirstPublish: false,
        },
        adapter
      );

      expect(adapter.triggered).toHaveLength(1);
      const trigger = adapter.triggered[0];
      expect(trigger.workflow).toBe("course-status-changed");
      expect(trigger.recipients.map((r) => r.id)).toEqual([
        String(base.instructor.id),
      ]);
      expect(trigger.actor?.id).toBe(String(admin.id));
      expect(trigger.data.kind).toBe("transactional");
      expect(trigger.data.subkind).toBe("course_status");
      expect(trigger.data.deepLink).toBe(`/instructor/${draftCourse.id}`);
      expect(trigger.data.previousStatus).toBe(CourseStatus.Published);
      expect(trigger.data.newStatus).toBe(CourseStatus.Archived);
      expect(trigger.data.courseTitle).toBe("Admin Moderated Course");
      expect(trigger.data.actorName).toBe("Platform Admin");
    });

    it("notifies all Platform Admins when an Instructor publishes a Draft course", async () => {
      const admin1 = db
        .insert(users)
        .values({
          name: "Admin One",
          email: "admin1@example.com",
          role: UserRole.Admin,
        })
        .returning()
        .get();
      const admin2 = db
        .insert(users)
        .values({
          name: "Admin Two",
          email: "admin2@example.com",
          role: UserRole.Admin,
        })
        .returning()
        .get();

      const publishedCourse = db
        .insert(courses)
        .values({
          title: "Instructor Newly Published",
          slug: "instructor-newly-published",
          description: "Newly published",
          salesCopy: "Sales copy",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: CourseStatus.Published,
          firstPublishedAt: "2026-02-01T00:00:00.000Z",
        })
        .returning()
        .get();

      const adapter = new InMemoryNotificationAdapter();

      await notifyCourseStatusChanged(
        db,
        {
          courseId: publishedCourse.id,
          previousStatus: CourseStatus.Draft,
          newStatus: CourseStatus.Published,
          actorUserId: base.instructor.id,
          isFirstPublish: false,
        },
        adapter
      );

      expect(adapter.triggered).toHaveLength(1);
      const trigger = adapter.triggered[0];
      expect(trigger.workflow).toBe("course-published-admin");
      expect(trigger.recipients.map((r) => r.id).sort()).toEqual(
        [String(admin1.id), String(admin2.id)].sort()
      );
      expect(trigger.actor?.id).toBe(String(base.instructor.id));
      expect(trigger.data.kind).toBe("transactional");
      expect(trigger.data.subkind).toBe("course_status");
      expect(trigger.data.deepLink).toBe("/admin/courses");
      expect(trigger.data.courseTitle).toBe("Instructor Newly Published");
      expect(trigger.data.instructorName).toBe(base.instructor.name);
    });

    it("emits course-recommendation on first publish to students with affinity by category or instructor, respecting exclusions and opt-out", async () => {
      const otherCategory = db
        .insert(categories)
        .values({ name: "Design", slug: "design" })
        .returning()
        .get();

      const otherInstructor = db
        .insert(users)
        .values({
          name: "Other Instructor",
          email: "other-inst@example.com",
          role: UserRole.Instructor,
        })
        .returning()
        .get();

      // Course in same category (Programming) by another instructor
      const sameCategoryCourse = db
        .insert(courses)
        .values({
          title: "Existing Programming Course",
          slug: "existing-programming",
          description: "Desc",
          salesCopy: "Sales",
          instructorId: otherInstructor.id,
          categoryId: base.category.id,
          status: CourseStatus.Published,
          firstPublishedAt: "2026-01-01T00:00:00.000Z",
        })
        .returning()
        .get();

      // Course in different category (Design) by base.instructor
      const sameInstructorCourse = db
        .insert(courses)
        .values({
          title: "Existing Design Course",
          slug: "existing-design",
          description: "Desc",
          salesCopy: "Sales",
          instructorId: base.instructor.id,
          categoryId: otherCategory.id,
          status: CourseStatus.Published,
          firstPublishedAt: "2026-01-01T00:00:00.000Z",
        })
        .returning()
        .get();

      // New course being published for the first time (Programming + base.instructor)
      const newCourse = db
        .insert(courses)
        .values({
          title: "Advanced TypeScript",
          slug: "advanced-typescript",
          description: "Desc",
          salesCopy: "Sales",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: CourseStatus.Published,
          firstPublishedAt: "2026-03-01T00:00:00.000Z",
        })
        .returning()
        .get();

      // Student 1: enrolled in sameCategoryCourse -> eligible (category affinity)
      const studentCat = base.user;
      db.insert(enrollments)
        .values({ userId: studentCat.id, courseId: sameCategoryCourse.id })
        .run();

      // Student 2: enrolled in sameInstructorCourse AND sameCategoryCourse -> eligible, must receive only 1 recommendation
      const studentBoth = db
        .insert(users)
        .values({
          name: "Student Both",
          email: "both@example.com",
          role: UserRole.Student,
        })
        .returning()
        .get();
      db.insert(enrollments)
        .values({ userId: studentBoth.id, courseId: sameInstructorCourse.id })
        .run();
      db.insert(enrollments)
        .values({ userId: studentBoth.id, courseId: sameCategoryCourse.id })
        .run();

      // Student 3: enrolled in sameCategoryCourse AND already enrolled in newCourse -> excluded
      const studentAlreadyEnrolled = db
        .insert(users)
        .values({
          name: "Already Enrolled",
          email: "already@example.com",
          role: UserRole.Student,
        })
        .returning()
        .get();
      db.insert(enrollments)
        .values({
          userId: studentAlreadyEnrolled.id,
          courseId: sameCategoryCourse.id,
        })
        .run();
      db.insert(enrollments)
        .values({ userId: studentAlreadyEnrolled.id, courseId: newCourse.id })
        .run();

      // Student 4: enrolled in sameCategoryCourse but opted out -> excluded
      const studentOptOut = db
        .insert(users)
        .values({
          name: "Opted Out",
          email: "optout@example.com",
          role: UserRole.Student,
        })
        .returning()
        .get();
      db.insert(enrollments)
        .values({ userId: studentOptOut.id, courseId: sameCategoryCourse.id })
        .run();
      updateNotificationPreferences(db, studentOptOut.id, {
        courseRecommendationsEnabled: false,
      });

      // Student 5: has no active enrollments (e.g. Lapsed/refunded) -> excluded
      db.insert(users)
        .values({
          name: "Lapsed Student",
          email: "lapsed@example.com",
          role: UserRole.Student,
        })
        .run();

      // Author instructor enrolled in sameCategoryCourse -> excluded
      db.insert(enrollments)
        .values({ userId: base.instructor.id, courseId: sameCategoryCourse.id })
        .run();

      const adapter = new InMemoryNotificationAdapter();

      await notifyCourseStatusChanged(
        db,
        {
          courseId: newCourse.id,
          previousStatus: CourseStatus.Draft,
          newStatus: CourseStatus.Published,
          actorUserId: base.instructor.id,
          isFirstPublish: true,
        },
        adapter
      );

      const recTriggers = adapter.triggered.filter(
        (t) => t.workflow === "course-recommendation"
      );
      expect(recTriggers).toHaveLength(2);

      const recipientIds = recTriggers.flatMap((t) =>
        t.recipients.map((r) => r.id)
      );
      expect(recipientIds.sort()).toEqual(
        [String(studentCat.id), String(studentBoth.id)].sort()
      );

      const catTrigger = recTriggers.find(
        (t) => t.recipients[0].id === String(studentCat.id)
      );
      expect(catTrigger?.idempotencyKey).toBe(
        `course-rec-${newCourse.id}-${studentCat.id}`
      );
      expect(catTrigger?.data.kind).toBe("engagement");
      expect(catTrigger?.data.subkind).toBe("course_recommendation");
      expect(catTrigger?.data.deepLink).toBe(`/courses/${newCourse.slug}`);
      expect(catTrigger?.data.courseTitle).toBe("Advanced TypeScript");
      expect(catTrigger?.data.instructorName).toBe(base.instructor.name);
      expect(catTrigger?.data.categoryName).toBe(base.category.name);
      expect(String(catTrigger?.data.affinityReason).length).toBeGreaterThan(0);

      // Re-publishing (isFirstPublish: false) must NOT emit course-recommendation
      const adapterRepublish = new InMemoryNotificationAdapter();
      await notifyCourseStatusChanged(
        db,
        {
          courseId: newCourse.id,
          previousStatus: CourseStatus.Archived,
          newStatus: CourseStatus.Published,
          actorUserId: base.instructor.id,
          isFirstPublish: false,
        },
        adapterRepublish
      );
      expect(
        adapterRepublish.triggered.filter(
          (t) => t.workflow === "course-recommendation"
        )
      ).toHaveLength(0);
    });

    it("transitionCourseStatus sets firstPublishedAt only on first publish and prevents duplicate recommendations on republish", async () => {
      const { eq } = await import("drizzle-orm");
      const draftCourse = db
        .insert(courses)
        .values({
          title: "Lifecycle Course",
          slug: "lifecycle-course",
          description: "Desc",
          salesCopy: "Sales",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: CourseStatus.Draft,
          firstPublishedAt: null,
        })
        .returning()
        .get();

      // Enroll base.user in base.course (same category & instructor)
      db.insert(enrollments)
        .values({ userId: base.user.id, courseId: base.course.id })
        .run();

      const adapter = new InMemoryNotificationAdapter();
      const firstPublishTime = new Date("2026-04-01T10:00:00.000Z");

      await transitionCourseStatus(
        db,
        {
          courseId: draftCourse.id,
          newStatus: CourseStatus.Published,
          actorUserId: base.instructor.id,
          now: firstPublishTime,
        },
        adapter
      );

      const afterFirstPublish = db
        .select()
        .from(courses)
        .where(eq(courses.id, draftCourse.id))
        .get();
      expect(afterFirstPublish?.status).toBe(CourseStatus.Published);
      expect(afterFirstPublish?.firstPublishedAt).toBe(
        firstPublishTime.toISOString()
      );
      expect(
        adapter.triggered.filter((t) => t.workflow === "course-recommendation")
      ).toHaveLength(1);

      // Move to Draft, then republish later
      await transitionCourseStatus(
        db,
        {
          courseId: draftCourse.id,
          newStatus: CourseStatus.Draft,
          actorUserId: base.instructor.id,
          now: new Date("2026-04-02T10:00:00.000Z"),
        },
        adapter
      );

      const secondAdapter = new InMemoryNotificationAdapter();
      await transitionCourseStatus(
        db,
        {
          courseId: draftCourse.id,
          newStatus: CourseStatus.Published,
          actorUserId: base.instructor.id,
          now: new Date("2026-04-03T10:00:00.000Z"),
        },
        secondAdapter
      );

      const afterRepublish = db
        .select()
        .from(courses)
        .where(eq(courses.id, draftCourse.id))
        .get();
      expect(afterRepublish?.firstPublishedAt).toBe(
        firstPublishTime.toISOString()
      );
      expect(
        secondAdapter.triggered.filter(
          (t) => t.workflow === "course-recommendation"
        )
      ).toHaveLength(0);
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
