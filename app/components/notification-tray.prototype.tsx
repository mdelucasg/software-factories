/**
 * PROTOTYPE (THROW-AWAY): Three variants of the In-App Notification Tray,
 * switchable via `?variant=A|B|C`, mounted on the existing `app/routes/layout.app.tsx` layout.
 *
 * Question (#6): How should the In-App notification tray look and behave in Cadence
 * across Student, Instructor, Team Admin, and Platform Admin when switching users via DevUI?
 */

import { useState, useEffect } from "react";
import { Form, useLocation, useNavigate, useSearchParams } from "react-router";
import { Sidebar } from "~/components/sidebar";
import { PrototypeSwitcher, type PrototypeVariantOption } from "~/components/prototype-switcher";
import { UserRole } from "~/db/schema";
import { cn } from "~/lib/utils";
import {
  Bell,
  Check,
  CheckCheck,
  Flame,
  Sparkles,
  MessageSquare,
  ShoppingBag,
  UsersRound,
  Receipt,
  AlertTriangle,
  Shield,
  ExternalLink,
  X,
  PlusCircle,
  RotateCcw,
  Inbox,
  ChevronRight,
  Clock,
  Radio,
} from "lucide-react";

export const NOTIFICATION_PROTOTYPE_VARIANTS: PrototypeVariantOption[] = [
  { key: "A", label: "Popover en Sidebar + Pestañas" },
  { key: "B", label: "Top Bar + Cajón Lateral (2 niveles)" },
  { key: "C", label: "Centro de Acción (Modal) + Banner" },
];

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

export interface PrototypeNotificationItem {
  id: string;
  kind: NotificationKind;
  subkind: NotificationSubkind;
  badgeLabel: string;
  title: string;
  body: string;
  meta: string;
  createdAtLabel: string;
  deepLink: string;
  ctaLabel: string;
  unread: boolean;
  progressPercent?: number;
  urgent?: boolean;
}

interface CurrentUser {
  id: number;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
}

interface RecentCourse {
  courseId: number;
  title: string;
  slug: string;
  coverImageUrl: string | null;
  completedLessons: number;
  totalLessons: number;
  progress: number;
}

interface NotificationPrototypeShellProps {
  currentUser: CurrentUser | null;
  recentCourses: RecentCourse[];
  isTeamAdmin: boolean;
  children: React.ReactNode;
}

export function resolveCanonicalRole(
  user: CurrentUser | null,
  isTeamAdmin: boolean
): CanonicalDomainRole {
  if (!user) return "Student";
  if (user.role === UserRole.Admin) return "Platform Admin";
  if (user.role === UserRole.Instructor) return "Instructor";
  if (isTeamAdmin) return "Team Admin";
  return "Student";
}

