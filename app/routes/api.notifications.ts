import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { getNotificationAdapter } from "~/services/notifications.server";

const notificationActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("mark-read"),
    itemId: z.string().min(1),
  }),
  z.object({
    intent: z.literal("mark-all-read"),
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, notificationActionSchema);
  if (!parsed.success) {
    throw data({ ok: false, errors: parsed.errors }, { status: 400 });
  }

  const adapter = getNotificationAdapter();
  const userId = String(currentUserId);

  if (parsed.data.intent === "mark-read") {
    await adapter.markAsRead(userId, parsed.data.itemId);
    return { ok: true };
  }

  await adapter.markAllAsRead(userId);
  return { ok: true };
}
