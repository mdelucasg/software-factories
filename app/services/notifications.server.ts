import Knock from "@knocklabs/node";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  CourseStatus,
  PurchaseDigestFrequency,
  UserRole,
  categories,
  comments,
  courses,
  enrollments,
  lessons,
  modules,
  notificationPreferences,
  users,
} from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;

export type CanonicalDomainRole =
  | "Student"
  | "Instructor"
  | "Team Admin"
  | "Platform Admin";

export type NotificationKind = "transactional" | "engagement";

export type NotificationSubkind =
  | "adherence_reminder"
  | "course_recommendation"
  | "comment_root"
  | "comment_reply"
  | "individual_purchase"
  | "team_licence_purchase"
  | "purchase_digest"
  | "seat_claimed"
  | "refund_open"
  | "refund_approved"
  | "refund_declined"
  | "refund_issued"
  | "refund_failed"
  | "course_status";

export interface NotificationPreferences {
  userId: number;
  commentsEnabled: boolean;
  seatClaimedEnabled: boolean;
  purchaseDigestFrequency: PurchaseDigestFrequency;
  adherenceRemindersEnabled: boolean;
  courseRecommendationsEnabled: boolean;
}

export interface NotificationRecipient {
  id: string;
  name: string;
  email: string;
}

export interface InAppNotificationItem {
  id: string;
  userId: string;
  kind: NotificationKind;
  subkind: NotificationSubkind;
  badgeLabel: string;
  title: string;
  body: string;
  meta: string;
  createdAt: string;
  deepLink: string;
  ctaLabel: string;
  unread: boolean;
  progressPercent?: number;
  urgent?: boolean;
}

export interface NotificationTriggerInput {
  workflow: string;
  recipients: NotificationRecipient[];
  actor?: NotificationRecipient;
  data: Record<string, unknown>;
  cancellationKey?: string;
  idempotencyKey?: string;
}

export interface NotificationProviderAdapter {
  triggerWorkflow(input: NotificationTriggerInput): Promise<void>;
  listFeed(userId: string): Promise<InAppNotificationItem[]>;
  markAsRead(userId: string, itemId: string): Promise<void>;
  markAllAsRead(userId: string): Promise<void>;
  cancelWorkflow(workflow: string, cancellationKey: string): Promise<void>;
}

const DEFAULT_PREFERENCES: Omit<NotificationPreferences, "userId"> = {
  commentsEnabled: true,
  seatClaimedEnabled: true,
  purchaseDigestFrequency: PurchaseDigestFrequency.Daily,
  adherenceRemindersEnabled: true,
  courseRecommendationsEnabled: true,
};

/**
 * Reads notification preferences for a user, falling back to canonical defaults
 * when no row has been persisted yet.
 */
export function getNotificationPreferences(
  db: Db,
  userId: number
): NotificationPreferences {
  const row = db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .get();

  if (!row) {
    return {
      userId,
      ...DEFAULT_PREFERENCES,
    };
  }

  return {
    userId: row.userId,
    commentsEnabled: row.commentsEnabled,
    seatClaimedEnabled: row.seatClaimedEnabled,
    purchaseDigestFrequency: row.purchaseDigestFrequency,
    adherenceRemindersEnabled: row.adherenceRemindersEnabled,
    courseRecommendationsEnabled: row.courseRecommendationsEnabled,
  };
}

/**
 * Upserts notification preferences for a user in SQLite and returns the resulting record.
 */
