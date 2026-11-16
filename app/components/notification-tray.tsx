import { useEffect, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import {
  KnockFeedProvider,
  KnockProvider,
  useKnockFeed,
} from "@knocklabs/react";
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  Flame,
  MessageSquare,
  Receipt,
  Shield,
  ShoppingBag,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { UserRole } from "~/db/schema";
import { cn, formatRelativeTime } from "~/lib/utils";
import type {
  CanonicalDomainRole,
  InAppNotificationItem,
  NotificationKind,
  NotificationSubkind,
} from "~/services/notifications.server";

export interface TrayUser {
  id: number;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
}

export interface KnockClientConfig {
  publicApiKey: string | null;
  feedChannelId: string | null;
}

export function resolveCanonicalRole(
  user: TrayUser | null,
  isTeamAdmin: boolean
): CanonicalDomainRole {
  if (!user) return "Student";
  if (user.role === UserRole.Admin) return "Platform Admin";
  if (user.role === UserRole.Instructor) return "Instructor";
  if (isTeamAdmin) return "Team Admin";
  return "Student";
}

function getNotificationIcon(subkind: NotificationSubkind) {
  switch (subkind) {
    case "adherence_reminder":
      return <Flame className="size-4 text-amber-500" />;
    case "course_recommendation":
      return <Sparkles className="size-4 text-emerald-500" />;
    case "comment_root":
    case "comment_reply":
      return <MessageSquare className="size-4 text-sky-500" />;
    case "individual_purchase":
    case "team_licence_purchase":
    case "purchase_digest":
      return <ShoppingBag className="size-4 text-violet-500" />;
    case "seat_claimed":
      return <UsersRound className="size-4 text-indigo-500" />;
    case "refund_open":
    case "refund_approved":
    case "refund_declined":
    case "refund_issued":
      return <Receipt className="size-4 text-amber-600" />;
    case "refund_failed":
      return <AlertTriangle className="size-4 text-red-500" />;
    case "course_status":
      return <Shield className="size-4 text-teal-500" />;
  }
}

type FilterTab = "all" | "unread" | "engagement" | "transactional";

function NotificationTrayUI({
  canonicalRole,
  items,
  onMarkAsRead,
  onMarkAllAsRead,
}: {
  canonicalRole: CanonicalDomainRole;
  items: InAppNotificationItem[];
  onMarkAsRead: (itemId: string) => void;
  onMarkAllAsRead: () => void;
}) {
  const navigate = useNavigate();
  const [trayOpen, setTrayOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const unreadCount = items.filter((item) => item.unread).length;
  const engagementCount = items.filter(
    (item) => item.kind === "engagement"
  ).length;
  const transactionalCount = items.filter(
    (item) => item.kind === "transactional"
  ).length;

  const filteredItems = items.filter((item) => {
    if (activeTab === "unread") return item.unread;
    if (activeTab === "engagement") return item.kind === "engagement";
    if (activeTab === "transactional") return item.kind === "transactional";
    return true;
  });

  function handleNavigateDeepLink(item: InAppNotificationItem) {
    if (item.unread) {
      onMarkAsRead(item.id);
    }
    setTrayOpen(false);
    navigate(item.deepLink);
  }

  const tabs: Array<{ key: FilterTab; label: string }> = [
    { key: "all", label: `Todas (${items.length})` },
    { key: "unread", label: `No leídas (${unreadCount})` },
    ...(canonicalRole === "Student"
      ? [{ key: "engagement" as const, label: `Impulso (${engagementCount})` }]
      : []),
    {
      key: "transactional",
      label: `Transaccionales (${transactionalCount})`,
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setTrayOpen((prev) => !prev)}
        aria-label="Abrir bandeja de notificaciones"
        aria-expanded={trayOpen}
        className={cn(
          "relative inline-flex items-center justify-center rounded-md border p-1.5 transition-colors",
          trayOpen
            ? "border-primary bg-primary text-primary-foreground"
            : "border-sidebar-border bg-sidebar text-sidebar-foreground hover:bg-sidebar-accent"
        )}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow"
          >
            {unreadCount}
          </span>
        )}
      </button>

      {trayOpen && (
        <div
          role="dialog"
          aria-label="Bandeja de notificaciones"
          className="fixed left-56 top-3 z-50 flex max-h-[82vh] w-[420px] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Notificaciones</h3>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {canonicalRole}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  <CheckCheck className="size-3.5" />
                  Marcar todas leídas
                </button>
              )}
              <button
                type="button"
                onClick={() => setTrayOpen(false)}
                aria-label="Cerrar notificaciones"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="flex border-b bg-muted/20 px-2 pt-1.5 text-xs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "border-b-2 px-2.5 py-1.5 font-medium transition-colors",
                  activeTab === tab.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 divide-y overflow-y-auto">
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No hay notificaciones en esta pestaña.
              </div>
            ) : (
              filteredItems.map((item) => {
                const isEngagement = item.kind === "engagement";
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "p-3.5 transition-colors",
                      isEngagement
                        ? "bg-amber-500/5 dark:bg-amber-500/10"
                        : item.unread
                          ? "bg-primary/[0.03]"
                          : "bg-background opacity-75"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
                          isEngagement
                            ? "border-amber-500/40 bg-amber-500/10"
                            : "border-border bg-muted/50"
                        )}
                      >
                        {getNotificationIcon(item.subkind)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              item.subkind === "adherence_reminder"
                                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                                : item.subkind === "course_recommendation"
                                  ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                                  : item.urgent
                                    ? "bg-red-500/20 text-red-700 dark:text-red-300"
                                    : "bg-muted text-muted-foreground"
                            )}
                          >
                            {item.badgeLabel}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-[11px] text-muted-foreground"
                              suppressHydrationWarning
                            >
                              {formatRelativeTime(item.createdAt)}
                            </span>
                            {item.unread && (
                              <span
                                title="No leída"
                                className="size-2 rounded-full bg-primary"
                              />
                            )}
                          </div>
                        </div>

                        <p className="mt-1 text-sm font-medium leading-snug">
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {item.body}
                        </p>

                        {typeof item.progressPercent === "number" && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-amber-500/20">
                              <div
                                className="h-1.5 rounded-full bg-amber-500"
                                style={{ width: `${item.progressPercent}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                              {item.progressPercent}% completado
                            </span>
                          </div>
                        )}

                        {item.meta && (
                          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground/80">
                            {item.meta}
                          </p>
                        )}

                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => handleNavigateDeepLink(item)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                              isEngagement
                                ? "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                                : "bg-primary text-primary-foreground hover:bg-primary/90"
                            )}
                          >
                            {item.ctaLabel}
                            <ExternalLink className="size-3" />
                          </button>

                          {item.unread && (
                            <button
                              type="button"
                              onClick={() => onMarkAsRead(item.id)}
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Check className="size-3" />
                              Marcar leída
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LocalNotificationTray({
  userId,
  canonicalRole,
  initialItems,
}: {
  userId: string;
  canonicalRole: CanonicalDomainRole;
  initialItems: InAppNotificationItem[];
}) {
  const fetcher = useFetcher();
  const [items, setItems] = useState<InAppNotificationItem[]>(initialItems);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems, userId]);

  function handleMarkAsRead(itemId: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, unread: false } : item
      )
    );
    fetcher.submit(
      { intent: "mark-read", itemId },
      { method: "post", action: "/api/notifications" }
    );
  }

  function handleMarkAllAsRead() {
    setItems((prev) => prev.map((item) => ({ ...item, unread: false })));
    fetcher.submit(
      { intent: "mark-all-read" },
      { method: "post", action: "/api/notifications" }
    );
  }

  return (
    <NotificationTrayUI
      canonicalRole={canonicalRole}
      items={items}
      onMarkAsRead={handleMarkAsRead}
      onMarkAllAsRead={handleMarkAllAsRead}
    />
  );
}

const VALID_SUBKINDS: ReadonlySet<string> = new Set<NotificationSubkind>([
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

function readStringField(
  record: Record<string, unknown> | null | undefined,
  key: string,
  fallback = ""
): string {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}

function KnockFeedTray({
  userId,
  canonicalRole,
}: {
  userId: string;
  canonicalRole: CanonicalDomainRole;
}) {
  const { feedClient, useFeedStore } = useKnockFeed();
  const rawItems = useFeedStore((state) => state.items);

  useEffect(() => {
    void feedClient.fetch();
  }, [feedClient, userId]);

  const items: InAppNotificationItem[] = rawItems.map((feedItem) => {
    const dataRecord = feedItem.data ?? {};
    const rawSubkind = readStringField(dataRecord, "subkind", "comment_root");
    const subkind: NotificationSubkind = VALID_SUBKINDS.has(rawSubkind)
      ? (rawSubkind as NotificationSubkind)
      : "comment_root";
    const kind: NotificationKind =
      readStringField(dataRecord, "kind") === "engagement"
        ? "engagement"
        : "transactional";
    const progressRaw = dataRecord.progressPercent;

    return {
      id: feedItem.id,
      userId,
      kind,
      subkind,
      badgeLabel: readStringField(dataRecord, "badgeLabel", "Notificación"),
      title: readStringField(dataRecord, "title", "Nueva notificación"),
      body: readStringField(
        dataRecord,
        "body",
        readStringField(dataRecord, "excerpt", "")
      ),
      meta: readStringField(dataRecord, "meta", ""),
      createdAt: feedItem.inserted_at,
      deepLink: readStringField(dataRecord, "deepLink", "/"),
      ctaLabel: readStringField(dataRecord, "ctaLabel", "Ver"),
      unread: !feedItem.read_at,
      ...(typeof progressRaw === "number"
        ? { progressPercent: progressRaw }
        : {}),
      ...(typeof dataRecord.urgent === "boolean"
        ? { urgent: dataRecord.urgent }
        : {}),
    };
  });

  return (
    <NotificationTrayUI
      canonicalRole={canonicalRole}
      items={items}
      onMarkAsRead={(itemId) => {
        const target = rawItems.find((i) => i.id === itemId);
        if (target) {
          void feedClient.markAsRead(target);
        }
      }}
      onMarkAllAsRead={() => {
        void feedClient.markAllAsRead();
      }}
    />
  );
}

/**
 * Sidebar header notification tray, parameterized by currentUser.id so DevUI
 * user switching resets and rebinds the feed immediately.
 */
export function NotificationTray({
  currentUser,
  isTeamAdmin,
  initialItems,
  knockConfig,
}: {
  currentUser: TrayUser | null;
  isTeamAdmin: boolean;
  initialItems: InAppNotificationItem[];
  knockConfig: KnockClientConfig;
}) {
  if (!currentUser) {
    return null;
  }

  const userId = String(currentUser.id);
  const canonicalRole = resolveCanonicalRole(currentUser, isTeamAdmin);

  if (knockConfig.publicApiKey && knockConfig.feedChannelId) {
    return (
      <KnockProvider
        key={userId}
        apiKey={knockConfig.publicApiKey}
        userId={userId}
      >
        <KnockFeedProvider feedId={knockConfig.feedChannelId}>
          <KnockFeedTray userId={userId} canonicalRole={canonicalRole} />
        </KnockFeedProvider>
      </KnockProvider>
    );
  }

  return (
    <LocalNotificationTray
      key={userId}
      userId={userId}
      canonicalRole={canonicalRole}
      initialItems={initialItems}
    />
  );
}
