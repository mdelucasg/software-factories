import { useFetcher } from "react-router";
import { LessonDiscussion } from "~/components/lesson-discussion";
import { CommentThread } from "~/components/comment-thread";
import type { Route } from "../../routes/+types/courses.$slug.lessons.$lessonId";
import { CurriculumSidebar } from "./curriculum-sidebar";
import { LessonBreadcrumb } from "./lesson-breadcrumb";
import { LessonBody } from "./lesson-body";
import { LessonCompletion } from "./lesson-completion";
import { LessonHeader } from "./lesson-header";
import { LessonPager } from "./lesson-pager";
import { QuizSection } from "./quiz-section";

export type LessonLoaderData = Route.ComponentProps["loaderData"];

type FullLessonData = Extract<LessonLoaderData, { view: "full" }>;

export function FullLesson({ data }: { data: FullLessonData }) {
  const { course, lesson, currentUserId, enrolled } = data;
  const canTake = enrolled && !!currentUserId;

  return (
    <div className="flex">
      {/* Curriculum Sidebar */}
      <CurriculumSidebar
        course={course}
        curriculum={data.curriculum}
        currentLessonId={lesson.id}
        lessonProgressMap={data.lessonProgressMap}
        enrolled={enrolled}
      />

      <div className="flex-1 p-6 lg:p-8">
        <LessonBreadcrumb
          course={course}
          mod={data.module}
          lessonTitle={lesson.title}
        />

        <div className="mx-auto max-w-4xl">
          <LessonHeader
            lesson={lesson}
            showBookmark={!!currentUserId}
            bookmarked={data.bookmarked}
          />

          <LessonBody
            lesson={lesson}
            contentHtml={data.contentHtml}
            video={{
              lastWatchPosition: data.lastWatchPosition,
              watchProgress: data.watchProgress,
              trackingEnabled: canTake,
            }}
          />

          {canTake && <LessonActivity data={data} />}

          <LessonConversation data={data} />

          <LessonPager
            course={course}
            prevLesson={data.prevLesson}
            nextLesson={data.nextLesson}
          />
        </div>
      </div>
    </div>
  );
}

/** The quiz, then Mark Complete / Up Next: only for someone taking the course. */
function LessonActivity({ data }: { data: FullLessonData }) {
  const quizFetcher = useFetcher({ key: `quiz-${data.lesson.id}` });
  const quizResult = quizFetcher.data?.quizResult ?? null;
  const isSubmittingQuiz = quizFetcher.state !== "idle";

  return (
    <>
      {/* Quiz Section */}
      {data.quiz && (
        <QuizSection
          quiz={data.quiz}
          bestAttempt={data.bestAttempt}
          quizResult={quizResult}
          quizFetcher={quizFetcher}
          isSubmitting={isSubmittingQuiz}
        />
      )}

      {/* Mark Complete / Up Next */}
      <LessonCompletion
        lessonId={data.lesson.id}
        lessonStatus={data.lessonStatus}
        courseSlug={data.course.slug}
        nextLesson={data.nextLesson}
      />
    </>
  );
}

function LessonConversation({ data }: { data: FullLessonData }) {
  const { comments, currentUserId, canModerate, instructorName } = data;

  // Questions & Discussion and the Note — confidential to people with access
  return currentUserId ? (
    <LessonDiscussion
      lessonId={data.lesson.id}
      note={data.note}
      comments={comments}
      currentUserId={currentUserId}
      canModerate={canModerate}
      instructorName={instructorName}
    />
  ) : (
    <CommentThread
      comments={comments}
      currentUserId={currentUserId}
      canModerate={canModerate}
      canPost
      instructorName={instructorName}
    />
  );
}
