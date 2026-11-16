import Knock from "@knocklabs/node";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  PurchaseDigestFrequency,
  TeamMemberRole,
  comments,
  coupons,
  courses,
  lessons,
  modules,
  notificationPreferences,
  purchases,
  teamMembers,
  users,
} from "~/db/schema";
import { formatPrice } from "~/lib/utils";

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

/**
 * Emits purchase notifications (`individual-purchase-completed` or `team-licence-purchased`)
 * to the buyer and `instructor-purchase-digest` to the course instructor when enabled.
 */
export async function notifyPurchaseCompleted(
  db: Db,
  params: { purchaseId: number },
  adapter: NotificationProviderAdapter = getNotificationAdapter()
): Promise<void> {
  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, params.purchaseId))
    .get();

  if (!purchase) {
    return;
  }

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, purchase.courseId))
    .get();

  if (!course) {
    return;
  }

  const buyer = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, purchase.userId))
    .get();

  if (!buyer) {
    return;
  }

  const purchaseCoupons = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchase.id))
    .all();

  const seatCount = purchaseCoupons.length;
  const isTeamLicence = seatCount > 0;
  const formattedPrice = formatPrice(purchase.amountPaid);

  if (isTeamLicence) {
    await adapter.triggerWorkflow({
      workflow: "team-licence-purchased",
      recipients: [toNotificationRecipient(buyer)],
      actor: toNotificationRecipient(buyer),
      data: {
        kind: "transactional",
        subkind: "team_licence_purchase",
        badgeLabel: "Team Licence",
        title: `Team Licence purchased for "${course.title}"`,
        body: `${seatCount} seats for ${course.title} (${formattedPrice})`,
        meta: `Course: ${course.title} · ${seatCount} seats`,
        deepLink: "/team",
        ctaLabel: "Manage Team",
        courseId: course.id,
        courseTitle: course.title,
        courseSlug: course.slug,
        amountPaid: purchase.amountPaid,
        seatCount,
        purchaseId: purchase.id,
        createdAt: purchase.createdAt,
      },
    });
  } else {
    await adapter.triggerWorkflow({
      workflow: "individual-purchase-completed",
      recipients: [toNotificationRecipient(buyer)],
      actor: toNotificationRecipient(buyer),
      data: {
        kind: "transactional",
        subkind: "individual_purchase",
        badgeLabel: "Purchase",
        title: `Welcome to "${course.title}"`,
        body: `Purchase confirmed for ${course.title} (${formattedPrice})`,
        meta: `Course: ${course.title} · ${formattedPrice}`,
        deepLink: `/courses/${course.slug}/welcome`,
        ctaLabel: "Go to Course",
        courseId: course.id,
        courseTitle: course.title,
        courseSlug: course.slug,
        amountPaid: purchase.amountPaid,
        purchaseId: purchase.id,
        createdAt: purchase.createdAt,
      },
    });
  }

  const instructorPrefs = getNotificationPreferences(db, course.instructorId);
  if (instructorPrefs.purchaseDigestFrequency === PurchaseDigestFrequency.Off) {
    return;
  }

  const instructor = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, course.instructorId))
    .get();

  if (!instructor) {
    return;
  }

  const digestFrequency = instructorPrefs.purchaseDigestFrequency;
  const purchaseType = isTeamLicence ? "team_licence" : "individual";

  await adapter.triggerWorkflow({
    workflow: "instructor-purchase-digest",
    recipients: [toNotificationRecipient(instructor)],
    actor: toNotificationRecipient(buyer),
    data: {
      kind: "transactional",
      subkind: "purchase_digest",
      badgeLabel: "Purchase Digest",
      title: `New ${isTeamLicence ? "Team Licence" : "Individual Purchase"}: "${course.title}"`,
      body: isTeamLicence
        ? `${seatCount} seats · ${formattedPrice}`
        : `${formattedPrice}`,
      meta: `Digest (${digestFrequency}) · ${course.title}`,
      deepLink: "/instructor/analytics",
      ctaLabel: "View Analytics",
      batchKey: `instructor-purchase-digest:${instructor.id}:${digestFrequency}`,
      instructorId: instructor.id,
      digestFrequency,
      window: digestFrequency,
      purchaseType,
      individualCount: isTeamLicence ? 0 : 1,
      teamLicenceCount: isTeamLicence ? 1 : 0,
      seatCount,
      amountPaid: purchase.amountPaid,
      courseId: course.id,
      courseTitle: course.title,
      courseSlug: course.slug,
      purchaseId: purchase.id,
      createdAt: purchase.createdAt,
    },
  });
}

