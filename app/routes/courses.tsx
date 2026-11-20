import { Form, Link, useNavigation, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/courses";
import { db } from "~/db";
import {
  courses as coursesTable,
  categories as categoriesTable,
  users,
  modules,
  lessons,
  enrollments as enrollmentsTable,
  lessonProgress,
  courseRatings,
  CourseStatus,
  LessonProgressStatus,
} from "~/db/schema";
import { eq, like, and, or, sql, inArray } from "drizzle-orm";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { AlertTriangle, Search } from "lucide-react";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { calculatePppPrice } from "~/lib/ppp";
import { CourseCard, CourseCardSkeleton } from "~/components/course-card";
import {
  CatalogEmptyState,
  CatalogHeader,
  CatalogSummary,
  CategoryChips,
} from "~/components/course-catalog";
import { describeCatalog } from "~/modules/course-catalog";

function buildCourseQuery(
  search: string | null,
  category: string | null,
  status: CourseStatus | null,
  sortBy: string | null,
  limit: number,
  offset: number
) {
  const conditions = [];

  if (status) {
    conditions.push(eq(coursesTable.status, status));
  }

  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(like(coursesTable.title, term), like(coursesTable.description, term))
    );
  }

  const query = db
    .select({
      id: coursesTable.id,
      title: coursesTable.title,
      slug: coursesTable.slug,
      description: coursesTable.description,
      salesCopy: coursesTable.salesCopy,
      instructorId: coursesTable.instructorId,
      categoryId: coursesTable.categoryId,
      status: coursesTable.status,
      coverImageUrl: coursesTable.coverImageUrl,
      price: coursesTable.price,
      pppEnabled: coursesTable.pppEnabled,
      createdAt: coursesTable.createdAt,
      updatedAt: coursesTable.updatedAt,
      instructorName: users.name,
      instructorAvatarUrl: users.avatarUrl,
      categoryName: categoriesTable.name,
    })
    .from(coursesTable)
    .innerJoin(users, eq(coursesTable.instructorId, users.id))
    .innerJoin(
      categoriesTable,
      eq(coursesTable.categoryId, categoriesTable.id)
    );

  if (category) {
    conditions.push(eq(categoriesTable.slug, category));
  }

  const filtered =
    conditions.length > 0 ? query.where(and(...conditions)) : query;

  const sorted =
    sortBy === "title"
      ? filtered.orderBy(coursesTable.title)
      : sortBy === "oldest"
        ? filtered.orderBy(coursesTable.createdAt)
        : filtered.orderBy(sql`${coursesTable.createdAt} DESC`);

  return sorted.limit(limit).offset(offset).all();
}

function getLessonCountForCourse(courseId: number) {
  const courseModules = db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.courseId, courseId))
    .all();

  if (courseModules.length === 0) return 0;

  const count = db
    .select({ count: sql<number>`count(*)` })
    .from(lessons)
    .where(or(...courseModules.map((m) => eq(lessons.moduleId, m.id))))
    .get();

  return count?.count ?? 0;
}

function getAllCategories() {
  return db.select().from(categoriesTable).orderBy(categoriesTable.name).all();
}

function getUserEnrolledCourses(userId: number) {
  return db
    .select({
      enrollmentId: enrollmentsTable.id,
      courseId: enrollmentsTable.courseId,
      enrolledAt: enrollmentsTable.enrolledAt,
      completedAt: enrollmentsTable.completedAt,
      courseTitle: coursesTable.title,
      courseSlug: coursesTable.slug,
      courseDescription: coursesTable.description,
      coverImageUrl: coursesTable.coverImageUrl,
    })
    .from(enrollmentsTable)
    .innerJoin(coursesTable, eq(enrollmentsTable.courseId, coursesTable.id))
    .where(eq(enrollmentsTable.userId, userId))
    .all();
}

function getCourseLessonIds(courseId: number): number[] {
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

  return courseLessons.map((l) => l.id);
}

function calculateProgress(
  userId: number,
  courseId: number,
  weightByDuration: boolean
) {
  const lessonIds = getCourseLessonIds(courseId);

  if (lessonIds.length === 0) return 0;

  if (weightByDuration) {
    const courseLessons = db
      .select({
        id: lessons.id,
        durationMinutes: lessons.durationMinutes,
      })
      .from(lessons)
      .where(or(...lessonIds.map((id) => eq(lessons.id, id))))
      .all();

    const totalDuration = courseLessons.reduce(
      (sum, l) => sum + (l.durationMinutes ?? 1),
      0
    );

    if (totalDuration === 0) return 0;

    const completed = db
      .select()
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))
        )
      )
      .all();

    const completedIds = new Set(completed.map((p) => p.lessonId));

    const completedDuration = courseLessons
      .filter((l) => completedIds.has(l.id))
      .reduce((sum, l) => sum + (l.durationMinutes ?? 1), 0);

    return Math.round((completedDuration / totalDuration) * 100);
  }

  const completedCount = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))
      )
    )
    .get();

  return Math.round(((completedCount?.count ?? 0) / lessonIds.length) * 100);
}

