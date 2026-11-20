import * as schema from "~/db/schema";
import { createComment, deleteComment } from "~/lib/comments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";

/**
 * The module reads the app's `~/db`. Each test file mocks it with a getter
 * onto `testDbHolder.db`, so every test gets a fresh database.
 */
export function freshDb(holder: { db: TestDb | null }) {
  const db = createTestDb();
  holder.db = db;
  return db;
}

function addLesson(
  db: TestDb,
  moduleId: number,
  lesson: { title: string; position: number; videoUrl?: string }
) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, ...lesson })
    .returning()
    .get();
}

function addModule(
  db: TestDb,
  module: { courseId: number; title: string; position: number }
) {
  return db.insert(schema.modules).values(module).returning().get();
}

/**
 * A Course with two Modules, inserted out of position order so a test can see
 * the outline sort them: "Basics" (Intro, Setup) then "Deeper" (Generics).
 */
export function seedCourse(db: TestDb) {
  const base = seedBaseData(db);
  const deeper = addModule(db, {
    courseId: base.course.id,
    title: "Deeper",
    position: 2,
  });
  const basics = addModule(db, {
    courseId: base.course.id,
    title: "Basics",
    position: 1,
  });
  const generics = addLesson(db, deeper.id, { title: "Generics", position: 1 });
  const setup = addLesson(db, basics.id, { title: "Setup", position: 2 });
  const intro = addLesson(db, basics.id, {
    title: "Intro",
    position: 1,
    videoUrl: "https://www.youtube.com/watch?v=abc",
  });
  return { ...base, basics, deeper, intro, setup, generics };
}

function addQuestion(
  db: TestDb,
  quizId: number,
  question: {
    text: string;
    position: number;
    type: schema.QuestionType;
    options: [string, boolean][];
  }
) {
  const row = db
    .insert(schema.quizQuestions)
    .values({
      quizId,
      questionText: question.text,
      questionType: question.type,
      position: question.position,
    })
    .returning()
    .get();
  const options = question.options.map(([optionText, isCorrect]) =>
    db
      .insert(schema.quizOptions)
      .values({ questionId: row.id, optionText, isCorrect })
      .returning()
      .get()
  );
  return { ...row, options };
}

/**
 * A quiz of `count` questions (three unless asked), alternating multiple
 * choice and true/false; option 0 of each question is the right one.
 */
export function seedQuiz(db: TestDb, lessonId: number, count = 3) {
  const quiz = db
    .insert(schema.quizzes)
    .values({ lessonId, title: "Check", passingScore: 0.7 })
    .returning()
    .get();
  const positions = Array.from({ length: count }, (_, i) => i + 1);
  const questions = positions.map((position) =>
    addQuestion(db, quiz.id, {
      text: `Question ${position}`,
      position,
      type:
        position % 2 === 1
          ? schema.QuestionType.MultipleChoice
          : schema.QuestionType.TrueFalse,
      options: [
        ["Right", true],
        ["Wrong", false],
      ],
    })
  );
  return { quiz, questions };
}

/** Posts a Discussion Question, or a Discussion Reply under `parentId`. */
export async function addComment(
  db: TestDb,
  comment: { lessonId: number; userId: number; body: string; parentId?: number }
) {
  const result = await createComment(
    db,
    comment.userId,
    comment.lessonId,
    comment.parentId ?? null,
    comment.body,
    new Date(2026, 9, 6),
    fakeNotifications()
  );
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

/** Soft-deletes a comment, as a moderator would. */
export async function removeComment(db: TestDb, commentId: number) {
  const result = await deleteComment(
    db,
    commentId,
    0,
    true,
    new Date(2026, 9, 7),
    fakeNotifications()
  );
  if (!result.ok) throw new Error(result.error);
}