function buildInitialFeedForRole(
  role: CanonicalDomainRole,
  userName: string
): PrototypeNotificationItem[] {
  if (role === "Student") {
    return [
      {
        id: "student-adherence-1",
        kind: "engagement",
        subkind: "adherence_reminder",
        badgeLabel: "Adherence Reminder · 72h",
        title: "¡Tu Enrollment Active te espera tras 72 h sin Learning Activity!",
        body: `Hola ${userName}, llevas 72 horas sin registrar Learning Activity. Retoma «Introduction to TypeScript» en la Lesson «Your First TypeScript Program».`,
        meta: "Course: Introduction to TypeScript · Lesson #3 · Máx. 1 por inactividad",
        createdAtLabel: "Hace 15 min",
        deepLink: "/courses/introduction-to-typescript/lessons/3",
        ctaLabel: "Retomar Lesson",
        unread: true,
        progressPercent: 45,
      },
      {
        id: "student-recommendation-1",
        kind: "engagement",
        subkind: "course_recommendation",
        badgeLabel: "Course Recommendation",
        title: "Nuevo Course Published: «Design Systems with Tailwind»",
        body: "Por tu Enrollment Active con la Instructor Sarah Chen, te recomendamos su nuevo Course recién publicado en el catálogo.",
        meta: "Afinidad: Misma Instructor (Sarah Chen) · 1ª publicación",
        createdAtLabel: "Hace 1 h",
        deepLink: "/courses/design-systems-with-tailwind",
        ctaLabel: "Explorar Course",
        unread: true,
      },
      {
        id: "student-comment-1",
        kind: "transactional",
        subkind: "comment_reply",
        badgeLabel: "Comment Reply",
        title: "Sarah Chen respondió en «Your First TypeScript Program»",
        body: "«Excelente pregunta: cuando declaras una constante con const en TypeScript, el compilador infiere el tipo literal más específico...»",
        meta: "Course: Introduction to TypeScript · Lesson #3 · Hilo #1",
        createdAtLabel: "Hace 3 h",
        deepLink: "/courses/introduction-to-typescript/lessons/3#comment-2",
        ctaLabel: "Ver Comment",
        unread: true,
      },
      {
        id: "student-refund-approved-1",
        kind: "transactional",
        subkind: "refund_approved",
        badgeLabel: "Refund Request Approved",
        title: "Refund Request Approved ($79.00) — Refund en estado Pending",
        body: "Un Platform Admin aprobó tu solicitud para «Building REST APIs with Node.js». Nota: «Reembolso aprobado dentro del plazo».",
        meta: "Individual Purchase · $79.00 · Enrollment Lapsed",
        createdAtLabel: "Ayer",
        deepLink: "/settings",
        ctaLabel: "Ver en Settings",
        unread: true,
      },
      {
        id: "student-refund-issued-1",
        kind: "transactional",
        subkind: "refund_issued",
        badgeLabel: "Refund Issued",
        title: "Refund Issued: $79.00 enviados a tu método de pago",
        body: "Se confirmó la devolución íntegra correspondiente a tu Individual Purchase de «Building REST APIs with Node.js».",
        meta: "Individual Purchase · $79.00 devueltos",
        createdAtLabel: "Hace 2 días",
        deepLink: "/settings",
        ctaLabel: "Ver recibo",
        unread: false,
      },
      {
        id: "student-purchase-1",
        kind: "transactional",
        subkind: "individual_purchase",
        badgeLabel: "Individual Purchase",
        title: "Confirmación de Individual Purchase: «Introduction to TypeScript»",
        body: "Tu Enrollment está Active. Importe pagado: $49.00.",
        meta: "Individual Purchase · $49.00 · Enrollment Active",
        createdAtLabel: "Hace 5 días",
        deepLink: "/courses/introduction-to-typescript/welcome",
        ctaLabel: "Ir al Course",
        unread: false,
      },
    ];
  }

  if (role === "Instructor") {
    return [
      {
        id: "instructor-comment-root-1",
        kind: "transactional",
        subkind: "comment_root",
        badgeLabel: "Nuevo Comment raíz",
        title: "Nueva pregunta de Olivia Martinez en «Function Types»",
        body: "«¿Cuándo conviene usar sobrecarga de funciones frente a una unión de tipos en los parámetros de entrada?»",
        meta: "Course: Introduction to TypeScript · Lesson #8 · Sin respuesta",
        createdAtLabel: "Hace 20 min",
        deepLink: "/courses/introduction-to-typescript/lessons/8#comment-4",
        ctaLabel: "Responder en Lesson",
        unread: true,
      },
      {
        id: "instructor-digest-1",
        kind: "transactional",
        subkind: "purchase_digest",
        badgeLabel: "Digest de Purchases (Diario)",
        title: "Resumen Diario de Purchases: $441.00 en ingresos totales",
        body: "Últimas 24 h: 4 Individual Purchases + 1 Team Licence (5 Seats) entre «Introduction to TypeScript» ($341.00) y «Design Systems with Tailwind» ($100.00).",
        meta: "Frecuencia: Diario · 5 Purchases · Agrupado por Knock Batch",
        createdAtLabel: "Hace 2 h",
        deepLink: "/instructor/analytics",
        ctaLabel: "Ver Analytics",
        unread: true,
      },
      {
        id: "instructor-seat-1",
        kind: "transactional",
        subkind: "seat_claimed",
        badgeLabel: "Seat Claimed",
        title: "Noah Blackwood reclamó un Seat en «Introduction to TypeScript»",
        body: "El Student Noah Blackwood (noah.blackwood@student.dev) canjeó un Seat de Team Licence y activó su Enrollment.",
        meta: "Student: Noah Blackwood · Team Licence",
        createdAtLabel: "Hace 4 h",
        deepLink: "/instructor/1/students",
        ctaLabel: "Ver Students",
        unread: true,
      },
      {
        id: "instructor-refund-approved-1",
        kind: "transactional",
        subkind: "refund_approved",
        badgeLabel: "Refund Request Approved",
        title: "Refund Request Approved en «Introduction to TypeScript» ($49.00)",
        body: "El Platform Admin aprobó el Refund Request del Buyer Liam Thompson (Individual Purchase). Su Enrollment pasó a Lapsed.",
        meta: "Buyer: Liam Thompson · Individual Purchase · $49.00",
        createdAtLabel: "Hace 1 día",
        deepLink: "/instructor/1/students",
        ctaLabel: "Ver Students",
        unread: false,
      },
      {
        id: "instructor-course-status-1",
        kind: "transactional",
        subkind: "course_status",
        badgeLabel: "Estado de Course",
        title: "Platform Admin cambió «Design Systems with Tailwind» a Published",
        body: "Alex Rivera actualizó el estado de tu Course de Draft a Published. Ya está visible en el catálogo.",
        meta: "Draft → Published · Acción de Platform Admin",
        createdAtLabel: "Hace 3 días",
        deepLink: "/instructor/3",
        ctaLabel: "Gestionar Course",
        unread: false,
      },
    ];
  }

  if (role === "Team Admin") {
    return [
      {
        id: "team-seat-claimed-1",
        kind: "transactional",
        subkind: "seat_claimed",
        badgeLabel: "Seat Claimed",
        title: "Noah Blackwood reclamó un Seat en «Introduction to TypeScript»",
        body: "Noah Blackwood (noah.blackwood@student.dev) activó su Enrollment. Ocupación de tu Team Licence: 6 / 10 Seats Claimed.",
        meta: "Team Licence · Ocupación: 6 / 10 Seats Claimed",
        createdAtLabel: "Hace 35 min",
        deepLink: "/team",
        ctaLabel: "Gestionar Team Licence",
        unread: true,
      },
      {
        id: "team-refund-declined-1",
        kind: "transactional",
        subkind: "refund_declined",
        badgeLabel: "Refund Request Declined",
        title: "Refund Request Declined para tu Team Licence ($390.00)",
        body: "Nota del Platform Admin (decisionNote): «Una Team Licence con Seats en estado Claimed no puede reembolsarse según la política de Cadence».",
        meta: "Course: Introduction to TypeScript · Team Licence · $390.00",
        createdAtLabel: "Hace 3 h",
        deepLink: "/team",
        ctaLabel: "Ver detalle en Team",
        unread: true,
      },
      {
        id: "team-refund-open-1",
        kind: "transactional",
        subkind: "refund_open",
        badgeLabel: "Refund Request Open",
        title: "Tu Refund Request ($295.00) está en estado Open",
        body: "Recibimos tu solicitud para la Team Licence de «Building REST APIs with Node.js». Sus Seats Unclaimed permanecen congelados mientras un Platform Admin decide.",
        meta: "Course: Building REST APIs with Node.js · $295.00",
        createdAtLabel: "Ayer",
        deepLink: "/team",
        ctaLabel: "Ver estado en Team",
        unread: false,
      },
      {
        id: "team-purchase-1",
        kind: "transactional",
        subkind: "team_licence_purchase",
        badgeLabel: "Team Licence Purchase",
        title: "Confirmación de Team Licence: 10 Seats en «Introduction to TypeScript»",
        body: "Pago único de $390.00 completado. Tus 10 Seats Unclaimed están listos para compartir.",
        meta: "Team Licence · 10 Seats · $390.00",
        createdAtLabel: "Hace 4 días",
        deepLink: "/team",
        ctaLabel: "Repartir Seats",
        unread: false,
      },
    ];
  }

  // Platform Admin
  return [
    {
      id: "admin-refund-failed-1",
      kind: "transactional",
      subkind: "refund_failed",
      badgeLabel: "Refund Failed · Crítico",
      title: "Fallo en devolución: Refund Failed ($295.00) a Bossy McBossface",
      body: "El envío del dinero al Buyer Bossy McBossface (Team Licence en «Building REST APIs with Node.js») falló. El Refund Request sigue en Approved.",
      meta: "Buyer: Bossy McBossface (Team Admin) · Team Licence · $295.00",
      createdAtLabel: "Hace 10 min",
      deepLink: "/admin/refunds?status=approved",
      ctaLabel: "Revisar Refund Failed",
      unread: true,
      urgent: true,
    },
    {
      id: "admin-refund-open-1",
      kind: "transactional",
      subkind: "refund_open",
      badgeLabel: "Refund Request Open",
      title: "Nuevo Refund Request Open de Emma Wilson ($49.00)",
      body: "Individual Purchase en «Introduction to TypeScript». Motivo: «Compré el curso individualmente antes de recibir el enlace de Seat de mi empresa».",
      meta: "Buyer: Emma Wilson (Student) · Individual Purchase · $49.00",
      createdAtLabel: "Hace 45 min",
      deepLink: "/admin/refunds?status=open",
      ctaLabel: "Decidir Refund Request",
      unread: true,
      urgent: true,
    },
    {
      id: "admin-refund-open-2",
      kind: "transactional",
      subkind: "refund_open",
      badgeLabel: "Refund Request Open",
      title: "Nuevo Refund Request Open de Ava Nakamura ($245.00)",
      body: "Team Licence (5 Seats Unclaimed) en «Practical Data Visualisation». Motivo: «Reasignación del presupuesto de formación del equipo».",
      meta: "Buyer: Ava Nakamura (Team Admin) · Team Licence · $245.00",
      createdAtLabel: "Hace 2 h",
      deepLink: "/admin/refunds?status=open",
      ctaLabel: "Decidir Refund Request",
      unread: true,
    },
  ];
}

