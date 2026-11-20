import { Link, data, isRouteErrorResponse } from "react-router";
import { AlertTriangle } from "lucide-react";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.lessons.$lessonId";
import {
  coursePermissions,
  type Capability,
  type CourseRef,
} from "~/modules/permissions/course-permissions.server";
import {
  findLessonComment,
  findLessonQuiz,
  getInstructorName,
  getLessonOutline,
  getLessonQuiz,
  getRenderedThread,
  markLessonComplete,
  openLessonForStudent,
  parseQuizAnswers,
  scoreQuizAttempt,
} from "~/modules/lesson-page/index.server";
import {
  createComment,
  deleteComment,
  editComment,
} from "~/lib/comments.server";
import { defaultNotifications } from "~/lib/notifications.server";
import { isBookmarked, toggleBookmark } from "~/lib/bookmarks.server";
import { getNote, saveNote } from "~/lib/notes.server";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { renderMarkdown } from "~/lib/markdown.server";
import { parseFormData } from "~/lib/validation";
import { db } from "~/db";
import { Button } from "~/components/ui/button";
import { FullLesson } from "~/components/lesson/full-lesson";
import { LockedLesson } from "~/components/lesson/locked-lesson";

const createCommentSchema = z.object({
  intent: z.literal("create-comment"),
  body: z.string(),
  parentId: z.coerce.number().int().optional(),
});

const editCommentSchema = z.object({
  intent: z.literal("edit-comment"),
  commentId: z.coerce.number().int(),
  body: z.string(),
});

const saveNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something before saving your note.")
    .max(
      MAX_NOTE_LENGTH,
      `Your note is over ${MAX_NOTE_LENGTH.toLocaleString("en")} characters, so it was not saved.`
    ),
});

const submitQuizSchema = z.object({
  quizId: z.coerce.number().int().positive(),
});

const deleteCommentSchema = z.object({
  intent: z.literal("delete-comment"),
  commentId: z.coerce.number().int(),
});

/**
 * The course named by this route's slug, through this lesson. A lesson in
 * another course, or a malformed lesson id, counts as not found.
 */
function lessonRef(params: { slug: string; lessonId: string }): CourseRef {
  return { slug: params.slug, lessonId: params.lessonId };
}

/**
 * What each action intent needs: comments, Bookmarks and Notes need view;
 * progress and quizzes need take. Moderating Discussions (deleting someone
 * else's post) additionally needs manage, checked in the delete intent.
 */
const INTENT_CAPABILITY: Record<string, Capability | undefined> = {
  "create-comment": "view",
  "edit-comment": "view",
  "delete-comment": "view",
  "toggle-bookmark": "view",
  "save-note": "view",
  "mark-complete": "take",
  "submit-quiz": "take",
};

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.lesson?.title ?? "Lesson";
  const courseTitle = loaderData?.course?.title ?? "Course";
  return [{ title: `${title} — ${courseTitle} — Cadence` }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  // Not found covers an unknown course, a malformed lesson id, and a lesson
  // from another course.
  const decisions = await coursePermissions.getCourseDecisions(
    request,
    lessonRef(params)
  );
  if (!decisions.found) {
    throw data("Lesson not found", { status: 404 });
  }

  const { course, person, enrolled, view, take, manage } = decisions;
  const lessonId = Number(params.lessonId);
  const outline = getLessonOutline(course.id, lessonId);
  if (!outline) {
    throw data("Lesson not found", { status: 404 });
  }

  // Someone who can't view the content gets the lesson's title, its module and
  // the course outline — never the body, video or quiz — plus the reason, so
  // the page can show the right call to action.
  if (!view.allowed) {
    return {
      view: "locked" as const,
      course: outline.course,
      curriculum: outline.curriculum,
      module: outline.module,
      lesson: { id: outline.lesson.id, title: outline.lesson.title },
      enrolled,
      lockedReason: view.reason,
    };
  }

  // Everything from here on is behind the can-view-content bar above:
  // comments, Bookmarks and Notes are confidential to the course.
  const currentUserId = person?.id ?? null;
  const { lesson } = outline;
  const note = currentUserId ? getNote(db, currentUserId, lessonId) : undefined;

  return {
    view: "full" as const,
    ...outline,
    ...openLessonForStudent({
      studentId: currentUserId,
      canTake: take.allowed,
      courseId: course.id,
      lesson,
    }),
    ...getLessonQuiz(lessonId, currentUserId),
    contentHtml: lesson.content ? await renderMarkdown(lesson.content) : null,
    enrolled,
    currentUserId,
    comments: await getRenderedThread(lessonId),
    canModerate: manage.allowed,
    instructorName: getInstructorName(course.instructorId),
    bookmarked: currentUserId
      ? isBookmarked(db, currentUserId, lessonId)
      : false,
    note: note ? { body: note.body, updatedAt: note.updatedAt } : null,
  };
}

type ActionContext = {
  formData: FormData;
  personId: number;
  lessonId: number;
  /** Whether the person may delete other people's comments. */
  canModerate: () => boolean;
};

