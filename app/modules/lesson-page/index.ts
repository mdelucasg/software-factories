/**
 * The shapes the Lesson page's quiz components render. Safe to import from
 * the browser; the queries behind them are in `./index.server`.
 */
export type {
  LessonQuiz,
  QuizQuestion,
  QuestionResult,
  QuizResult,
} from "./lib/quiz-types";
export type { CommentAuthor, RenderedComment } from "./lib/comment-types";