function getCompletedLessonCount(userId: number, courseId: number) {
  const lessonIds = getCourseLessonIds(courseId);
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        or(...lessonIds.map((id) => eq(lessonProgress.lessonId, id)))
      )
    )
    .get();

  return result?.count ?? 0;
}

type CourseRatingSummary = {
  average: number | null;
  count: number;
};

const EMPTY_SUMMARY: CourseRatingSummary = { average: null, count: 0 };

function getCourseRatingSummaries(
  courseIds: number[]
): Map<number, CourseRatingSummary> {
  const summaries = new Map<number, CourseRatingSummary>();

  if (courseIds.length === 0) return summaries;

  const rows = db
    .select({
      courseId: courseRatings.courseId,
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(inArray(courseRatings.courseId, courseIds))
    .groupBy(courseRatings.courseId)
    .all();

  for (const row of rows) {
    summaries.set(row.courseId, {
      average: row.average === null ? null : Math.round(row.average * 10) / 10,
      count: row.count,
    });
  }

  for (const courseId of courseIds) {
    if (!summaries.has(courseId)) {
      summaries.set(courseId, EMPTY_SUMMARY);
    }
  }

  return summaries;
}

export function meta() {
  return [
    { title: "Browse Courses — Cadence" },
    { name: "description", content: "Browse all available courses" },
  ];
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const search = url.searchParams.get("q");
  const category = url.searchParams.get("category");

  const courses = buildCourseQuery(
    search,
    category,
    CourseStatus.Published,
    "newest",
    50,
    0
  );

  const currentUserId = await getCurrentUserId(request);
  const country = await resolveCountry(request);

  // Build a map of courseId -> progress for enrolled courses
  const progressMap = new Map<
    number,
    { progress: number; completedLessons: number }
  >();
  if (currentUserId) {
    const enrollments = getUserEnrolledCourses(currentUserId);
    for (const enrollment of enrollments) {
      progressMap.set(enrollment.courseId, {
        progress: calculateProgress(currentUserId, enrollment.courseId, false),
        completedLessons: getCompletedLessonCount(
          currentUserId,
          enrollment.courseId
        ),
      });
    }
  }

  const ratingSummaries = getCourseRatingSummaries(courses.map((c) => c.id));

  const coursesWithLessonCount = courses.map((course) => {
    const userProgress = progressMap.get(course.id);
    const pppPrice = course.pppEnabled
      ? calculatePppPrice(course.price, country)
      : course.price;
    const rating = ratingSummaries.get(course.id);
    return {
      ...course,
      lessonCount: getLessonCountForCourse(course.id),
      progress: userProgress?.progress ?? null,
      completedLessons: userProgress?.completedLessons ?? null,
      pppPrice,
      ratingAverage: rating?.average ?? null,
      ratingCount: rating?.count ?? 0,
    };
  });

  const categories = getAllCategories();

  return {
    courses: coursesWithLessonCount,
    categories,
    search,
    category,
    currentUserId,
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <div className="mb-8 border-b pb-8">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-10 w-72" />
        <Skeleton className="mt-3 h-5 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex flex-col gap-4 sm:flex-row">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-20" />
      </div>
      <div className="mb-8 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- placeholders never reorder
          <Skeleton key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- placeholders never reorder
          <CourseCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function CourseCatalog({ loaderData }: Route.ComponentProps) {
  const { courses, categories, search, category, currentUserId } = loaderData;
  const navigation = useNavigation();
  const isSearching =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/courses";
  const catalog = describeCatalog({
    courseCount: courses.length,
    categories,
    filters: { search, category },
  });

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <CatalogHeader />

      <Form method="get" className="mb-4 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            name="q"
            key={search ?? ""}
            defaultValue={search ?? ""}
            placeholder="Search courses..."
            className="h-10 w-full rounded-md border border-input bg-background pl-10 pr-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {category && <input type="hidden" name="category" value={category} />}
        <Button type="submit" className="h-10">
          Search
        </Button>
      </Form>

      <CategoryChips links={catalog.categoryLinks} />
      <CatalogSummary
        summary={catalog.summary}
        isFiltered={catalog.isFiltered}
        clearHref={catalog.clearHref}
      />

      {/* Course Grid */}
      {isSearching ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- placeholders never reorder
            <CourseCardSkeleton key={i} />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <CatalogEmptyState
          isFiltered={catalog.isFiltered}
          clearHref={catalog.clearHref}
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading courses.";

  if (isRouteErrorResponse(error)) {
    title = `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
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
