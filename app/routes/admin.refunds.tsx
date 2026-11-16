import { useEffect, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import {
  RefundPayoutStatus,
  RefundStatus,
  UserRole,
  refunds,
  users,
} from "~/db/schema";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { RefundPayoutBadge } from "~/components/refund-payout-badge";
import { AlertTriangle, Receipt } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { formatPrice } from "~/lib/utils";
import {
  approveRefundRequest,
  declineRefundRequest,
  listRefundRequestsForReview,
  updateRefundPayoutStatus,
  type RefundRequestForReview,
} from "~/lib/refunds.server";
import {
  cancelAdherenceForRefundedEnrollments,
  notifyRefundRequestDecided,
  notifyRefundStatusChanged,
} from "~/services/notifications.server";
import { RULE_BREAK_LABELS } from "~/lib/refund-rules";

const refundFilterSchema = z
  .nativeEnum(RefundStatus)
  .catch(RefundStatus.Open);

const adminRefundActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("approve"),
    refundRequestId: z.coerce.number().int(),
    note: z
      .string()
      .trim()
      .max(1000, "Please keep the note under 1000 characters.")
      .optional(),
  }),
  z.object({
    intent: z.literal("decline"),
    refundRequestId: z.coerce.number().int(),
    note: z
      .string()
      .trim()
      .min(1, "Write the buyer a note saying why it was declined.")
      .max(1000, "Please keep the note under 1000 characters."),
  }),
  z.object({
    intent: z.literal("mark-issued"),
    refundRequestId: z.coerce.number().int(),
  }),
  z.object({
    intent: z.literal("mark-failed"),
    refundRequestId: z.coerce.number().int(),
  }),
]);

function getUserById(id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

/** Only a Platform Admin decides Refund Requests. */
async function requirePlatformAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to review refunds.", {
      status: 401,
    });
  }

  const currentUser = getUserById(currentUserId);

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only Platform Admins can review refund requests.", {
      status: 403,
    });
  }

  return currentUser;
}

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    { name: "description", content: "Approve or decline refund requests" },
  ];
}

export async function loader({ request, url }: Route.LoaderArgs) {
  await requirePlatformAdmin(request);

  const status = refundFilterSchema.parse(url.searchParams.get("status"));

  return {
    status,
    refundRequests: listRefundRequestsForReview(db, status, new Date()),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const platformAdmin = await requirePlatformAdmin(request);

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminRefundActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent, refundRequestId } = parsed.data;

  if (intent === "mark-issued" || intent === "mark-failed") {
    const nextStatus =
      intent === "mark-issued"
        ? RefundPayoutStatus.Issued
        : RefundPayoutStatus.Failed;
    const payoutResult = updateRefundPayoutStatus(
      db,
      refundRequestId,
      nextStatus
    );

    if (!payoutResult.ok) {
      throw data(
        { error: payoutResult.error },
        { status: payoutResult.status }
      );
    }

    await notifyRefundStatusChanged(db, {
      refundRequestId,
      refundStatus: payoutResult.refundStatus,
    });

    return {
      success: true,
      message:
        nextStatus === RefundPayoutStatus.Issued
          ? "Refund marked as issued."
          : "Refund marked as failed.",
    };
  }

  const result =
    parsed.data.intent === "approve"
      ? approveRefundRequest(
          db,
          refundRequestId,
          platformAdmin.id,
          parsed.data.note || null,
          new Date()
        )
      : declineRefundRequest(
          db,
          refundRequestId,
          platformAdmin.id,
          parsed.data.note,
          new Date()
        );

  if (!result.ok) {
    return data({ error: result.error }, { status: result.status });
  }

  console.log(
    `[email] to=${result.email.to} subject=${result.email.subject}\n${result.email.body}`
  );

  await notifyRefundRequestDecided(db, {
    refundRequestId,
    decision: intent === "approve" ? "approved" : "declined",
  });

  if (intent === "approve") {
    const refundedPurchase = db
      .select({ purchaseId: refunds.purchaseId })
      .from(refunds)
      .where(eq(refunds.id, refundRequestId))
      .get();
    if (refundedPurchase) {
      await cancelAdherenceForRefundedEnrollments(db, {
        purchaseId: refundedPurchase.purchaseId,
      });
    }
  }

  return {
    success: true,
    message:
      intent === "approve"
        ? "Refund request approved."
        : "Refund request declined.",
  };
}