async function createCommentIntent({
  formData,
  personId,
  lessonId,
}: ActionContext) {
  const parsed = parseFormData(formData, createCommentSchema);
  if (!parsed.success) {
    return { ok: false, error: "Enter a comment before posting." };
  }
  const created = await createComment(
    db,
    personId,
    lessonId,
    parsed.data.parentId ?? null,
    parsed.data.body,
    new Date(),
    await defaultNotifications()
  );
  return created.ok ? { ok: true } : created;
}

function editCommentIntent({ formData, personId, lessonId }: ActionContext) {
  const parsed = parseFormData(formData, editCommentSchema);
  if (!parsed.success) {
    return { ok: false, error: "Enter a comment before saving." };
  }
  // Scope the id to this lesson so a comment elsewhere can't be reached by
  // posting its id to this route.
  if (!findLessonComment(lessonId, parsed.data.commentId)) {
    throw data("Comment not found", { status: 404 });
  }
  const edited = editComment(
    db,
    parsed.data.commentId,
    personId,
    parsed.data.body,
    new Date()
  );
  return edited.ok ? { ok: true } : edited;
}

async function deleteCommentIntent(context: ActionContext) {
  const parsed = parseFormData(context.formData, deleteCommentSchema);
  if (!parsed.success) {
    return { ok: false, error: "Could not delete that comment." };
  }
  if (!findLessonComment(context.lessonId, parsed.data.commentId)) {
    throw data("Comment not found", { status: 404 });
  }
  // Anyone who can view may delete their own posts; moderating someone
  // else's takes the manage capability.
  const deleted = await deleteComment(
    db,
    parsed.data.commentId,
    context.personId,
    context.canModerate(),
    new Date(),
    await defaultNotifications()
  );
  return deleted.ok ? { ok: true } : deleted;
}

/**
 * Service validation failures are user-correctable; anything thrown as a
 * Response (the 404s) keeps bubbling.
 */
async function asCommentResult(run: () => unknown) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

function saveNoteIntent({ formData, personId, lessonId }: ActionContext) {
  const parsed = parseFormData(formData, saveNoteSchema);
  if (!parsed.success) {
    return { ok: false, error: parsed.errors.body };
  }
  const saved = saveNote(db, personId, lessonId, parsed.data.body, new Date());
  return saved.ok ? { ok: true } : saved;
}

function submitQuizIntent({ formData, personId, lessonId }: ActionContext) {
  const parsed = parseFormData(formData, submitQuizSchema);
  if (!parsed.success) {
    throw data("Invalid quiz ID", { status: 400 });
  }
  const { quizId } = parsed.data;
  // Scope the quiz to this lesson so a quiz elsewhere can't be reached by
  // posting its id to this route.
  if (!findLessonQuiz(lessonId, quizId)) {
    throw data("Quiz not found", { status: 404 });
  }
  const result = scoreQuizAttempt(
    personId,
    quizId,
    parseQuizAnswers(formData.entries())
  );
  if (!result) {
    throw data("Failed to score quiz", { status: 500 });
  }
  return { quizResult: result };
}

const INTENT_HANDLERS: Record<string, (context: ActionContext) => unknown> = {
  "create-comment": (context) =>
    asCommentResult(() => createCommentIntent(context)),
  "edit-comment": (context) =>
    asCommentResult(() => editCommentIntent(context)),
  "delete-comment": (context) =>
    asCommentResult(() => deleteCommentIntent(context)),
  "toggle-bookmark": ({ personId, lessonId }) => ({
    ok: true,
    bookmarked: toggleBookmark(db, personId, lessonId, new Date()),
  }),
  "save-note": saveNoteIntent,
  "mark-complete": ({ personId, lessonId }) => {
    markLessonComplete(personId, lessonId, new Date());
    return { success: true };
  },
  "submit-quiz": submitQuizIntent,
};

export async function action({ params, request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Every intent checks its own capability here — loader guards don't protect
  // actions. The ref includes the lesson, so a lesson from another course (or
  // a malformed id) is a 404.
  const capability =
    typeof intent === "string" ? INTENT_CAPABILITY[intent] : undefined;
  const handler =
    typeof intent === "string" ? INTENT_HANDLERS[intent] : undefined;
  if (!capability || !handler) {
    throw data("Invalid action", { status: 400 });
  }
  const ref = lessonRef(params);
  const { person } = await coursePermissions.requireCapability(
    request,
    capability,
    ref
  );

  return handler({
    formData,
    personId: person.id,
    lessonId: Number(params.lessonId),
    canModerate: () => {
      const decisions = coursePermissions.decide(person, ref);
      return decisions.found && decisions.manage.allowed;
    },
  });
}

export default function LessonViewer({ loaderData }: Route.ComponentProps) {
  if (loaderData.view === "locked") {
    return <LockedLesson data={loaderData} />;
  }
  return <FullLesson data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading this lesson.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Lesson not found";
      message =
        "The lesson you're looking for doesn't exist or may have been removed.";
    } else if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
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
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/dashboard">
            <Button>My Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