export function updateNotificationPreferences(
  db: Db,
  userId: number,
  patch: Partial<Omit<NotificationPreferences, "userId">>,
  now: Date = new Date()
): NotificationPreferences {
  const current = getNotificationPreferences(db, userId);
  const next: NotificationPreferences = {
    userId,
    commentsEnabled: patch.commentsEnabled ?? current.commentsEnabled,
    seatClaimedEnabled: patch.seatClaimedEnabled ?? current.seatClaimedEnabled,
    purchaseDigestFrequency:
      patch.purchaseDigestFrequency ?? current.purchaseDigestFrequency,
    adherenceRemindersEnabled:
      patch.adherenceRemindersEnabled ?? current.adherenceRemindersEnabled,
    courseRecommendationsEnabled:
      patch.courseRecommendationsEnabled ??
      current.courseRecommendationsEnabled,
  };

  db.insert(notificationPreferences)
    .values({
      userId,
      commentsEnabled: next.commentsEnabled,
      seatClaimedEnabled: next.seatClaimedEnabled,
      purchaseDigestFrequency: next.purchaseDigestFrequency,
      adherenceRemindersEnabled: next.adherenceRemindersEnabled,
      courseRecommendationsEnabled: next.courseRecommendationsEnabled,
      updatedAt: now.toISOString(),
    })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: {
        commentsEnabled: next.commentsEnabled,
        seatClaimedEnabled: next.seatClaimedEnabled,
        purchaseDigestFrequency: next.purchaseDigestFrequency,
        adherenceRemindersEnabled: next.adherenceRemindersEnabled,
        courseRecommendationsEnabled: next.courseRecommendationsEnabled,
        updatedAt: now.toISOString(),
      },
    })
    .run();

  return next;
}

/**
 * Deterministic in-memory notification adapter for tests, seeding, and offline dev.
 */
export class InMemoryNotificationAdapter implements NotificationProviderAdapter {
  public readonly triggered: NotificationTriggerInput[] = [];
  public readonly cancelled: Array<{ workflow: string; cancellationKey: string }> = [];
  private readonly feedByUser = new Map<string, InAppNotificationItem[]>();
  private nextId = 1;

  async triggerWorkflow(input: NotificationTriggerInput): Promise<void> {
    this.triggered.push(input);

    const kind =
      input.data.kind === "engagement" ? "engagement" : "transactional";
    const subkind = isNotificationSubkind(input.data.subkind)
      ? input.data.subkind
      : "comment_root";
    const badgeLabel =
      typeof input.data.badgeLabel === "string"
        ? input.data.badgeLabel
        : "Notificación";
    const title =
      typeof input.data.title === "string" ? input.data.title : input.workflow;
    const body =
      typeof input.data.body === "string"
        ? input.data.body
        : typeof input.data.excerpt === "string"
          ? input.data.excerpt
          : "";
    const meta = typeof input.data.meta === "string" ? input.data.meta : "";
    const deepLink =
      typeof input.data.deepLink === "string" ? input.data.deepLink : "/";
    const ctaLabel =
      typeof input.data.ctaLabel === "string" ? input.data.ctaLabel : "Ver";
    const createdAt =
      typeof input.data.createdAt === "string"
        ? input.data.createdAt
        : new Date().toISOString();

    for (const recipient of input.recipients) {
      const existing = this.feedByUser.get(recipient.id) ?? [];
      const item: InAppNotificationItem = {
        id: `mem-notif-${this.nextId++}`,
        userId: recipient.id,
        kind,
        subkind,
        badgeLabel,
        title,
        body,
        meta,
        createdAt,
        deepLink,
        ctaLabel,
        unread: true,
        ...(typeof input.data.progressPercent === "number"
          ? { progressPercent: input.data.progressPercent }
          : {}),
        ...(typeof input.data.urgent === "boolean"
          ? { urgent: input.data.urgent }
          : {}),
      };
      this.feedByUser.set(recipient.id, [item, ...existing]);
    }
  }

  async listFeed(userId: string): Promise<InAppNotificationItem[]> {
    return [...(this.feedByUser.get(userId) ?? [])];
  }

  async markAsRead(userId: string, itemId: string): Promise<void> {
    const items = this.feedByUser.get(userId);
    if (!items) return;
    this.feedByUser.set(
      userId,
      items.map((item) =>
        item.id === itemId ? { ...item, unread: false } : item
      )
    );
  }

