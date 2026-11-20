import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestDb } from "~/test/setup";

const holder = vi.hoisted(() => ({ db: null as TestDb | null }));
vi.mock("~/db", () => ({
  get db() {
    return holder.db;
  },
}));

import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";
import { findLessonComment, getRenderedThread } from "../index.server";
import { addComment, freshDb, seedCourse } from "./fixtures";

let course: ReturnType<typeof seedCourse>;

beforeEach(() => {
  course = seedCourse(freshDb(holder));
});

function softDelete(commentId: number) {
  holder.db
    ?.update(schema.comments)
    .set({ deletedAt: new Date(2026, 9, 7).toISOString() })
    .where(eq(schema.comments.id, commentId))
    .run();
}

describe("getRenderedThread", () => {
  it("nests replies under their question and renders the bodies", async () => {
    const question = addComment(holder.db as NonNullable<typeof holder.db>, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "Is **this** right?",
    });
    addComment(holder.db as NonNullable<typeof holder.db>, {
      lessonId: course.setup.id,
      userId: course.instructor.id,
      body: "Yes",
      parentId: question.id,
    });

    const [thread] = await getRenderedThread(course.setup.id);
    expect(thread.bodyHtml).toContain("<strong>this</strong>");
    expect(thread.author.isInstructor).toBe(false);
    expect(thread.replies).toHaveLength(1);
    expect(thread.replies[0].author).toMatchObject({
      name: "Test Instructor",
      isInstructor: true,
    });
  });

  it("drops a deleted question once it has no replies", async () => {
    const question = addComment(holder.db as NonNullable<typeof holder.db>, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "Never mind",
    });
    softDelete(question.id);
    expect(await getRenderedThread(course.setup.id)).toEqual([]);
  });

  it("keeps a deleted question with replies, with its body blanked", async () => {
    const db = holder.db as NonNullable<typeof holder.db>;
    const question = addComment(db, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "Secret",
    });
    addComment(db, {
      lessonId: course.setup.id,
      userId: course.instructor.id,
      body: "Answer",
      parentId: question.id,
    });
    softDelete(question.id);

    const [thread] = await getRenderedThread(course.setup.id);
    expect(thread.deleted).toBe(true);
    expect(thread.bodyHtml).toBe("");
    expect(thread.replies).toHaveLength(1);
  });
});

describe("findLessonComment", () => {
  it("finds a comment on the Lesson and not one on another Lesson", () => {
    const comment = addComment(holder.db as NonNullable<typeof holder.db>, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "Hi",
    });
    expect(findLessonComment(course.setup.id, comment.id)?.id).toBe(comment.id);
    expect(findLessonComment(course.intro.id, comment.id)).toBeUndefined();
  });

  it("leaves out the Lesson's other threads' replies and keeps order", async () => {
    const db = holder.db as NonNullable<typeof holder.db>;
    const first = addComment(db, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "First",
    });
    addComment(db, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "Second",
    });
    const deletedReply = addComment(db, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "Gone",
      parentId: first.id,
    });
    softDelete(deletedReply.id);
    addComment(db, {
      lessonId: course.intro.id,
      userId: course.user.id,
      body: "Elsewhere",
    });

    const thread = await getRenderedThread(course.setup.id);
    expect(thread.map((c) => c.body)).toEqual(["First", "Second"]);
    expect(thread[0].replies).toEqual([]);
    expect(thread[0].editedAt).toBeNull();
  });

  it("flags a Platform Admin's comment", async () => {
    const db = holder.db as NonNullable<typeof holder.db>;
    const admin = db
      .insert(schema.users)
      .values({
        name: "Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    addComment(db, { lessonId: course.setup.id, userId: admin.id, body: "Hi" });
    addComment(db, {
      lessonId: course.setup.id,
      userId: course.user.id,
      body: "Yo",
    });

    const thread = await getRenderedThread(course.setup.id);
    expect(thread.map((c) => c.author.isPlatformAdmin)).toEqual([true, false]);
  });

  it("has no thread for a Lesson that does not exist", async () => {
    expect(await getRenderedThread(9999)).toEqual([]);
  });
});
