import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "~/test/setup";

const holder = vi.hoisted(() => ({ db: null as TestDb | null }));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));

import {
  findLessonQuiz,
  getLessonQuiz,
  parseQuizAnswers,
  scoreQuizAttempt,
} from "../index.server";
import { freshDb, seedCourse, seedQuiz } from "./fixtures";

let course: ReturnType<typeof seedCourse>;
let seeded: ReturnType<typeof seedQuiz>;

beforeEach(() => {
  course = seedCourse(freshDb(holder));
  seeded = seedQuiz(
    holder.db as NonNullable<typeof holder.db>,
    course.setup.id
  );
});

/** Picks option `pick[i]` (0 is right, 1 is wrong) for question i; undefined skips it. */
function answers(...pick: Array<0 | 1 | undefined>) {
  const selected: Record<number, number> = {};
  seeded.questions.forEach((question, i) => {
    const choice = pick[i];
    if (choice !== undefined)
      selected[question.id] = question.options[choice].id;
  });
  return selected;
}

describe("getLessonQuiz", () => {
  it("has no quiz on a Lesson without one", () => {
    expect(getLessonQuiz(course.intro.id, course.user.id)).toEqual({
      quiz: null,
      bestAttempt: null,
    });
  });

  it("sends the questions without saying which option is right", () => {
    const { quiz } = getLessonQuiz(course.setup.id, null);
    expect(quiz?.questions).toHaveLength(3);
    expect(quiz?.questions[0]).toEqual({
      id: seeded.questions[0].id,
      questionText: "Question 1",
      questionType: "multiple_choice",
      position: 1,
      options: seeded.questions[0].options.map((o) => ({
        id: o.id,
        optionText: o.optionText,
      })),
    });
  });

  it("reports the Student's best attempt, and none for a visitor", () => {
    scoreQuizAttempt(course.user.id, seeded.quiz.id, answers(0, 1, 1));
    scoreQuizAttempt(course.user.id, seeded.quiz.id, answers(0, 0, 1));
    const best = getLessonQuiz(course.setup.id, course.user.id).bestAttempt;
    expect(best?.score).toBeCloseTo(2 / 3);
    expect(best?.passed).toBe(false);
    expect(getLessonQuiz(course.setup.id, null).bestAttempt).toBeNull();
  });
});

describe("scoreQuizAttempt", () => {
  it("passes a fully correct attempt with an A", () => {
    const result = scoreQuizAttempt(
      course.user.id,
      seeded.quiz.id,
      answers(0, 0, 0)
    );
    expect(result).toMatchObject({
      score: 1,
      passed: true,
      grade: "A",
      totalCorrect: 3,
      totalQuestions: 3,
    });
  });

  it("marks a skipped question wrong, with no option to show", () => {
    const result = scoreQuizAttempt(
      course.user.id,
      seeded.quiz.id,
      answers(0, 1)
    );
    expect(result?.totalCorrect).toBe(1);
    expect(result?.passed).toBe(false);
    expect(result?.grade).toBe("F");
    expect(result?.questionResults[1]).toEqual({
      questionId: seeded.questions[1].id,
      correct: false,
      selectedOptionId: seeded.questions[1].options[1].id,
      correctOptionId: seeded.questions[1].options[0].id,
    });
    expect(result?.questionResults[2]).toEqual({
      questionId: seeded.questions[2].id,
      correct: false,
      selectedOptionId: null,
      correctOptionId: null,
    });
  });

  it("does not score a quiz that does not exist", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(scoreQuizAttempt(course.user.id, 9999, {})).toBeNull();
  });
});

describe("findLessonQuiz", () => {
  it("finds the Lesson's quiz and not another Lesson's", () => {
    expect(findLessonQuiz(course.setup.id, seeded.quiz.id)?.id).toBe(
      seeded.quiz.id
    );
    expect(findLessonQuiz(course.intro.id, seeded.quiz.id)).toBeUndefined();
  });
});

describe("parseQuizAnswers", () => {
  it("reads question fields and ignores the rest", () => {
    const form = new FormData();
    form.set("intent", "submit-quiz");
    form.set("quizId", "4");
    form.set("question-7", "21");
    form.set("question-8", "not-a-number");
    expect(parseQuizAnswers(form.entries())).toEqual({ 7: 21 });
  });
});