  async markAllAsRead(userId: string): Promise<void> {
    const items = this.feedByUser.get(userId);
    if (!items) return;
    this.feedByUser.set(
      userId,
      items.map((item) => ({ ...item, unread: false }))
    );
  }

  async cancelWorkflow(
    workflow: string,
    cancellationKey: string
  ): Promise<void> {
    this.cancelled.push({ workflow, cancellationKey });
  }
}

const NOTIFICATION_SUBKINDS: ReadonlySet<string> = new Set<NotificationSubkind>([
  "adherence_reminder",
  "course_recommendation",
  "comment_root",
  "comment_reply",
  "individual_purchase",
  "team_licence_purchase",
  "purchase_digest",
  "seat_claimed",
  "refund_open",
  "refund_approved",
  "refund_declined",
  "refund_issued",
  "refund_failed",
  "course_status",
]);

function isNotificationSubkind(value: unknown): value is NotificationSubkind {
  return typeof value === "string" && NOTIFICATION_SUBKINDS.has(value);
}

/**
 * Knock-backed notification adapter used when KNOCK_SECRET_KEY is configured.
 */
export class KnockNotificationAdapter implements NotificationProviderAdapter {
  private readonly client: Knock;

  constructor(apiKey: string) {
    this.client = new Knock({ apiKey });
  }

  async triggerWorkflow(input: NotificationTriggerInput): Promise<void> {
    await this.client.workflows.trigger(input.workflow, {
      recipients: input.recipients.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
      })),
      ...(input.actor
        ? {
            actor: {
              id: input.actor.id,
              name: input.actor.name,
              email: input.actor.email,
            },
          }
        : {}),
      data: input.data,
      ...(input.cancellationKey
        ? { cancellation_key: input.cancellationKey }
        : {}),
    });
  }

  async listFeed(_userId: string): Promise<InAppNotificationItem[]> {
    // Client-side @knocklabs/react KnockFeedProvider manages the Knock feed when public keys are configured.
    return [];
  }

  async markAsRead(_userId: string, _itemId: string): Promise<void> {
    // Handled client-side by KnockFeedProvider when public keys are configured.
  }

  async markAllAsRead(_userId: string): Promise<void> {
    // Handled client-side by KnockFeedProvider when public keys are configured.
  }

  async cancelWorkflow(
    workflow: string,
    cancellationKey: string
  ): Promise<void> {
    await this.client.workflows.cancel(workflow, {
      cancellation_key: cancellationKey,
    });
  }
}

const globalForNotifications = globalThis as {
  __cadenceInMemoryNotificationAdapter?: InMemoryNotificationAdapter;
};

export function getSharedInMemoryNotificationAdapter(): InMemoryNotificationAdapter {
  if (!globalForNotifications.__cadenceInMemoryNotificationAdapter) {
    globalForNotifications.__cadenceInMemoryNotificationAdapter =
      new InMemoryNotificationAdapter();
  }
  return globalForNotifications.__cadenceInMemoryNotificationAdapter;
}

export function getNotificationAdapter(): NotificationProviderAdapter {
  const apiKey = process.env.KNOCK_SECRET_KEY?.trim();
  if (apiKey) {
    return new KnockNotificationAdapter(apiKey);
  }
  return getSharedInMemoryNotificationAdapter();
}

function stripMarkdownToExcerpt(markdown: string, maxLength = 120): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= maxLength) {
    return plain;
  }
  return `${plain.slice(0, maxLength).trimEnd()}...`;
}

function toNotificationRecipient(user: {
  id: number;
  name: string;
  email: string;
}): NotificationRecipient {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
  };
}

/**
 * Emits comment notifications (`comment-root-posted` or `comment-reply-posted`)
 * respecting author exclusion, soft-deleted thread exclusion, and user preferences.
 */
