import Knock from "@knocklabs/node";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  PurchaseDigestFrequency,
  UserRole,
  comments,
  coupons,
  courses,
  lessons,
  modules,
  notificationPreferences,
  purchases,
  refunds,
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

interface RefundNotificationContext {
  refundRequestId: number;
  reason: string;
  amountPaid: number;
  amountRefunded: number;
  decisionNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  instructorId: number;
  buyer: NotificationRecipient;
  purchaseKind: "individual_purchase" | "team_licence";
  buyerDeepLink: "/settings" | "/team";
}

function loadRefundNotificationContext(
  db: Db,
  refundRequestId: number
): RefundNotificationContext | null {
  const row = db
    .select({
      refundRequestId: refunds.id,
      reason: refunds.reason,
      amountRefunded: refunds.amountRefunded,
      decisionNote: refunds.decisionNote,
      requestedAt: refunds.requestedAt,
      resolvedAt: refunds.resolvedAt,
      purchaseId: purchases.id,
      amountPaid: purchases.amountPaid,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
      buyerId: users.id,
      buyerName: users.name,
      buyerEmail: users.email,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(eq(refunds.id, refundRequestId))
    .get();

  if (!row) {
    return null;
  }

  const hasSeats = Boolean(
    db
      .select({ id: coupons.id })
      .from(coupons)
      .where(eq(coupons.purchaseId, row.purchaseId))
      .get()
  );
  const purchaseKind = hasSeats ? "team_licence" : "individual_purchase";

  return {
    refundRequestId: row.refundRequestId,
    reason: row.reason,
    amountPaid: row.amountPaid,
    amountRefunded: row.amountRefunded ?? row.amountPaid,
    decisionNote: row.decisionNote,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    courseSlug: row.courseSlug,
    instructorId: row.instructorId,
    buyer: {
      id: String(row.buyerId),
      name: row.buyerName,
      email: row.buyerEmail,
    },
    purchaseKind,
    buyerDeepLink: purchaseKind === "team_licence" ? "/team" : "/settings",
  };
}

function listPlatformAdminRecipients(db: Db): NotificationRecipient[] {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .all()
    .map(toNotificationRecipient);
}

/**
 * Emits `refund-request-opened` to the Buyer and all Platform Admins when a
 * Refund Request is created in Open state. Instructors are not notified.
 */
export async function notifyRefundRequestOpened(
  db: Db,
  params: { refundRequestId: number },
  adapter: NotificationProviderAdapter = getNotificationAdapter()
): Promise<void> {
  const ctx = loadRefundNotificationContext(db, params.refundRequestId);
  if (!ctx) return;

  const purchaseLabel =
    ctx.purchaseKind === "team_licence"
      ? "Team Licence"
      : "Individual Purchase";
  const formattedAmount = formatPrice(ctx.amountPaid);
  const sharedData = {
    kind: "transactional" as const,
    subkind: "refund_open" as const,
    badgeLabel: "Refund Request",
    courseTitle: ctx.courseTitle,
    courseSlug: ctx.courseSlug,
    purchaseKind: ctx.purchaseKind,
    amountPaid: ctx.amountPaid,
    reason: ctx.reason,
    refundRequestId: ctx.refundRequestId,
    createdAt: ctx.requestedAt,
  };

  await adapter.triggerWorkflow({
    workflow: "refund-request-opened",
    recipients: [ctx.buyer],
    actor: ctx.buyer,
    data: {
      ...sharedData,
      title: `Refund request received for "${ctx.courseTitle}"`,
      body: `We received your ${purchaseLabel} refund request (${formattedAmount}): "${ctx.reason}"`,
      meta: `${purchaseLabel} · ${formattedAmount}`,
      deepLink: ctx.buyerDeepLink,
      ctaLabel: "View Request",
    },
  });

  const admins = listPlatformAdminRecipients(db);
  if (admins.length > 0) {
    await adapter.triggerWorkflow({
      workflow: "refund-request-opened",
      recipients: admins,
      actor: ctx.buyer,
      data: {
        ...sharedData,
        title: `New refund request from ${ctx.buyer.name} for "${ctx.courseTitle}"`,
        body: `${purchaseLabel} (${formattedAmount}) — "${ctx.reason}"`,
        meta: `${ctx.buyer.name} · ${purchaseLabel} · ${formattedAmount}`,
        deepLink: "/admin/refunds?status=open",
        ctaLabel: "Review Request",
      },
    });
  }
}

/**
 * Emits `refund-request-approved` (unified with initial Pending Refund state)
 * to the Buyer and Course Instructor, or `refund-request-declined` exclusively
 * to the Buyer with the required decisionNote.
 */
export async function notifyRefundRequestDecided(
  db: Db,
  params: { refundRequestId: number; decision: "approved" | "declined" },
  adapter: NotificationProviderAdapter = getNotificationAdapter()
): Promise<void> {
  const ctx = loadRefundNotificationContext(db, params.refundRequestId);
  if (!ctx) return;

  const formattedAmount = formatPrice(ctx.amountRefunded);

  if (params.decision === "approved") {
    const noteSuffix = ctx.decisionNote ? ` Note: "${ctx.decisionNote}"` : "";

    await adapter.triggerWorkflow({
      workflow: "refund-request-approved",
      recipients: [ctx.buyer],
      data: {
        kind: "transactional",
        subkind: "refund_approved",
        badgeLabel: "Refund Approved",
        title: `Refund approved for "${ctx.courseTitle}"`,
        body: `Your refund of ${formattedAmount} is approved and currently pending payout.${noteSuffix}`,
        meta: `Refund status: Pending · ${formattedAmount}`,
        deepLink: ctx.buyerDeepLink,
        ctaLabel: "View Status",
        courseTitle: ctx.courseTitle,
        purchaseKind: ctx.purchaseKind,
        amountRefunded: ctx.amountRefunded,
        refundStatus: "pending",
        decisionNote: ctx.decisionNote,
        refundRequestId: ctx.refundRequestId,
        createdAt: ctx.resolvedAt ?? new Date().toISOString(),
      },
    });

    const instructor = db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, ctx.instructorId))
      .get();

    if (instructor) {
      await adapter.triggerWorkflow({
        workflow: "refund-request-approved",
        recipients: [toNotificationRecipient(instructor)],
        data: {
          kind: "transactional",
          subkind: "refund_approved",
          badgeLabel: "Refund Approved",
          title: `Refund approved for "${ctx.courseTitle}"`,
          body: `${ctx.buyer.name}'s ${ctx.purchaseKind === "team_licence" ? "Team Licence" : "Individual Purchase"} (${formattedAmount}) was refunded.`,
          meta: `${ctx.buyer.name} · ${formattedAmount}`,
          deepLink: `/instructor/${ctx.courseId}/students`,
          ctaLabel: "View Students",
          courseTitle: ctx.courseTitle,
          purchaseKind: ctx.purchaseKind,
          amountRefunded: ctx.amountRefunded,
          refundRequestId: ctx.refundRequestId,
          createdAt: ctx.resolvedAt ?? new Date().toISOString(),
        },
      });
    }
    return;
  }

  const decisionNote = ctx.decisionNote ?? "";
  await adapter.triggerWorkflow({
    workflow: "refund-request-declined",
    recipients: [ctx.buyer],
    data: {
      kind: "transactional",
      subkind: "refund_declined",
      badgeLabel: "Refund Declined",
      title: `Refund request declined for "${ctx.courseTitle}"`,
      body: decisionNote,
      meta: `Course: ${ctx.courseTitle}`,
      deepLink: ctx.buyerDeepLink,
      ctaLabel: "View Details",
      courseTitle: ctx.courseTitle,
      purchaseKind: ctx.purchaseKind,
      decisionNote,
      refundRequestId: ctx.refundRequestId,
      createdAt: ctx.resolvedAt ?? new Date().toISOString(),
    },
  });
}