function getNotificationIcon(item: PrototypeNotificationItem) {
  switch (item.subkind) {
    case "adherence_reminder":
      return <Flame className="size-4 text-amber-500" />;
    case "course_recommendation":
      return <Sparkles className="size-4 text-emerald-500" />;
    case "comment_root":
    case "comment_reply":
      return <MessageSquare className="size-4 text-blue-500" />;
    case "individual_purchase":
    case "team_licence_purchase":
    case "purchase_digest":
      return <ShoppingBag className="size-4 text-violet-500" />;
    case "seat_claimed":
      return <UsersRound className="size-4 text-teal-500" />;
    case "refund_failed":
      return <AlertTriangle className="size-4 text-red-500" />;
    case "refund_open":
    case "refund_approved":
    case "refund_declined":
    case "refund_issued":
      return <Receipt className="size-4 text-orange-500" />;
    case "course_status":
      return <Shield className="size-4 text-indigo-500" />;
  }
}

const ROLE_PRESETS = [
  { userId: 5, label: "Student", name: "Emma Wilson" },
  { userId: 2, label: "Instructor", name: "Sarah Chen" },
  { userId: 10, label: "Team Admin", name: "Bossy McBossface" },
  { userId: 1, label: "Platform Admin", name: "Alex Rivera" },
];