export async function notifyCommentPosted(
  db: Db,
  params: { commentId: number; lessonId: number; authorId: number },
  adapter: NotificationProviderAdapter = getNotificationAdapter()
): Promise<void> {
  const postedComment = db
    .select()
    .from(comments)
    .where(eq(comments.id, params.commentId))
    .get();

  if (!postedComment || postedComment.deletedAt !== null) {
    return;
  }

  const lessonRow = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, params.lessonId))
    .get();

  if (!lessonRow) {
    return;
  }

  const author = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, params.authorId))
    .get();

  if (!author) {
    return;
  }

  const excerpt = stripMarkdownToExcerpt(postedComment.body, 120);
  const deepLink = `/courses/${lessonRow.courseSlug}/lessons/${lessonRow.lessonId}#comment-${postedComment.id}`;

  if (postedComment.parentId === null) {
    if (lessonRow.instructorId === params.authorId) {
      return;
    }

    const instructorPrefs = getNotificationPreferences(
      db,
      lessonRow.instructorId
    );
    if (!instructorPrefs.commentsEnabled) {
      return;
    }

    const instructor = db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, lessonRow.instructorId))
      .get();

    if (!instructor) {
      return;
    }

    await adapter.triggerWorkflow({
      workflow: "comment-root-posted",
      recipients: [toNotificationRecipient(instructor)],
      actor: toNotificationRecipient(author),
      data: {
        kind: "transactional",
        subkind: "comment_root",
        badgeLabel: "New Comment",
        title: `${author.name} commented on "${lessonRow.lessonTitle}"`,
        body: excerpt,
        excerpt,
        meta: `Course: ${lessonRow.courseTitle} · Lesson #${lessonRow.lessonId}`,
        deepLink,
        ctaLabel: "View Comment",
        courseTitle: lessonRow.courseTitle,
        courseSlug: lessonRow.courseSlug,
        lessonId: lessonRow.lessonId,
        lessonTitle: lessonRow.lessonTitle,
        commentId: postedComment.id,
        createdAt: postedComment.createdAt,
      },
    });
    return;
  }

  const recipientIds = new Set<number>();
  const rootComment = db
    .select({ userId: comments.userId, deletedAt: comments.deletedAt })
    .from(comments)
    .where(eq(comments.id, postedComment.parentId))
    .get();

  if (rootComment && rootComment.deletedAt === null) {
    recipientIds.add(rootComment.userId);
  }

  const threadReplies = db
    .select({
      id: comments.id,
      userId: comments.userId,
      deletedAt: comments.deletedAt,
    })
    .from(comments)
    .where(
      and(
        eq(comments.parentId, postedComment.parentId),
        isNull(comments.deletedAt)
      )
    )
    .all();

  for (const reply of threadReplies) {
    if (reply.id !== postedComment.id) {
      recipientIds.add(reply.userId);
    }
  }

  recipientIds.add(lessonRow.instructorId);
  recipientIds.delete(params.authorId);

  const eligibleRecipients: NotificationRecipient[] = [];
  for (const recipientId of recipientIds) {
    const prefs = getNotificationPreferences(db, recipientId);
    if (!prefs.commentsEnabled) continue;

    const userRow = db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, recipientId))
      .get();

    if (userRow) {
      eligibleRecipients.push(toNotificationRecipient(userRow));
    }
  }

  if (eligibleRecipients.length === 0) {
    return;
  }

  await adapter.triggerWorkflow({
    workflow: "comment-reply-posted",
    recipients: eligibleRecipients,
    actor: toNotificationRecipient(author),
    data: {
      kind: "transactional",
      subkind: "comment_reply",
      badgeLabel: "Comment Reply",
      title: `${author.name} replied in "${lessonRow.lessonTitle}"`,
      body: excerpt,
      excerpt,
      meta: `Course: ${lessonRow.courseTitle} · Lesson #${lessonRow.lessonId}`,
      deepLink,
      ctaLabel: "View Reply",
      courseTitle: lessonRow.courseTitle,
      courseSlug: lessonRow.courseSlug,
      lessonId: lessonRow.lessonId,
      lessonTitle: lessonRow.lessonTitle,
      commentId: postedComment.id,
      parentId: postedComment.parentId,
      createdAt: postedComment.createdAt,
    },
  });
}

