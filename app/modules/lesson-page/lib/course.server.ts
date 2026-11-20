import { db } from "~/db";
import { courses, lessons, modules, users } from "~/db/schema";
import { eq, inArray } from "drizzle-orm";

type Lesson = typeof lessons.$inferSelect;

function getCourseModules(courseId: number) {
  const courseModules = db
    .select()
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .orderBy(modules.position)
    .all();

  const moduleIds = courseModules.map((m) => m.id);
  const courseLessons =
    moduleIds.length > 0
      ? db
          .select()
          .from(lessons)
          .where(inArray(lessons.moduleId, moduleIds))
          .orderBy(lessons.position)
          .all()
      : [];

  return courseModules.map((mod) => ({
    ...mod,
    lessons: courseLessons.filter((l) => l.moduleId === mod.id),
  }));
}

export type FlatLesson = {
  id: number;
  title: string;
  moduleId: number;
  moduleTitle: string;
};

function flattenCourseLessons(
  courseModules: Array<{ id: number; title: string; lessons: Lesson[] }>
): FlatLesson[] {
  return courseModules.flatMap((mod) =>
    mod.lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      moduleId: mod.id,
      moduleTitle: mod.title,
    }))
  );
}

function neighbours(
  courseModules: Parameters<typeof flattenCourseLessons>[0],
  lessonId: number
) {
  const allLessons = flattenCourseLessons(courseModules);
  const currentIndex = allLessons.findIndex((l) => l.id === lessonId);
  return {
    prevLesson: currentIndex > 0 ? allLessons[currentIndex - 1] : null,
    nextLesson:
      currentIndex < allLessons.length - 1
        ? allLessons[currentIndex + 1]
        : null,
  };
}

/**
 * The Lesson, its Module, the Course outline and the Lessons either side.
 * Undefined when the Lesson or Course does not exist, or the Lesson is not in
 * the Course.
 */
export function getLessonOutline(courseId: number, lessonId: number) {
  const course = db
    .select({ id: courses.id, title: courses.title, slug: courses.slug })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const lesson = db
    .select()
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  const mod = lesson
    ? db.select().from(modules).where(eq(modules.id, lesson.moduleId)).get()
    : undefined;
  if (!course || !lesson || !mod) return undefined;

  const courseModules = getCourseModules(courseId);
  return {
    course,
    curriculum: courseModules.map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({ id: l.id, title: l.title })),
    })),
    module: { id: mod.id, title: mod.title },
    lesson,
    ...neighbours(courseModules, lessonId),
  };
}

export function getInstructorName(instructorId: number): string {
  const instructor = db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, instructorId))
    .get();
  return instructor?.name ?? "your instructor";
}

export function getCourseForLesson(lessonId: number) {
  return db
    .select({ instructorId: courses.instructorId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}