/**
 * Emits `seat-claimed` notifications when a Student redeems a Team Licence Seat:
 * - Mandatorily to the Team Admin (unless they are the claiming student)
 * - To the Course Instructor if `seatClaimedEnabled === true` (unless they are the claiming student)
 */
export async function notifySeatClaimed(
  db: Db,
  params: { couponId: number; claimedByUserId: number },
  adapter: NotificationProviderAdapter = getNotificationAdapter()
): Promise<void> {
  const coupon = db
    .select()
    .from(coupons)
    .where(eq(coupons.id, params.couponId))
    .get();

  if (!coupon) {
    return;
  }

  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, coupon.courseId))
    .get();

  if (!course) {
    return;
  }

  const claimingStudent = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, params.claimedByUserId))
    .get();

  if (!claimingStudent) {
    return;
  }

  const licenceSeats = db
    .select({
      id: coupons.id,
      redeemedByUserId: coupons.redeemedByUserId,
    })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, coupon.purchaseId), isNull(coupons.refundedAt))
    )
    .all();

  const seatCount = licenceSeats.length;
  const claimedSeatCount = licenceSeats.filter(
    (s) => s.redeemedByUserId !== null
  ).length;
  const createdAt = coupon.redeemedAt ?? new Date().toISOString();

  const teamAdminMember = db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, coupon.teamId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  const purchase = db
    .select({ userId: purchases.userId })
    .from(purchases)
    .where(eq(purchases.id, coupon.purchaseId))
    .get();

  const teamAdminId = teamAdminMember?.userId ?? purchase?.userId;

  if (teamAdminId !== undefined && teamAdminId !== params.claimedByUserId) {
    const teamAdmin = db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, teamAdminId))
      .get();

    if (teamAdmin) {
      await adapter.triggerWorkflow({
        workflow: "seat-claimed",
        recipients: [toNotificationRecipient(teamAdmin)],
        actor: toNotificationRecipient(claimingStudent),
        data: {
          kind: "transactional",
          subkind: "seat_claimed",
          badgeLabel: "Seat Claimed",
          title: `${claimingStudent.name} claimed a seat for "${course.title}"`,
          body: `${claimingStudent.name} (${claimingStudent.email}) · ${claimedSeatCount}/${seatCount} seats claimed`,
          meta: `Course: ${course.title} · ${claimedSeatCount}/${seatCount} seats`,
          deepLink: "/team",
          ctaLabel: "View Team",
          courseId: course.id,
          courseTitle: course.title,
          courseSlug: course.slug,
          studentName: claimingStudent.name,
          studentEmail: claimingStudent.email,
          claimedSeatCount,
          seatCount,
          couponId: coupon.id,
          createdAt,
        },
      });
    }
  }

  if (course.instructorId === params.claimedByUserId) {
    return;
  }

  const instructorPrefs = getNotificationPreferences(db, course.instructorId);
  if (!instructorPrefs.seatClaimedEnabled) {
    return;
  }

  const instructor = db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, course.instructorId))
    .get();

  if (!instructor) {
    return;
  }

  await adapter.triggerWorkflow({
    workflow: "seat-claimed",
    recipients: [toNotificationRecipient(instructor)],
    actor: toNotificationRecipient(claimingStudent),
    data: {
      kind: "transactional",
      subkind: "seat_claimed",
      badgeLabel: "Seat Claimed",
      title: `${claimingStudent.name} claimed a seat for "${course.title}"`,
      body: `${claimingStudent.name} (${claimingStudent.email})`,
      meta: `Course: ${course.title} · Student enrolled`,
      deepLink: `/instructor/${course.id}/students`,
      ctaLabel: "View Students",
      courseId: course.id,
      courseTitle: course.title,
      courseSlug: course.slug,
      studentName: claimingStudent.name,
      studentEmail: claimingStudent.email,
      claimedSeatCount,
      seatCount,
      couponId: coupon.id,
      createdAt,
    },
  });
}