export interface CourseStatusChangedParams {
  courseId: number;
  previousStatus: CourseStatus;
  newStatus: CourseStatus;
  actorUserId: number;
  isFirstPublish: boolean;
}

/**
 * Emits course moderation/publish notifications (`course-status-changed`,
 * `course-published-admin`) and first-publish `course-recommendation` workflows.
 */
export async function notifyCourseStatusChanged(
  db: Db,
  params: CourseStatusChangedParams,
  adapter: NotificationProviderAdapter = getNotificationAdapter()
): Promise<void> {
  const course = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      instructorId: courses.instructorId,
      categoryId: courses.categoryId,
    })
    .from(courses)
    .where(eq(courses.id, params.courseId))
    .get();

  if (!course) {
    return;
  }

  const actor = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, params.actorUserId))
    .get();

  if (!actor) {
    return;
  }

  const instructor = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, course.instructorId))
    .get();

  if (
    actor.role === UserRole.Admin &&
    actor.id !== course.instructorId &&
    instructor
  ) {
    await adapter.triggerWorkflow({
      workflow: "course-status-changed",
      recipients: [toNotificationRecipient(instructor)],
      actor: toNotificationRecipient(actor),
      data: {
        kind: "transactional",
        subkind: "course_status",
        badgeLabel: "Course Status",
        title: `Course "${course.title}" status changed to ${params.newStatus}`,
        body: `${actor.name} changed "${course.title}" from ${params.previousStatus} to ${params.newStatus}.`,
        meta: `Course: ${course.title} · ${params.previousStatus} → ${params.newStatus}`,
        deepLink: `/instructor/${course.id}`,
        ctaLabel: "View Course",
        courseId: course.id,
        courseTitle: course.title,
        previousStatus: params.previousStatus,
        newStatus: params.newStatus,
        actorName: actor.name,
      },
    });
  }

  if (
    actor.role === UserRole.Instructor &&
    params.previousStatus === CourseStatus.Draft &&
    params.newStatus === CourseStatus.Published
  ) {
    const admins = db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(eq(users.role, UserRole.Admin))
      .all();

    if (admins.length > 0) {
      await adapter.triggerWorkflow({
        workflow: "course-published-admin",
        recipients: admins.map(toNotificationRecipient),
        actor: toNotificationRecipient(actor),
        data: {
          kind: "transactional",
          subkind: "course_status",
          badgeLabel: "Course Published",
          title: `${actor.name} published "${course.title}"`,
          body: `Instructor ${actor.name} transitioned "${course.title}" from Draft to Published.`,
          meta: `Course: ${course.title} · Published by ${actor.name}`,
          deepLink: "/admin/courses",
          ctaLabel: "Review Courses",
          courseId: course.id,
          courseTitle: course.title,
          instructorName: actor.name,
        },
      });
    }
  }

  if (params.newStatus === CourseStatus.Published && params.isFirstPublish) {
    const category = db
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.id, course.categoryId))
      .get();

    const categoryName = category?.name ?? "this category";
    const instructorName = instructor?.name ?? "the instructor";

    const enrolledInTarget = new Set(
      db
        .select({ userId: enrollments.userId })
        .from(enrollments)
        .where(eq(enrollments.courseId, course.id))
        .all()
        .map((row) => row.userId)
    );

    const affinityRows = db
      .select({
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        enrolledCourseCategoryId: courses.categoryId,
        enrolledCourseInstructorId: courses.instructorId,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .innerJoin(users, eq(enrollments.userId, users.id))
      .where(
        and(
          ne(courses.id, course.id),
          ne(users.id, course.instructorId),
          eq(users.role, UserRole.Student),
          or(
            eq(courses.categoryId, course.categoryId),
            eq(courses.instructorId, course.instructorId)
          )
        )
      )
      .all();

    const candidates = new Map<
      number,
      {
        recipient: NotificationRecipient;
        sameCategory: boolean;
        sameInstructor: boolean;
      }
    >();

    for (const row of affinityRows) {
      if (enrolledInTarget.has(row.userId)) {
        continue;
      }

      const existing = candidates.get(row.userId);
      const sameCategory =
        (existing?.sameCategory ?? false) ||
        row.enrolledCourseCategoryId === course.categoryId;
      const sameInstructor =
        (existing?.sameInstructor ?? false) ||
        row.enrolledCourseInstructorId === course.instructorId;

      candidates.set(row.userId, {
        recipient: {
          id: String(row.userId),
          name: row.userName,
          email: row.userEmail,
        },
        sameCategory,
        sameInstructor,
      });
    }

    for (const [studentId, candidate] of candidates.entries()) {
      const prefs = getNotificationPreferences(db, studentId);
      if (!prefs.courseRecommendationsEnabled) {
        continue;
      }

      const affinityReason =
        candidate.sameCategory && candidate.sameInstructor
          ? `Because you're enrolled in ${categoryName} and courses by ${instructorName}`
          : candidate.sameCategory
            ? `Because you're enrolled in ${categoryName}`
            : `Because you're taking a course by ${instructorName}`;

      const idempotencyKey = `course-rec-${course.id}-${studentId}`;

      await adapter.triggerWorkflow({
        workflow: "course-recommendation",
        recipients: [candidate.recipient],
        ...(instructor ? { actor: toNotificationRecipient(instructor) } : {}),
        idempotencyKey,
        cancellationKey: idempotencyKey,
        data: {
          kind: "engagement",
          subkind: "course_recommendation",
          badgeLabel: "Course Recommendation",
          title: `New course: ${course.title}`,
          body: affinityReason,
          meta: `${categoryName} · ${instructorName}`,
          deepLink: `/courses/${course.slug}`,
          ctaLabel: "View Course",
          courseId: course.id,
          courseTitle: course.title,
          courseSlug: course.slug,
          instructorName,
          categoryName,
          affinityReason,
          idempotencyKey,
        },
      });
    }
  }
}

