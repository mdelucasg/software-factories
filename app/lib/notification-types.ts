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

export const NOTIFICATION_SUBKINDS: ReadonlySet<string> =
  new Set<NotificationSubkind>([
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
