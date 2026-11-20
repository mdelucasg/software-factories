import { db } from "~/db";
import {
  lessonProgress,
  lessons,
  modules,
  videoWatchEvents,
  LessonProgressStatus,
} from "~/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";

function getLessonProgress(userId: number, lessonId: number) {
  return db
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.lessonId, lessonId)
      )
    )
    .get();
}

function getLessonProgressForCourse(userId: number, courseId: number) {
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  if (courseModules.length === 0) return [];

  const courseLessons = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id))))
    .all();

  if (courseLessons.length === 0) return [];

  return db
    .select()
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        or(...courseLessons.map((l) => eq(lessonProgress.lessonId, l.id)))
      )
    )
    .all();
}

export function markLessonComplete(
  userId: number,
  lessonId: number,
  now: Date
) {
  const existing = getLessonProgress(userId, lessonId);

  if (existing) {
    return db
      .update(lessonProgress)
      .set({
        status: LessonProgressStatus.Completed,
        completedAt: now.toISOString(),
      })
      .where(eq(lessonProgress.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(lessonProgress)
    .values({
      userId,
      lessonId,
      status: LessonProgressStatus.Completed,
      completedAt: now.toISOString(),
    })
    .returning()
    .get();
}

function markLessonInProgress(userId: number, lessonId: number) {
  const existing = getLessonProgress(userId, lessonId);

  if (existing) {
    if (existing.status === LessonProgressStatus.Completed) {
      return existing;
    }
    return db
      .update(lessonProgress)
      .set({ status: LessonProgressStatus.InProgress })
      .where(eq(lessonProgress.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(lessonProgress)
    .values({
      userId,
      lessonId,
      status: LessonProgressStatus.InProgress,
    })
    .returning()
    .get();
}

function getLastWatchPosition(userId: number, lessonId: number) {
  const lastEvent = db
    .select()
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    )
    .orderBy(desc(videoWatchEvents.createdAt))
    .limit(1)
    .get();

  return lastEvent?.positionSeconds ?? 0;
}

function calculateWatchProgress(
  userId: number,
  lessonId: number,
  videoDurationSeconds: number
) {
  if (videoDurationSeconds <= 0) return 0;

  const result = db
    .select({ maxPos: sql<number>`max(${videoWatchEvents.positionSeconds})` })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        eq(videoWatchEvents.lessonId, lessonId)
      )
    )
    .get();

  const maxPosition = result?.maxPos ?? 0;

  return Math.min(Math.round((maxPosition / videoDurationSeconds) * 100), 100);
}

export type StudentLessonProgress = {
  lessonStatus: LessonProgressStatus | null;
  lastWatchPosition: number;
  watchProgress: number;
  lessonProgressMap: Record<number, LessonProgressStatus>;
};

const NO_PROGRESS: StudentLessonProgress = {
  lessonStatus: null,
  lastWatchPosition: 0,
  watchProgress: 0,
  lessonProgressMap: {},
};

function videoProgress(
  userId: number,
  lesson: {
    id: number;
    videoUrl: string | null;
    durationMinutes: number | null;
  }
) {
  if (!lesson.videoUrl) return { lastWatchPosition: 0, watchProgress: 0 };
  const lastWatchPosition = getLastWatchPosition(userId, lesson.id);
  const videoDurationSeconds = (lesson.durationMinutes ?? 0) * 60;
  const watchProgress =
    videoDurationSeconds > 0
      ? calculateWatchProgress(userId, lesson.id, videoDurationSeconds)
      : 0;
  return { lastWatchPosition, watchProgress };
}

/**
 * Marks the Lesson in progress for the Student and reads back where they are
 * in it and in the Course. Progress is recorded only for people who can take
 * the Course, so anyone else (a Student under a Country Lock, a visitor) gets
 * none.
 */
export function openLessonForStudent(input: {
  studentId: number | null;
  canTake: boolean;
  courseId: number;
  lesson: {
    id: number;
    videoUrl: string | null;
    durationMinutes: number | null;
  };
}): StudentLessonProgress {
  const { studentId, canTake, courseId, lesson } = input;
  if (studentId === null || !canTake) return NO_PROGRESS;

  markLessonInProgress(studentId, lesson.id);
  const lessonProgressMap: Record<number, LessonProgressStatus> = {};
  for (const record of getLessonProgressForCourse(studentId, courseId)) {
    lessonProgressMap[record.lessonId] = record.status;
  }
  return {
    lessonStatus: getLessonProgress(studentId, lesson.id)?.status ?? null,
    ...videoProgress(studentId, lesson),
    lessonProgressMap,
  };
}