export interface TransitionCourseStatusParams {
  courseId: number;
  newStatus: CourseStatus;
  actorUserId: number;
  now?: Date;
}

/**
 * Transitions a course's status, records `firstPublishedAt` on its initial publish,
 * and dispatches status-change and first-publish recommendation notifications.
 */
export async function transitionCourseStatus(
  db: Db,
  params: TransitionCourseStatusParams,
  adapter: NotificationProviderAdapter = getNotificationAdapter()
) {
  const existing = db
    .select({
      id: courses.id,
      status: courses.status,
      firstPublishedAt: courses.firstPublishedAt,
    })
    .from(courses)
    .where(eq(courses.id, params.courseId))
    .get();

  if (!existing) {
    return null;
  }

  const nowIso = (params.now ?? new Date()).toISOString();
  const isFirstPublish =
    params.newStatus === CourseStatus.Published &&
    existing.firstPublishedAt === null;

  const updated = db
    .update(courses)
    .set({
      status: params.newStatus,
      updatedAt: nowIso,
      ...(isFirstPublish ? { firstPublishedAt: nowIso } : {}),
    })
    .where(eq(courses.id, params.courseId))
    .returning()
    .get();

  if (existing.status !== params.newStatus) {
    await notifyCourseStatusChanged(
      db,
      {
        courseId: params.courseId,
        previousStatus: existing.status,
        newStatus: params.newStatus,
        actorUserId: params.actorUserId,
        isFirstPublish,
      },
      adapter
    );
  }

  return updated;
}
