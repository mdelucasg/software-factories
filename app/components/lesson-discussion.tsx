import { useState } from "react";
import { useFetcher } from "react-router";
import { Lock, MessageSquare, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import {
  CommentThreadBody,
  type RenderedComment,
} from "~/components/comment-thread";
import { describeNoteDraft } from "~/modules/lesson-notes";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { cn, formatRelativeTime } from "~/lib/utils";

type SavedNote = { body: string; updatedAt: string } | null;

/**
 * The bottom of a Lesson for a signed-in person: the public discussion and
 * their private Note, side by side as tabs in one card.
 */
export function LessonDiscussion({
  lessonId,
  note,
  comments,
  currentUserId,
  canModerate,
  instructorName,
}: {
  lessonId: number;
  note: SavedNote;
  comments: RenderedComment[];
  currentUserId: number;
  canModerate: boolean;
  instructorName: string;
}) {
  return (
    <Card className="mb-8 py-0">
      <CardContent className="p-6">
        <Tabs defaultValue="discussion" className="gap-6">
          <LessonDiscussionTabs
            commentCount={comments.length}
            hasNote={note !== null}
          />

          <TabsContent value="discussion">
            <CommentThreadBody
              comments={comments}
              currentUserId={currentUserId}
              canModerate={canModerate}
              canPost
              instructorName={instructorName}
            />
          </TabsContent>

          <TabsContent value="notes">
            <NoteEditor key={lessonId} note={note} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function LessonDiscussionTabs({
  commentCount,
  hasNote,
}: {
  commentCount: number;
  hasNote: boolean;
}) {
  return (
    <TabsList className="h-10">
      <TabsTrigger value="discussion" className="px-3">
        <MessageSquare />
        Questions &amp; Discussion
        {commentCount > 0 && (
          <span className="rounded-full bg-background px-1.5 text-xs text-muted-foreground">
            {commentCount}
          </span>
        )}
      </TabsTrigger>
      <TabsTrigger value="notes" className="px-3">
        <NotebookPen />
        Your notes
        {hasNote && (
          <span
            aria-label="has a saved note"
            className="size-1.5 rounded-full bg-primary"
          />
        )}
      </TabsTrigger>
    </TabsList>
  );
}

function NoteEditor({ note }: { note: SavedNote }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [draft, setDraft] = useState(note?.body ?? "");
  const status = describeNoteDraft(note?.body ?? null, draft);
  const isSaving = fetcher.state !== "idle";
  const error = isSaving ? undefined : fetcher.data?.error;

  return (
    <fetcher.Form method="post" className="space-y-3">
      <input type="hidden" name="intent" value="save-note" />
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="size-3.5" />
        Private to you. Find every note you have written on your Saved page.
      </p>
      <Textarea
        name="body"
        aria-label="Your notes"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Jot down what clicked, what didn't, and what to come back to..."
        aria-invalid={status.overLimit || undefined}
        className="min-h-40 resize-y"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="sm"
            disabled={isSaving || !status.canSave}
          >
            {isSaving ? "Saving..." : "Save note"}
          </Button>
          <NoteStatusLine
            error={error}
            isSaving={isSaving}
            unsaved={status.unsaved}
            updatedAt={note?.updatedAt ?? null}
          />
        </div>
        <NoteLength length={status.length} overLimit={status.overLimit} />
      </div>
    </fetcher.Form>
  );
}

function NoteStatusLine({
  error,
  isSaving,
  unsaved,
  updatedAt,
}: {
  error: string | undefined;
  isSaving: boolean;
  unsaved: boolean;
  updatedAt: string | null;
}) {
  return (
    <span className="text-sm text-muted-foreground" aria-live="polite">
      {error ? (
        <span className="text-red-600">{error}</span>
      ) : isSaving ? null : unsaved ? (
        "Unsaved changes"
      ) : updatedAt ? (
        <span suppressHydrationWarning>
          Saved · last edited {formatRelativeTime(updatedAt)}
        </span>
      ) : null}
    </span>
  );
}

function NoteLength({
  length,
  overLimit,
}: {
  length: number;
  overLimit: boolean;
}) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        overLimit ? "text-red-600" : "text-muted-foreground"
      )}
    >
      {length.toLocaleString("en")} / {MAX_NOTE_LENGTH.toLocaleString("en")}
    </span>
  );
}
