import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "~/test/setup";

const holder = vi.hoisted(() => ({ db: null as TestDb | null }));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));

import * as schema from "~/db/schema";
import { LessonProgressStatus } from "~/db/schema";
import { markLessonComplete, openLessonForStudent } from "../index.server";
import { freshDb, seedCourse } from "./fixtures";

let course: ReturnType<typeof seedCourse>;

beforeEach(() => {
  course = seedCourse(freshDb(holder));
});

function open(studentId: number | null, canTake = true, lesson = course.setup) {
  return openLessonForStudent({
    studentId,
    canTake,
    courseId: course.course.id,
    lesson,
  });
}

const NONE = {
  lessonStatus: null,
  lastWatchPosition: 0,
  watchProgress: 0,
  lessonProgressMap: {},
};

describe("openLessonForStudent", () => {
  it("records nothing for a visitor", () => {
    expect(open(null)).toEqual(NONE);
  });

  it("records nothing for someone who cannot take the Course", () => {
    expect(open(course.user.id, false)).toEqual(NONE);
    expect(open(course.user.id).lessonProgressMap).toEqual({
      [course.setup.id]: LessonProgressStatus.InProgress,
    });
  });

  it("marks the Lesson in progress on first open", () => {
    const progress = open(course.user.id);
    expect(progress.lessonStatus).toBe(LessonProgressStatus.InProgress);
    expect(progress.lessonProgressMap).toEqual({
      [course.setup.id]: LessonProgressStatus.InProgress,
    });
  });

  it("keeps a completed Lesson completed when it is opened again", () => {
    open(course.user.id);
    markLessonComplete(course.user.id, course.setup.id);
    const progress = open(course.user.id);
    expect(progress.lessonStatus).toBe(LessonProgressStatus.Completed);
  });

  it("maps progress across the whole Course", () => {
    open(course.user.id, true, course.intro);
    markLessonComplete(course.user.id, course.intro.id);
    const progress = open(course.user.id, true, course.generics);
    expect(progress.lessonProgressMap).toEqual({
      [course.intro.id]: LessonProgressStatus.Completed,
      [course.generics.id]: LessonProgressStatus.InProgress,
    });
  });

  it("starts an unwatched video at the beginning", () => {
    const progress = open(course.user.id, true, course.intro);
    expect(progress.lastWatchPosition).toBe(0);
    expect(progress.watchProgress).toBe(0);
  });

  it("resumes a video where the Student last was, and shows how far they got", () => {
    const watch = (positionSeconds: number, minute: number) =>
      holder.db
        ?.insert(schema.videoWatchEvents)
        .values({
          userId: course.user.id,
          lessonId: course.intro.id,
          eventType: "progress",
          positionSeconds,
          createdAt: new Date(2026, 9, 6, 12, minute).toISOString(),
        })
        .run();
    watch(240, 1);
    watch(90, 2);

    const lesson = { ...course.intro, durationMinutes: 8 };
    const progress = open(course.user.id, true, lesson);
    expect(progress.lastWatchPosition).toBe(90);
    expect(progress.watchProgress).toBe(50);
  });

  it("caps watch progress at 100 and skips it without a duration", () => {
    holder.db
      ?.insert(schema.videoWatchEvents)
      .values({
        userId: course.user.id,
        lessonId: course.intro.id,
        eventType: "progress",
        positionSeconds: 900,
      })
      .run();
    expect(
      open(course.user.id, true, { ...course.intro, durationMinutes: 10 })
        .watchProgress
    ).toBe(100);
    expect(
      open(course.user.id, true, { ...course.intro, durationMinutes: null })
    ).toMatchObject({ lastWatchPosition: 900, watchProgress: 0 });
  });

  it("does not track a video on a Lesson without one", () => {
    holder.db
      ?.insert(schema.videoWatchEvents)
      .values({
        userId: course.user.id,
        lessonId: course.setup.id,
        eventType: "progress",
        positionSeconds: 60,
      })
      .run();
    const progress = open(course.user.id, true, {
      ...course.setup,
      durationMinutes: 5,
    });
    expect(progress.lastWatchPosition).toBe(0);
    expect(progress.watchProgress).toBe(0);
  });
});