/**
 * Emits `refund-issued` to the Buyer or `refund-failed` to the Buyer and all
 * Platform Admins when an Approved Refund transitions from Pending.
 */
export async function notifyRefundStatusChanged(
  db: Db,
  params: { refundRequestId: number; refundStatus: "issued" | "failed" },
  adapter: NotificationProviderAdapter = getNotificationAdapter()
): Promise<void> {
  const ctx = loadRefundNotificationContext(db, params.refundRequestId);
  if (!ctx) return;

  const formattedAmount = formatPrice(ctx.amountRefunded);
  const nowIso = new Date().toISOString();

  if (params.refundStatus === "issued") {
    await adapter.triggerWorkflow({
      workflow: "refund-issued",
      recipients: [ctx.buyer],
      data: {
        kind: "transactional",
        subkind: "refund_issued",
        badgeLabel: "Refund Issued",
        title: `Refund of ${formattedAmount} issued for "${ctx.courseTitle}"`,
        body: `Your refund of ${formattedAmount} has been issued.`,
        meta: `Refund status: Issued · ${formattedAmount}`,
        deepLink: ctx.buyerDeepLink,
        ctaLabel: "View Receipt",
        courseTitle: ctx.courseTitle,
        purchaseKind: ctx.purchaseKind,
        amountRefunded: ctx.amountRefunded,
        refundStatus: "issued",
        refundRequestId: ctx.refundRequestId,
        createdAt: nowIso,
      },
    });
    return;
  }

  await adapter.triggerWorkflow({
    workflow: "refund-failed",
    recipients: [ctx.buyer],
    data: {
      kind: "transactional",
      subkind: "refund_failed",
      badgeLabel: "Refund Failed",
      title: `Refund payout failed for "${ctx.courseTitle}"`,
      body: `We could not complete your refund payout of ${formattedAmount}. Our team has been alerted.`,
      meta: `Refund status: Failed · ${formattedAmount}`,
      deepLink: ctx.buyerDeepLink,
      ctaLabel: "View Status",
      urgent: true,
      courseTitle: ctx.courseTitle,
      purchaseKind: ctx.purchaseKind,
      amountRefunded: ctx.amountRefunded,
      refundStatus: "failed",
      refundRequestId: ctx.refundRequestId,
      createdAt: nowIso,
    },
  });

  const admins = listPlatformAdminRecipients(db);
  if (admins.length > 0) {
    await adapter.triggerWorkflow({
      workflow: "refund-failed",
      recipients: admins,
      data: {
        kind: "transactional",
        subkind: "refund_failed",
        badgeLabel: "Refund Failed",
        title: `Refund payout failed for ${ctx.buyer.name} ("${ctx.courseTitle}")`,
        body: `Payout of ${formattedAmount} failed and requires attention.`,
        meta: `${ctx.buyer.name} · ${formattedAmount}`,
        deepLink: "/admin/refunds?status=approved",
        ctaLabel: "Review Refund",
        urgent: true,
        courseTitle: ctx.courseTitle,
        purchaseKind: ctx.purchaseKind,
        amountRefunded: ctx.amountRefunded,
        refundStatus: "failed",
        refundRequestId: ctx.refundRequestId,
        createdAt: nowIso,
      },
    });
  }
}
