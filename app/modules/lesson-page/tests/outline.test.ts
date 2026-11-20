import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "~/test/setup";

const holder = vi.hoisted(() => ({ db: null as TestDb | null }));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));

import { getInstructorName, getLessonOutline } from "../index.server";
import { freshDb, seedCourse } from "./fixtures";

let course: ReturnType<typeof seedCourse>;

beforeEach(() => {
  course = seedCourse(freshDb(holder));
});

describe("getLessonOutline", () => {
  it("lists Modules and their Lessons in position order", () => {
    const outline = getLessonOutline(course.course.id, course.setup.id);
    expect(outline?.curriculum).toEqual([
      {
        id: course.basics.id,
        title: "Basics",
        lessons: [
          { id: course.intro.id, title: "Intro" },
          { id: course.setup.id, title: "Setup" },
        ],
      },
      {
        id: course.deeper.id,
        title: "Deeper",
        lessons: [{ id: course.generics.id, title: "Generics" }],
      },
    ]);
  });

  it("names the Course, the Lesson and its Module", () => {
    const outline = getLessonOutline(course.course.id, course.setup.id);
    expect(outline?.course).toEqual({
      id: course.course.id,
      title: "Test Course",
      slug: "test-course",
    });
    expect(outline?.module).toEqual({ id: course.basics.id, title: "Basics" });
    expect(outline?.lesson.title).toBe("Setup");
  });

  it("links the Lessons either side, across Modules", () => {
    const outline = getLessonOutline(course.course.id, course.setup.id);
    expect(outline?.prevLesson).toEqual({
      id: course.intro.id,
      title: "Intro",
      moduleId: course.basics.id,
      moduleTitle: "Basics",
    });
    expect(outline?.nextLesson).toEqual({
      id: course.generics.id,
      title: "Generics",
      moduleId: course.deeper.id,
      moduleTitle: "Deeper",
    });
  });

  it("has no previous Lesson at the start or next Lesson at the end", () => {
    expect(
      getLessonOutline(course.course.id, course.intro.id)?.prevLesson
    ).toBeNull();
    expect(
      getLessonOutline(course.course.id, course.generics.id)?.nextLesson
    ).toBeNull();
  });

  it("is undefined for a Lesson or Course that does not exist", () => {
    expect(getLessonOutline(course.course.id, 9999)).toBeUndefined();
    expect(getLessonOutline(9999, course.intro.id)).toBeUndefined();
  });
});

describe("getInstructorName", () => {
  it("names the Instructor", () => {
    expect(getInstructorName(course.instructor.id)).toBe("Test Instructor");
  });

  it("falls back when the Instructor is gone", () => {
    expect(getInstructorName(9999)).toBe("your instructor");
  });
});