export function NotificationPrototypeShell({
  currentUser,
  recentCourses,
  isTeamAdmin,
  children,
}: NotificationPrototypeShellProps) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const rawVariant = (searchParams.get("variant") ?? "A").toUpperCase();
  const variant = ["A", "B", "C"].includes(rawVariant) ? rawVariant : "A";

  const canonicalRole = resolveCanonicalRole(currentUser, isTeamAdmin);
  const subscriberId = currentUser ? String(currentUser.id) : "anonymous";

  // Keep per-user state in memory so switching back and forth via DevUI feels real
  const [feedsByUser, setFeedsByUser] = useState<
    Record<string, PrototypeNotificationItem[]>
  >(() => ({
    [subscriberId]: buildInitialFeedForRole(
      canonicalRole,
      currentUser?.name ?? " Visitante"
    ),
  }));

  const [trayOpen, setTrayOpen] = useState(false);
  const [lastAction, setLastAction] = useState<string>(
    `Knock Feed sincronizado para userId="${subscriberId}" (${canonicalRole})`
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Sync when DevUI changes currentUser
  useEffect(() => {
    setFeedsByUser((prev) => {
      if (prev[subscriberId]) return prev;
      return {
        ...prev,
        [subscriberId]: buildInitialFeedForRole(
          canonicalRole,
          currentUser?.name ?? "Visitante"
        ),
      };
    });
    setBannerDismissed(false);
    setLastAction(
      `DevUI cambió suscriptor → ${currentUser?.name ?? "Sin sesión"} (userId="${subscriberId}", rol: ${canonicalRole})`
    );
  }, [subscriberId, canonicalRole, currentUser?.name]);

  const items =
    feedsByUser[subscriberId] ??
    buildInitialFeedForRole(canonicalRole, currentUser?.name ?? "Visitante");

  const unreadCount = items.filter((i) => i.unread).length;
  const engagementItems = items.filter((i) => i.kind === "engagement");
  const transactionalItems = items.filter((i) => i.kind === "transactional");

  function markAsRead(id: string) {
    setFeedsByUser((prev) => ({
      ...prev,
      [subscriberId]: (prev[subscriberId] ?? items).map((item) =>
        item.id === id ? { ...item, unread: false } : item
      ),
    }));
    const target = items.find((i) => i.id === id);
    setLastAction(`Marcada como leída: «${target?.badgeLabel ?? id}»`);
  }

  function markAllAsRead() {
    setFeedsByUser((prev) => ({
      ...prev,
      [subscriberId]: (prev[subscriberId] ?? items).map((item) => ({
        ...item,
        unread: false,
      })),
    }));
    setLastAction(
      `Marcadas todas como leídas (${unreadCount} → 0) para ${currentUser?.name ?? subscriberId}`
    );
  }

  function handleNavigateDeepLink(item: PrototypeNotificationItem) {
    markAsRead(item.id);
    setTrayOpen(false);

    // Preserve ?variant= across deep-link navigation so the user stays in the current variant
    const [pathAndQuery, hash] = item.deepLink.split("#");
    const [pathname, existingQuery] = pathAndQuery.split("?");
    const params = new URLSearchParams(existingQuery ?? "");
    params.set("variant", variant);
    const fullTarget = `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;

    setLastAction(`Deep-link → ${item.deepLink}`);
    navigate(fullTarget);
  }

  function simulateIncomingNotification() {
    const nowId = `sim-${Date.now().toString().slice(-4)}`;
    const simulated: PrototypeNotificationItem =
      canonicalRole === "Student"
        ? {
            id: nowId,
            kind: "engagement",
            subkind: "adherence_reminder",
            badgeLabel: "Adherence Reminder (Simulado)",
            title: "¡72 h sin Learning Activity! Continúa «Introduction to TypeScript»",
            body: "Knock disparó el paso delay (72h) sin cancelación. Retoma tu última Lesson en curso.",
            meta: "Workflow: adherence-reminder · key: adherence-student-" + subscriberId,
            createdAtLabel: "Ahora mismo",
            deepLink: "/courses/introduction-to-typescript/lessons/3",
            ctaLabel: "Retomar Lesson",
            unread: true,
            progressPercent: 45,
          }
        : canonicalRole === "Instructor"
          ? {
              id: nowId,
              kind: "transactional",
              subkind: "comment_root",
              badgeLabel: "Nuevo Comment raíz (Simulado)",
              title: "James Park publicó un Comment en «Generics Basics»",
              body: "«¿Podemos restringir un parámetro genérico T para que acepte únicamente claves de otro objeto?»",
              meta: "Course: Introduction to TypeScript · Lesson #9",
              createdAtLabel: "Ahora mismo",
              deepLink: "/courses/introduction-to-typescript/lessons/9",
              ctaLabel: "Responder Comment",
              unread: true,
            }
          : canonicalRole === "Team Admin"
            ? {
                id: nowId,
                kind: "transactional",
                subkind: "seat_claimed",
                badgeLabel: "Seat Claimed (Simulado)",
                title: "Sophia Davis reclamó un Seat en tu Team Licence",
                body: "Sophia Davis (sophia.davis@student.dev) reclamó un Seat. Ocupación actualizada: 7 / 10 Seats Claimed.",
                meta: "Team Licence · Ocupación: 7 / 10 Seats",
                createdAtLabel: "Ahora mismo",
                deepLink: "/team",
                ctaLabel: "Ver Team Licence",
                unread: true,
              }
            : {
                id: nowId,
                kind: "transactional",
                subkind: "refund_open",
                badgeLabel: "Refund Request Open (Simulado)",
                title: "Nuevo Refund Request Open de James Park ($49.00)",
                body: "Individual Purchase en «Design Systems with Tailwind». Esperando decisión del Platform Admin.",
                meta: "Buyer: James Park (Student) · $49.00",
                createdAtLabel: "Ahora mismo",
                deepLink: "/admin/refunds?status=open",
                ctaLabel: "Decidir ahora",
                unread: true,
                urgent: true,
              };

    setFeedsByUser((prev) => ({
      ...prev,
      [subscriberId]: [simulated, ...(prev[subscriberId] ?? items)],
    }));
    setLastAction(
      `Evento Knock simulado (${simulated.badgeLabel}) para userId="${subscriberId}"`
    );
  }

  function resetCurrentFeed() {
    setFeedsByUser((prev) => ({
      ...prev,
      [subscriberId]: buildInitialFeedForRole(
        canonicalRole,
        currentUser?.name ?? "Visitante"
      ),
    }));
    setBannerDismissed(false);
    setLastAction(`Bandeja restaurada al estado inicial (${canonicalRole})`);
  }

  return (
    <div className="flex h-screen overflow-hidden flex-col">
      {/* Prototype State Surface Bar (Rule 5 of prototype skill: always surface relevant state) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
            <Radio className="size-3 animate-pulse" />
            Knock Feed · Variante {variant}
          </span>
          <span className="text-zinc-400">
            Suscriptor:{" "}
            <strong className="text-white">
              {currentUser ? `${currentUser.name} (#${subscriberId})` : "Ninguno"}
            </strong>
          </span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-medium text-amber-300 border border-zinc-700">
            Rol: {canonicalRole}
          </span>
          <span className="text-zinc-400">
            No leídas:{" "}
            <strong className="text-emerald-400">{unreadCount}</strong>/{items.length}
          </span>
          <span className="hidden xl:inline text-zinc-500 truncate max-w-md">
            · {lastAction}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-400 mr-1 hidden md:inline">
            Cambio rápido (DevUI):
          </span>
          {ROLE_PRESETS.map((preset) => {
            const isCurrent = currentUser?.id === preset.userId;
            return (
              <Form
                key={preset.userId}
                method="post"
                action={`/api/switch-user?redirectTo=${encodeURIComponent(
                  location.pathname + location.search
                )}`}
              >
                <input type="hidden" name="userId" value={preset.userId} />
                <button
                  type="submit"
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-medium transition-colors border",
                    isCurrent
                      ? "border-amber-400 bg-amber-500/20 text-amber-200"
                      : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  )}
                  title={`Cambiar a ${preset.name} (${preset.label})`}
                >
                  {preset.label}
                </button>
              </Form>
            );
          })}

          <button
            type="button"
            onClick={simulateIncomingNotification}
            className="ml-1 inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            <PlusCircle className="size-3" />
            Simular evento
          </button>

          <button
            type="button"
            onClick={resetCurrentFeed}
            title="Restaurar bandeja de este usuario"
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
          >
            <RotateCcw className="size-3" />
          </button>
        </div>
      </div>

      {/* Render the selected Variant layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {variant === "A" && (
          <VariantASidebarPopover
            currentUser={currentUser}
            recentCourses={recentCourses}
            isTeamAdmin={isTeamAdmin}
            canonicalRole={canonicalRole}
            items={items}
            unreadCount={unreadCount}
            trayOpen={trayOpen}
            setTrayOpen={setTrayOpen}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onNavigateDeepLink={handleNavigateDeepLink}
          >
            {children}
          </VariantASidebarPopover>
        )}

        {variant === "B" && (
          <VariantBTopBarDrawer
            currentUser={currentUser}
            recentCourses={recentCourses}
            isTeamAdmin={isTeamAdmin}
            canonicalRole={canonicalRole}
            subscriberId={subscriberId}
            items={items}
            engagementItems={engagementItems}
            transactionalItems={transactionalItems}
            unreadCount={unreadCount}
            trayOpen={trayOpen}
            setTrayOpen={setTrayOpen}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onNavigateDeepLink={handleNavigateDeepLink}
          >
            {children}
          </VariantBTopBarDrawer>
        )}

        {variant === "C" && (
          <VariantCCommandCenter
            currentUser={currentUser}
            recentCourses={recentCourses}
            isTeamAdmin={isTeamAdmin}
            canonicalRole={canonicalRole}
            items={items}
            unreadCount={unreadCount}
            trayOpen={trayOpen}
            setTrayOpen={setTrayOpen}
            bannerDismissed={bannerDismissed}
            setBannerDismissed={setBannerDismissed}
            onMarkAsRead={markAsRead}
            onMarkAllAsRead={markAllAsRead}
            onNavigateDeepLink={handleNavigateDeepLink}
          >
            {children}
          </VariantCCommandCenter>
        )}
      </div>

      <PrototypeSwitcher
        variants={NOTIFICATION_PROTOTYPE_VARIANTS}
        current={variant}
      />
    </div>
  );
}

/* ============================================================================
 * VARIANT A: Bell in Sidebar Header + Floating Tabbed Popover
 * ============================================================================ */

function VariantASidebarPopover({
  currentUser,
  recentCourses,
  isTeamAdmin,
  canonicalRole,
  items,
  unreadCount,
  trayOpen,
  setTrayOpen,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigateDeepLink,
  children,
}: {
  currentUser: CurrentUser | null;
  recentCourses: RecentCourse[];
  isTeamAdmin: boolean;
  canonicalRole: CanonicalDomainRole;
  items: PrototypeNotificationItem[];
  unreadCount: number;
  trayOpen: boolean;
  setTrayOpen: (open: boolean) => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onNavigateDeepLink: (item: PrototypeNotificationItem) => void;
  children: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<
    "all" | "unread" | "engagement" | "transactional"
  >("all");

  const filteredItems = items.filter((item) => {
    if (activeTab === "unread") return item.unread;
    if (activeTab === "engagement") return item.kind === "engagement";
    if (activeTab === "transactional") return item.kind === "transactional";
    return true;
  });

  return (
    <>
      <div className="relative flex h-full shrink-0">
        <Sidebar
          currentUser={currentUser}
          recentCourses={recentCourses}
          isTeamAdmin={isTeamAdmin}
        />

        {/* Bell button anchored in top-right of the Sidebar header */}
        <div className="absolute right-3 top-2.5 z-30">
          <button
            type="button"
            onClick={() => setTrayOpen(!trayOpen)}
            aria-label="Abrir bandeja de notificaciones (Variante A)"
            className={cn(
              "relative inline-flex items-center justify-center rounded-md p-2 transition-colors border",
              trayOpen
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background/90 text-foreground border-border hover:bg-accent"
            )}
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Floating Popover anchored next to the Sidebar */}
        {trayOpen && (
          <div className="absolute left-52 top-12 z-40 w-[420px] max-h-[82vh] flex flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/40">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Notificaciones</h3>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {canonicalRole}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Variante A · Popover en Sidebar con pestañas
                </p>
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
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex border-b bg-muted/20 px-2 pt-1.5 text-xs">
              {[
                { key: "all", label: `Todas (${items.length})` },
                { key: "unread", label: `No leídas (${unreadCount})` },
                ...(canonicalRole === "Student"
                  ? [
                      {
                        key: "engagement",
                        label: `Impulso (${
                          items.filter((i) => i.kind === "engagement").length
                        })`,
                      },
                    ]
                  : []),
                {
                  key: "transactional",
                  label: `Transaccionales (${
                    items.filter((i) => i.kind === "transactional").length
                  })`,
                },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      tab.key as
                        | "all"
                        | "unread"
                        | "engagement"
                        | "transactional"
                    )
                  }
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

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto divide-y">
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
                          {getNotificationIcon(item)}
                        </div>

                        <div className="flex-1 min-w-0">
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
                              <span className="text-[11px] text-muted-foreground">
                                {item.createdAtLabel}
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
                          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
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

                          <p className="mt-1.5 text-[11px] text-muted-foreground/80 font-mono">
                            {item.meta}
                          </p>

                          <div className="mt-2.5 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onNavigateDeepLink(item)}
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

      <main className="flex-1 overflow-y-auto">{children}</main>
    </>
  );
}

/* ============================================================================
 * VARIANT B: Top Utility Header Bar + Full-Height Right Slide-Over Drawer
 * (Two distinct visual tiers: Priority/Adherence Cards on top, Timeline below)
 * ============================================================================ */

function VariantBTopBarDrawer({
  currentUser,
  recentCourses,
  isTeamAdmin,
  canonicalRole,
  subscriberId,
  items,
  engagementItems,
  transactionalItems,
  unreadCount,
  trayOpen,
  setTrayOpen,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigateDeepLink,
  children,
}: {
  currentUser: CurrentUser | null;
  recentCourses: RecentCourse[];
  isTeamAdmin: boolean;
  canonicalRole: CanonicalDomainRole;
  subscriberId: string;
  items: PrototypeNotificationItem[];
  engagementItems: PrototypeNotificationItem[];
  transactionalItems: PrototypeNotificationItem[];
  unreadCount: number;
  trayOpen: boolean;
  setTrayOpen: (open: boolean) => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onNavigateDeepLink: (item: PrototypeNotificationItem) => void;
  children: React.ReactNode;
}) {
  // For roles without Adherence/Course Recommendation, highlight urgent or top unread item in Tier 1
  const highlightedItems =
    engagementItems.length > 0
      ? engagementItems
      : items.filter((i) => i.urgent || i.subkind === "purchase_digest");

  const timelineItems = items.filter((i) => !highlightedItems.includes(i));

  return (
    <>
      <Sidebar
        currentUser={currentUser}
        recentCourses={recentCourses}
        isTeamAdmin={isTeamAdmin}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Utility Header Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Vista activa:
            </span>
            <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-semibold">
              {currentUser?.name ?? "Visitante"} · {canonicalRole}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTrayOpen(!trayOpen)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all shadow-xs",
                unreadCount > 0
                  ? "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15"
                  : "border-border bg-background text-muted-foreground hover:bg-accent"
              )}
            >
              <Bell className="size-4 text-primary" />
              <span>Bandeja Knock</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-bold",
                  unreadCount > 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {unreadCount} sin leer
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Right Slide-Over Drawer */}
      {trayOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-[1px]">
          <div className="relative flex h-full w-full max-w-md flex-col border-l bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-base font-bold">
                  Centro de Notificaciones ({canonicalRole})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Variante B · Cajón lateral de 2 niveles · Knock ID #{subscriberId}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllAsRead}
                    className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                  >
                    Leer todas
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTrayOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6 pb-20">
              {/* Tier 1: Adherence & Highlighted Cards */}
              {highlightedItems.length > 0 && (
                <section>
                  <div className="mb-2.5 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                      <Flame className="size-3.5" />
                      {canonicalRole === "Student"
                        ? "Impulso de Aprendizaje y Recomendaciones"
                        : "Destacadas para tu rol"}
                    </h3>
                  </div>

                  <div className="space-y-3">
                    {highlightedItems.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-xl border-2 p-4 transition-all",
                          item.subkind === "adherence_reminder"
                            ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-background to-background"
                            : item.subkind === "course_recommendation"
                              ? "border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-background to-background"
                              : "border-primary/40 bg-primary/5",
                          !item.unread && "opacity-70 border-border"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                            {getNotificationIcon(item)}
                            {item.badgeLabel}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {item.createdAtLabel}
                          </span>
                        </div>

                        <h4 className="mt-2 text-sm font-bold leading-snug">
                          {item.title}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          {item.body}
                        </p>

                        {typeof item.progressPercent === "number" && (
                          <div className="mt-3 rounded-lg bg-background/80 p-2.5 border">
                            <div className="flex justify-between text-[11px] font-medium mb-1">
                              <span>Progreso del Enrollment Active</span>
                              <span>{item.progressPercent}%</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted">
                              <div
                                className="h-2 rounded-full bg-amber-500"
                                style={{ width: `${item.progressPercent}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => onNavigateDeepLink(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90"
                          >
                            {item.ctaLabel}
                            <ChevronRight className="size-3.5" />
                          </button>
                          {item.unread && (
                            <button
                              type="button"
                              onClick={() => onMarkAsRead(item.id)}
                              className="text-xs text-muted-foreground hover:text-foreground underline"
                            >
                              Marcar como leída
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Tier 2: Transactional Activity Stream */}
              <section>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  Actividad Transaccional ({timelineItems.length})
                </h3>

                <div className="space-y-2.5">
                  {timelineItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "rounded-lg border p-3.5 transition-colors",
                        item.unread
                          ? "border-primary/30 bg-card shadow-xs"
                          : "border-border bg-muted/20 opacity-75"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-md border bg-muted p-1.5">
                          {getNotificationIcon(item)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              {item.badgeLabel}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {item.createdAtLabel}
                            </span>
                          </div>
                          <p className="mt-0.5 text-sm font-semibold">
                            {item.title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.body}
                          </p>
                          <div className="mt-2.5 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => onNavigateDeepLink(item)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                            >
                              {item.ctaLabel}
                              <ExternalLink className="size-3" />
                            </button>
                            {item.unread && (
                              <button
                                type="button"
                                onClick={() => onMarkAsRead(item.id)}
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                              >
                                <Check className="size-3" />
                                Leída
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================================================================
 * VARIANT C: Sidebar Inbox Pill + Persistent Adherence/Urgent Top Banner +
 * Split-Pane Command Center Modal
 * ============================================================================ */

function VariantCCommandCenter({
  currentUser,
  recentCourses,
  isTeamAdmin,
  canonicalRole,
  items,
  unreadCount,
  trayOpen,
  setTrayOpen,
  bannerDismissed,
  setBannerDismissed,
  onMarkAsRead,
  onMarkAllAsRead,
  onNavigateDeepLink,
  children,
}: {
  currentUser: CurrentUser | null;
  recentCourses: RecentCourse[];
  isTeamAdmin: boolean;
  canonicalRole: CanonicalDomainRole;
  items: PrototypeNotificationItem[];
  unreadCount: number;
  trayOpen: boolean;
  setTrayOpen: (open: boolean) => void;
  bannerDismissed: boolean;
  setBannerDismissed: (v: boolean) => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onNavigateDeepLink: (item: PrototypeNotificationItem) => void;
  children: React.ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    items[0]?.id ?? null
  );

  useEffect(() => {
    if (!items.some((i) => i.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null);
    }
  }, [items, selectedId]);

  const selectedItem = items.find((i) => i.id === selectedId) ?? items[0];

  // Top persistent banner for unread Adherence Reminder or Urgent Admin alert
  const bannerItem = items.find(
    (i) =>
      i.unread &&
      (i.subkind === "adherence_reminder" ||
        i.subkind === "course_recommendation" ||
        i.urgent)
  );

  return (
    <>
      <div className="relative flex h-full shrink-0">
        <Sidebar
          currentUser={currentUser}
          recentCourses={recentCourses}
          isTeamAdmin={isTeamAdmin}
        />

        {/* Linear/Notion style full-width Inbox trigger pill below Sidebar header */}
        <div className="absolute left-3 right-3 top-16 z-30">
          <button
            type="button"
            onClick={() => setTrayOpen(!trayOpen)}
            className={cn(
              "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition-all",
              unreadCount > 0
                ? "border-primary/50 bg-primary/10 text-foreground hover:bg-primary/15"
                : "border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <span className="flex items-center gap-2">
              <Inbox className="size-4 text-primary" />
              Bandeja de entrada
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-bold",
                unreadCount > 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {unreadCount}
            </span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Persistent Banner for Adherence Reminder or Critical Alert */}
        {bannerItem && !bannerDismissed && (
          <div
            className={cn(
              "flex items-center justify-between gap-4 border-b px-6 py-2.5 text-xs",
              bannerItem.subkind === "adherence_reminder"
                ? "bg-amber-500/15 border-amber-500/30 text-amber-950 dark:text-amber-100"
                : bannerItem.urgent
                  ? "bg-red-500/15 border-red-500/30 text-red-950 dark:text-red-100"
                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-950 dark:text-emerald-100"
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {getNotificationIcon(bannerItem)}
              <span className="font-bold shrink-0">
                {bannerItem.badgeLabel}:
              </span>
              <span className="truncate font-medium">{bannerItem.title}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigateDeepLink(bannerItem)}
                className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background hover:opacity-90"
              >
                {bannerItem.ctaLabel} →
              </button>
              <button
                type="button"
                onClick={() => setTrayOpen(true)}
                className="underline font-medium px-1"
              >
                Abrir Centro ({unreadCount})
              </button>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                className="rounded p-1 hover:bg-black/10"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Split-Pane Command Center Modal */}
      {trayOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="flex h-[540px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-3.5 bg-muted/30">
              <div className="flex items-center gap-2.5">
                <Inbox className="size-5 text-primary" />
                <div>
                  <h2 className="text-sm font-bold">
                    Command Inbox · {currentUser?.name} ({canonicalRole})
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    Variante C · Vista Maestro-Detalle con inspección completa del evento
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllAsRead}
                    className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                  >
                    <CheckCheck className="size-3.5" />
                    Marcar todas como leídas ({unreadCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTrayOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Split Master-Detail Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left Master List */}
              <div className="w-1/2 overflow-y-auto border-r divide-y">
                {items.map((item) => {
                  const isSelected = selectedItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        "flex w-full items-start gap-3 p-3.5 text-left transition-colors",
                        isSelected
                          ? "bg-accent"
                          : item.unread
                            ? "bg-primary/[0.03] hover:bg-muted/60"
                            : "opacity-70 hover:bg-muted/40"
                      )}
                    >
                      <div className="mt-0.5 shrink-0">
                        {getNotificationIcon(item)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "text-[10px] font-bold uppercase tracking-wider",
                              item.kind === "engagement"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground"
                            )}
                          >
                            {item.badgeLabel}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {item.createdAtLabel}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold">
                          {item.title}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {item.body}
                        </p>
                      </div>
                      {item.unread && (
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right Detail Pane */}
              <div className="flex w-1/2 flex-col justify-between p-6 overflow-y-auto">
                {selectedItem ? (
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                          selectedItem.kind === "engagement"
                            ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                            : "bg-muted text-foreground"
                        )}
                      >
                        {getNotificationIcon(selectedItem)}
                        {selectedItem.badgeLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {selectedItem.createdAtLabel}
                      </span>
                    </div>

                    <h3 className="mt-4 text-lg font-bold leading-snug">
                      {selectedItem.title}
                    </h3>

                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      {selectedItem.body}
                    </p>

                    {typeof selectedItem.progressPercent === "number" && (
                      <div className="mt-4 rounded-xl border bg-amber-500/5 p-3.5">
                        <div className="flex justify-between text-xs font-semibold mb-1.5">
                          <span>Progreso actual en el Course</span>
                          <span>{selectedItem.progressPercent}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-amber-500"
                            style={{ width: `${selectedItem.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mt-5 rounded-lg border bg-muted/30 p-3 font-mono text-xs text-muted-foreground space-y-1">
                      <div>
                        <strong>Categoría:</strong>{" "}
                        {selectedItem.kind === "engagement"
                          ? "Adherencia / Recomendación (Engagement)"
                          : "Transaccional"}
                      </div>
                      <div>
                        <strong>Metadatos:</strong> {selectedItem.meta}
                      </div>
                      <div>
                        <strong>Deep-link:</strong> {selectedItem.deepLink}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Selecciona una notificación para inspeccionarla.
                  </div>
                )}

                {selectedItem && (
                  <div className="mt-6 flex items-center justify-between border-t pt-4">
                    <button
                      type="button"
                      onClick={() => onNavigateDeepLink(selectedItem)}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      {selectedItem.ctaLabel}
                      <ExternalLink className="size-3.5" />
                    </button>

                    {selectedItem.unread ? (
                      <button
                        type="button"
                        onClick={() => onMarkAsRead(selectedItem.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-accent"
                      >
                        <Check className="size-3.5" />
                        Marcar como leída
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        ✓ Leída
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
