import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "~/test/setup";

const holder = vi.hoisted(() => ({ db: null as TestDb | null }));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));

import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { scoreQuizAttempt } from "../index.server";
import { freshDb, seedCourse, seedQuiz } from "./fixtures";

let db: TestDb;
let course: ReturnType<typeof seedCourse>;

beforeEach(() => {
  db = freshDb(holder);
  course = seedCourse(db);
});

/** Answers the first `right` questions correctly and the rest wrongly. */
function attempt(seeded: ReturnType<typeof seedQuiz>, right: number) {
  const selected: Record<number, number> = {};
  seeded.questions.forEach((question, i) => {
    selected[question.id] = question.options[i < right ? 0 : 1].id;
  });
  return scoreQuizAttempt(course.user.id, seeded.quiz.id, selected);
}

describe("grading an attempt out of ten", () => {
  it.each([
    [10, "A", true],
    [9, "A", true],
    [8, "B", true],
    [7, "C", false],
    [6, "D", false],
    [5, "F", false],
  ])("%i right is a %s, passed: %s", (right, grade, passed) => {
    const seeded = seedQuiz(db, course.setup.id, 10);
    const result = attempt(seeded, right);
    expect(result?.grade).toBe(grade);
    expect(result?.passed).toBe(passed);
    expect(result?.score).toBeCloseTo(right / 10);
  });
});

describe("recording an attempt", () => {
  it("marks true/false questions as well as multiple choice", () => {
    const seeded = seedQuiz(db, course.setup.id, 2);
    const result = attempt(seeded, 2);
    expect(result?.questionResults.map((r) => r.correct)).toEqual([true, true]);
  });

  it("stores the attempt and one answer per answered question", () => {
    const seeded = seedQuiz(db, course.setup.id, 3);
    const [first, second] = seeded.questions;
    const result = scoreQuizAttempt(course.user.id, seeded.quiz.id, {
      [first.id]: first.options[0].id,
      [second.id]: second.options[1].id,
    });

    const stored = db
      .select()
      .from(schema.quizAnswers)
      .where(eq(schema.quizAnswers.attemptId, result?.attemptId ?? -1))
      .all();
    expect(stored.map((a) => [a.questionId, a.selectedOptionId])).toEqual([
      [first.id, first.options[0].id],
      [second.id, second.options[1].id],
    ]);
    const attempt = db.select().from(schema.quizAttempts).get();
    expect(attempt).toMatchObject({ userId: course.user.id, passed: false });
  });

  it("scores a quiz with no questions as zero", () => {
    const seeded = seedQuiz(db, course.setup.id, 0);
    expect(scoreQuizAttempt(course.user.id, seeded.quiz.id, {})).toMatchObject({
      score: 0,
      passed: false,
      grade: "F",
      totalQuestions: 0,
    });
  });
});
