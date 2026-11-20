import { db } from "~/db";
import {
  quizzes,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
} from "~/db/schema";
import { and, desc, eq } from "drizzle-orm";

export function getQuizByLessonId(lessonId: number) {
  return db.select().from(quizzes).where(eq(quizzes.lessonId, lessonId)).get();
}

export function getQuizWithQuestions(quizId: number) {
  const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
  if (!quiz) return null;

  const questions = db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();

  const questionsWithOptions = questions.map((question) => {
    const options = db
      .select()
      .from(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .all();
    return { ...question, options };
  });

  return { ...quiz, questions: questionsWithOptions };
}

export function getBestAttempt(userId: number, quizId: number) {
  return db
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.score))
    .limit(1)
    .get();
}

export function calculateGrade(score: number): string {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

export type QuestionResult = {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null;
  correctOptionId: number | null;
};

function correctOptionFor(question: { id: number; questionType: string }) {
  if (
    question.questionType !== "multiple_choice" &&
    question.questionType !== "true_false"
  ) {
    return null;
  }
  const correctOpt = db
    .select()
    .from(quizOptions)
    .where(
      and(
        eq(quizOptions.questionId, question.id),
        eq(quizOptions.isCorrect, true)
      )
    )
    .get();
  return correctOpt ? correctOpt.id : null;
}

function markQuestions(
  quizId: number,
  selectedAnswers: Record<number, number>
): QuestionResult[] {
  const questions = db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();

  return questions.map((q) => {
    const selected = selectedAnswers[q.id];
    if (!selected) {
      return {
        questionId: q.id,
        correct: false,
        selectedOptionId: null,
        correctOptionId: null,
      };
    }
    const correctOptionId = correctOptionFor(q);
    return {
      questionId: q.id,
      correct: selected === correctOptionId,
      selectedOptionId: selected,
      correctOptionId,
    };
  });
}

function recordAttempt(
  userId: number,
  quizId: number,
  result: { score: number; passed: boolean; questionResults: QuestionResult[] }
) {
  const attempt = db
    .insert(quizAttempts)
    .values({ userId, quizId, score: result.score, passed: result.passed })
    .returning()
    .get();

  for (const answer of result.questionResults) {
    if (answer.selectedOptionId !== null) {
      db.insert(quizAnswers)
        .values({
          attemptId: attempt.id,
          questionId: answer.questionId,
          selectedOptionId: answer.selectedOptionId,
        })
        .run();
    }
  }
  return attempt;
}

export function computeResult(
  userId: number,
  quizId: number,
  selectedAnswers: Record<number, number>
) {
  try {
    const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
    if (!quiz) {
      console.error("quiz not found");
      return null;
    }

    const questionResults = markQuestions(quizId, selectedAnswers);
    const correct = questionResults.filter((r) => r.correct).length;
    const total = questionResults.length;
    const score = total > 0 ? correct / total : 0;
    const passed = score > 0.7;
    const attempt = recordAttempt(userId, quizId, {
      score,
      passed,
      questionResults,
    });

    return {
      attemptId: attempt.id,
      score,
      passed,
      grade: calculateGrade(score),
      totalCorrect: correct,
      totalQuestions: total,
      questionResults,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}

export type LessonQuiz = {
  id: number;
  title: string;
  passingScore: number;
  questions: Array<{
    id: number;
    questionText: string;
    questionType: string;
    position: number;
    options: Array<{ id: number; optionText: string }>;
  }>;
};

function withoutAnswers(
  quizData: NonNullable<ReturnType<typeof getQuizWithQuestions>>
): LessonQuiz {
  // Strip isCorrect from options so answers aren't leaked to the client
  return {
    id: quizData.id,
    title: quizData.title,
    passingScore: quizData.passingScore,
    questions: quizData.questions.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      position: q.position,
      options: q.options.map((o) => ({ id: o.id, optionText: o.optionText })),
    })),
  };
}

/** The Lesson's quiz without its answers, and the Student's best attempt at it. */
export function getLessonQuiz(lessonId: number, studentId: number | null) {
  const quizRecord = getQuizByLessonId(lessonId);
  if (!quizRecord) return { quiz: null, bestAttempt: null };

  const quizData = getQuizWithQuestions(quizRecord.id);
  const best =
    studentId === null ? undefined : getBestAttempt(studentId, quizRecord.id);
  return {
    quiz: quizData ? withoutAnswers(quizData) : null,
    bestAttempt: best ? { score: best.score, passed: best.passed } : null,
  };
}

/** The quiz with this id, only if it belongs to the Lesson. */
export function findLessonQuiz(lessonId: number, quizId: number) {
  const quiz = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get();
  return quiz && quiz.lessonId === lessonId ? quiz : undefined;
}

/** Answers posted as fields named "question-{questionId}" with an option id. */
export function parseQuizAnswers(
  entries: Iterable<[string, FormDataEntryValue]>
): Record<number, number> {
  const selectedAnswers: Record<number, number> = {};
  for (const [key, value] of entries) {
    if (!key.startsWith("question-")) continue;
    const questionId = Number(key.replace("question-", ""));
    const optionId = Number(value);
    if (!isNaN(questionId) && !isNaN(optionId)) {
      selectedAnswers[questionId] = optionId;
    }
  }
  return selectedAnswers;
}