const FILTERS: { status: RefundStatus; label: string }[] = [
  { status: RefundStatus.Open, label: "Open" },
  { status: RefundStatus.Approved, label: "Approved" },
  { status: RefundStatus.Declined, label: "Declined" },
];

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { status, refundRequests } = loaderData;
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Approve or decline what buyers have asked for, oldest first.
        </p>
      </div>

      <div className="mb-6 flex gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.status}
            variant={filter.status === status ? "default" : "outline"}
            size="sm"
            onClick={() =>
              setSearchParams(
                filter.status === RefundStatus.Open
                  ? {}
                  : { status: filter.status }
              )
            }
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {refundRequests.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Receipt className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              No {status} refund requests.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((refundRequest) => (
            <RefundRequestCard
              key={refundRequest.id}
              refundRequest={refundRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function formatHours(seconds: number) {
  return `${(seconds / 3600).toFixed(1)}h`;
}

function Figures({
  refundRequest,
}: {
  refundRequest: RefundRequestForReview;
}) {
  const { figures } = refundRequest;

  const items =
    figures.kind === "individual_purchase"
      ? [
          { label: "Purchase", value: "Individual Purchase" },
          {
            label: "Lessons completed",
            value: `${figures.lessonsCompleted} / ${figures.lessonCount}`,
          },
          { label: "Watched", value: formatHours(figures.secondsWatched) },
        ]
      : [
          { label: "Purchase", value: "Team Licence" },
          {
            label: "Seats claimed",
            value: `${figures.claimedSeatCount} / ${figures.seatCount}`,
          },
        ];

  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
      <div>
        <dt className="text-muted-foreground">Paid</dt>
        <dd className="font-medium">{formatPrice(refundRequest.amountPaid)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Since purchase</dt>
        <dd className="font-medium">
          {refundRequest.daysSincePurchase}{" "}
          {refundRequest.daysSincePurchase === 1 ? "day" : "days"}
        </dd>
      </div>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RefundRequestCard({
  refundRequest,
}: {
  refundRequest: RefundRequestForReview;
}) {
  const fetcher = useFetcher<
    { success: true; message: string } | { error: string }
  >();
  const [note, setNote] = useState("");
  const isSubmitting = fetcher.state !== "idle";
  const isOpen = refundRequest.status === RefundStatus.Open;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if ("error" in fetcher.data) {
      toast.error(fetcher.data.error);
    } else {
      toast.success(fetcher.data.message);
    }
  }, [fetcher.state, fetcher.data]);

  function decide(intent: "approve" | "decline") {
    fetcher.submit(
      { intent, refundRequestId: String(refundRequest.id), note },
      { method: "post" }
    );
  }

  function updatePayout(intent: "mark-issued" | "mark-failed") {
    fetcher.submit(
      { intent, refundRequestId: String(refundRequest.id) },
      { method: "post" }
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              to={`/courses/${refundRequest.courseSlug}`}
              className="font-semibold hover:underline"
            >
              {refundRequest.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {refundRequest.buyerName} · {refundRequest.buyerEmail} · raised{" "}
              {new Date(refundRequest.requestedAt).toLocaleDateString()}
            </p>
          </div>
          {refundRequest.ruleBreaks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {refundRequest.ruleBreaks.map((ruleBreak) => (
                <span
                  key={ruleBreak}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                >
                  <AlertTriangle className="size-3" />
                  {RULE_BREAK_LABELS[ruleBreak]}
                </span>
              ))}
            </div>
          )}
        </div>

        <Figures refundRequest={refundRequest} />

        <blockquote className="border-l-2 pl-3 text-sm">
          {refundRequest.reason}
        </blockquote>

        {isOpen ? (
          <div className="space-y-2 border-t pt-4">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="A note to the buyer. Required to decline."
            />
            {!refundRequest.canApprove && (
              <p className="text-xs text-muted-foreground">
                A Seat on this Team Licence has been claimed, so it can only be
                declined.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => decide("approve")}
                disabled={isSubmitting || !refundRequest.canApprove}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide("decline")}
                disabled={isSubmitting || note.trim().length === 0}
              >
                Decline
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 border-t pt-4 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {refundRequest.status === RefundStatus.Approved
                  ? "Approved"
                  : "Declined"}
                {refundRequest.decidedByName &&
                  ` by ${refundRequest.decidedByName}`}
                {refundRequest.resolvedAt &&
                  ` on ${new Date(refundRequest.resolvedAt).toLocaleDateString()}`}
              </div>
              {refundRequest.status === RefundStatus.Approved &&
                refundRequest.refundStatus && (
                  <RefundPayoutBadge status={refundRequest.refundStatus} />
                )}
            </div>
            {refundRequest.decisionNote && (
              <p className="rounded-md bg-muted p-2 text-foreground">
                {refundRequest.decisionNote}
              </p>
            )}
            {refundRequest.status === RefundStatus.Approved &&
              refundRequest.refundStatus === RefundPayoutStatus.Pending && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={() => updatePayout("mark-issued")}
                    disabled={isSubmitting}
                  >
                    Mark Refund Issued
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updatePayout("mark-failed")}
                    disabled={isSubmitting}
                  >
                    Mark Refund Failed
                  </Button>
                </div>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
