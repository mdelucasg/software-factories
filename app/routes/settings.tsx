import { useRef, useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/settings";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { RefundPayoutBadge } from "~/components/refund-payout-badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  PurchaseDigestFrequency,
  RefundStatus,
  UserRole,
  users,
} from "~/db/schema";
import { AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { db } from "~/db";
import { eq } from "drizzle-orm";
import { formatPrice } from "~/lib/utils";
import { listRefundRequestsForBuyer } from "~/lib/refunds.server";
import {
  cancelAdherenceReminder,
  getNotificationPreferences,
  recordLearningActivity,
  updateNotificationPreferences,
} from "~/services/notifications.server";

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  bio: z.string().trim().optional(),
});

const booleanStringSchema = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const notificationPrefsSchema = z.object({
  intent: z.literal("update-notifications"),
  commentsEnabled: booleanStringSchema.optional(),
  seatClaimedEnabled: booleanStringSchema.optional(),
  purchaseDigestFrequency: z.nativeEnum(PurchaseDigestFrequency).optional(),
  adherenceRemindersEnabled: booleanStringSchema.optional(),
  courseRecommendationsEnabled: booleanStringSchema.optional(),
});

export function meta() {
  return [
    { title: "Settings — Cadence" },
    { name: "description", content: "Edit your profile details" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to edit your details.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const refundRequests = listRefundRequestsForBuyer(db, currentUserId);
  const notificationPrefs = getNotificationPreferences(db, currentUserId);

  return {
    user: {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      bio: currentUser.bio,
      role: currentUser.role,
    },
    refundRequests,
    notificationPrefs,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();
  if (!currentUser) {
    throw data("User not found.", { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "update-notifications") {
    const parsedPrefs = parseFormData(formData, notificationPrefsSchema);
    if (!parsedPrefs.success) {
      return data({ errors: parsedPrefs.errors }, { status: 400 });
    }
    if (parsedPrefs.data.courseRecommendationsEnabled !== undefined && currentUser.role !== UserRole.Student) {
      return data(
        {
          errors: {
            courseRecommendationsEnabled:
              "Only students can configure course recommendations.",
          },
        },
        { status: 403 }
      );
    }
    const updated = updateNotificationPreferences(db, currentUser.id, {
      ...(parsedPrefs.data.commentsEnabled !== undefined
        ? { commentsEnabled: parsedPrefs.data.commentsEnabled }
        : {}),
      ...(parsedPrefs.data.seatClaimedEnabled !== undefined
        ? { seatClaimedEnabled: parsedPrefs.data.seatClaimedEnabled }
        : {}),
      ...(parsedPrefs.data.purchaseDigestFrequency !== undefined
        ? { purchaseDigestFrequency: parsedPrefs.data.purchaseDigestFrequency }
        : {}),
      ...(parsedPrefs.data.adherenceRemindersEnabled !== undefined
        ? {
            adherenceRemindersEnabled:
              parsedPrefs.data.adherenceRemindersEnabled,
          }
        : {}),
      ...(parsedPrefs.data.courseRecommendationsEnabled !== undefined
        ? {
            courseRecommendationsEnabled:
              parsedPrefs.data.courseRecommendationsEnabled,
          }
        : {}),
    });

    if (parsedPrefs.data.adherenceRemindersEnabled === false) {
      await cancelAdherenceReminder(db, { userId: currentUser.id });
    } else if (parsedPrefs.data.adherenceRemindersEnabled === true) {
      await recordLearningActivity(db, { userId: currentUser.id });
    }

    return {
      success: true,
      message: "Notification preferences updated.",
      commentsEnabled: updated.commentsEnabled,
      seatClaimedEnabled: updated.seatClaimedEnabled,
      purchaseDigestFrequency: updated.purchaseDigestFrequency,
      adherenceRemindersEnabled: updated.adherenceRemindersEnabled,
      courseRecommendationsEnabled: updated.courseRecommendationsEnabled,
    };
  }

  const parsed = parseFormData(formData, settingsSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const { name, bio } = parsed.data;

  db
    .update(users)
    .set({ name, email: currentUser.email, bio: bio || null })
    .where(eq(users.id, currentUser.id))
    .returning()
    .get();
  return { success: true };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { user, refundRequests, notificationPrefs } = loaderData;
  const openCount = refundRequests.filter(
    (refundRequest) => refundRequest.status === RefundStatus.Open
  ).length;
  const fetcher = useFetcher<{
    success?: boolean;
    message?: string;
    errors?: Record<string, string>;
  }>();
  const notifFetcher = useFetcher<{
    success?: boolean;
    message?: string;
    commentsEnabled?: boolean;
    seatClaimedEnabled?: boolean;
    purchaseDigestFrequency?: PurchaseDigestFrequency;
    adherenceRemindersEnabled?: boolean;
    courseRecommendationsEnabled?: boolean;
    errors?: Record<string, string>;
  }>();
  const recFetcher = useFetcher<{
    success?: boolean;
    message?: string;
    courseRecommendationsEnabled?: boolean;
    errors?: Record<string, string>;
  }>();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isInstructor = user.role === UserRole.Instructor;
  const isStudent = user.role === UserRole.Student;
  const canConfigureComments = isStudent || isInstructor;
  const canConfigureCourseRecommendations = isStudent;
  const pendingComments = notifFetcher.formData?.get("commentsEnabled");
  const commentsEnabled =
    typeof pendingComments === "string"
      ? pendingComments === "true"
      : (notifFetcher.data?.commentsEnabled ?? notificationPrefs.commentsEnabled);
  const courseRecommendationsEnabled =
    recFetcher.formData !== undefined
      ? recFetcher.formData.get("courseRecommendationsEnabled") === "true"
      : (recFetcher.data?.courseRecommendationsEnabled ??
        notificationPrefs.courseRecommendationsEnabled);

  const pendingSeatClaimed = notifFetcher.formData?.get("seatClaimedEnabled");
  const seatClaimedEnabled =
    typeof pendingSeatClaimed === "string"
      ? pendingSeatClaimed === "true"
      : (notifFetcher.data?.seatClaimedEnabled ??
        notificationPrefs.seatClaimedEnabled);

  const pendingDigest = notifFetcher.formData?.get("purchaseDigestFrequency");
  const purchaseDigestFrequency =
    typeof pendingDigest === "string"
      ? pendingDigest
      : (notifFetcher.data?.purchaseDigestFrequency ??
        notificationPrefs.purchaseDigestFrequency);

  const pendingAdherence = notifFetcher.formData?.get(
    "adherenceRemindersEnabled"
  );
  const adherenceRemindersEnabled =
    typeof pendingAdherence === "string"
      ? pendingAdherence === "true"
      : (notifFetcher.data?.adherenceRemindersEnabled ??
        notificationPrefs.adherenceRemindersEnabled);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(fetcher.data.message ?? "Profile updated successfully.");
    }
    if (fetcher.state === "idle" && fetcher.data?.errors) {
      const firstError = Object.values(fetcher.data.errors)[0] as string | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (notifFetcher.state === "idle" && notifFetcher.data?.success) {
      toast.success(
        notifFetcher.data.message ?? "Notification preferences updated."
      );
    }
    if (notifFetcher.state === "idle" && notifFetcher.data?.errors) {
      const firstError = Object.values(notifFetcher.data.errors)[0] as
        | string
        | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [notifFetcher.state, notifFetcher.data]);

  useEffect(() => {
    if (recFetcher.state === "idle" && recFetcher.data?.success) {
      toast.success(
        recFetcher.data.message ?? "Notification preferences updated."
      );
    }
    if (recFetcher.state === "idle" && recFetcher.data?.errors) {
      const firstError = Object.values(recFetcher.data.errors)[0] as
        | string
        | undefined;
      if (firstError) toast.error(firstError);
    }
  }, [recFetcher.state, recFetcher.data]);

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Settings</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Update your profile details
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <h2 className="text-lg font-semibold">Profile</h2>
        </CardHeader>
        <CardContent>
          <fetcher.Form method="post" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                ref={nameInputRef}
                id="name"
                name="name"
                type="text"
                defaultValue={user.name}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={user.email}
                disabled
                className="text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed.
              </p>
            </div>
            {user.role === UserRole.Instructor && (
              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  defaultValue={user.bio ?? ""}
                  placeholder="Tell students about yourself..."
                />
                <p className="text-xs text-muted-foreground">
                  Your bio is shown on your course pages.
                </p>
              </div>
            )}
            <Button
              type="submit"
              disabled={fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? "Saving..." : "Save Changes"}
            </Button>
          </fetcher.Form>
        </CardContent>
      </Card>

      {canConfigureComments && (
        <Card className="mt-8 max-w-md">
          <CardHeader>
            <h2 className="text-lg font-semibold">Notifications</h2>
            <p className="text-sm text-muted-foreground">
              Manage your in-app and email notification preferences.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <notifFetcher.Form method="post">
              <input
                type="hidden"
                name="intent"
                value="update-notifications"
              />
              <input
                type="hidden"
                name="commentsEnabled"
                value={commentsEnabled ? "false" : "true"}
              />
              <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div>
                  <Label
                    htmlFor="comments-toggle"
                    className="text-sm font-medium"
                  >
                    Lesson comment notifications
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Receive notifications when someone posts a comment or replies
                    in a lesson thread.
                  </p>
                </div>
                <Button
                  id="comments-toggle"
                  type="submit"
                  variant={commentsEnabled ? "default" : "outline"}
                  size="sm"
                  role="switch"
                  aria-checked={commentsEnabled}
                  disabled={notifFetcher.state !== "idle"}
                >
                  {commentsEnabled ? "Enabled" : "Disabled"}
                </Button>
              </div>
            </notifFetcher.Form>
            {canConfigureCourseRecommendations && (
              <recFetcher.Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value="update-notifications"
                />
                <input
                  type="hidden"
                  name="courseRecommendationsEnabled"
                  value={courseRecommendationsEnabled ? "false" : "true"}
                />
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <Label
                      htmlFor="course-recommendations-toggle"
                      className="text-sm font-medium"
                    >
                      Course recommendations
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Receive recommendations when a new course launches in a
                      category or from an instructor you follow.
                    </p>
                  </div>
                  <Button
                    id="course-recommendations-toggle"
                    type="submit"
                    variant={
                      courseRecommendationsEnabled ? "default" : "outline"
                    }
                    size="sm"
                    role="switch"
                    aria-checked={courseRecommendationsEnabled}
                    disabled={recFetcher.state !== "idle"}
                  >
                    {courseRecommendationsEnabled ? "Enabled" : "Disabled"}
                  </Button>
                </div>
              </recFetcher.Form>
            )}

            {isStudent && (
              <notifFetcher.Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value="update-notifications"
                />
                <input
                  type="hidden"
                  name="adherenceRemindersEnabled"
                  value={adherenceRemindersEnabled ? "false" : "true"}
                />
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <Label
                      htmlFor="adherence-toggle"
                      className="text-sm font-medium"
                    >
                      Adherence reminders
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Receive a study reminder after 72 hours without learning
                      activity on an incomplete course.
                    </p>
                  </div>
                  <Button
                    id="adherence-toggle"
                    type="submit"
                    variant={adherenceRemindersEnabled ? "default" : "outline"}
                    size="sm"
                    role="switch"
                    aria-checked={adherenceRemindersEnabled}
                    disabled={notifFetcher.state !== "idle"}
                  >
                    {adherenceRemindersEnabled ? "Enabled" : "Disabled"}
                  </Button>
                </div>
              </notifFetcher.Form>
            )}

            {isInstructor && (
              <>
                <notifFetcher.Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="update-notifications"
                  />
                  <input
                    type="hidden"
                    name="seatClaimedEnabled"
                    value={seatClaimedEnabled ? "false" : "true"}
                  />
                  <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div>
                      <Label
                        htmlFor="seat-claimed-toggle"
                        className="text-sm font-medium"
                      >
                        Seat claimed notifications
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Receive a notification when a student claims a seat from
                        a team licence for your course.
                      </p>
                    </div>
                    <Button
                      id="seat-claimed-toggle"
                      type="submit"
                      variant={seatClaimedEnabled ? "default" : "outline"}
                      size="sm"
                      role="switch"
                      aria-checked={seatClaimedEnabled}
                      disabled={notifFetcher.state !== "idle"}
                    >
                      {seatClaimedEnabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                </notifFetcher.Form>

                <notifFetcher.Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="update-notifications"
                  />
                  <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div>
                      <Label
                        htmlFor="purchase-digest-frequency"
                        className="text-sm font-medium"
                      >
                        Purchase digest
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Summary of individual and team licence purchases for
                        your courses.
                      </p>
                    </div>
                    <select
                      id="purchase-digest-frequency"
                      name="purchaseDigestFrequency"
                      value={purchaseDigestFrequency}
                      disabled={notifFetcher.state !== "idle"}
                      onChange={(e) => notifFetcher.submit(e.currentTarget.form)}
                      className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value={PurchaseDigestFrequency.Daily}>
                        Daily
                      </option>
                      <option value={PurchaseDigestFrequency.Weekly}>
                        Weekly
                      </option>
                      <option value={PurchaseDigestFrequency.Monthly}>
                        Monthly
                      </option>
                      <option value={PurchaseDigestFrequency.Off}>Off</option>
                    </select>
                  </div>
                </notifFetcher.Form>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {refundRequests.length > 0 && (
        <Card className="mt-8 max-w-md">
          <CardHeader>
            <h2 className="text-lg font-semibold">Refund Requests</h2>
            {openCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {openCount === 1
                  ? "One refund request is waiting on us."
                  : `${openCount} refund requests are waiting on us.`}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {refundRequests.map((refundRequest) => (
              <div key={refundRequest.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/courses/${refundRequest.courseSlug}`}
                    className="font-medium hover:underline"
                  >
                    {refundRequest.courseTitle}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <RefundStatusBadge status={refundRequest.status} />
                    {refundRequest.status === RefundStatus.Approved &&
                      refundRequest.refundStatus && (
                        <RefundPayoutBadge status={refundRequest.refundStatus} />
                      )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(refundRequest.amountPaid)} · raised{" "}
                  {new Date(refundRequest.requestedAt).toLocaleDateString()}
                  {refundRequest.resolvedAt && (
                    <>
                      {" "}
                      · decided{" "}
                      {new Date(refundRequest.resolvedAt).toLocaleDateString()}
                    </>
                  )}
                </p>
                <p className="mt-2 text-sm">{refundRequest.reason}</p>
                {refundRequest.decisionNote && (
                  <p className="mt-2 rounded-md bg-muted p-2 text-sm">
                    <span className="font-medium">Our note: </span>
                    {refundRequest.decisionNote}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const REFUND_STATUS_BADGES: Record<
  RefundStatus,
  { label: string; className: string }
> = {
  [RefundStatus.Open]: {
    label: "Open",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  [RefundStatus.Approved]: {
    label: "Approved",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  [RefundStatus.Declined]: {
    label: "Declined",
    className: "bg-muted text-muted-foreground",
  },
};

function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const badge = REFUND_STATUS_BADGES[status];
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
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
    } else if (error.status === 404) {
      title = "User not found";
      message =
        typeof error.data === "string" ? error.data : "User not found.";
    } else {
      title = `Error ${error.status}`;
      message =
        typeof error.data === "string" ? error.data : error.statusText;
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
