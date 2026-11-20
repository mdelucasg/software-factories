import { Card, CardContent } from "~/components/ui/card";
import { YouTubePlayer } from "~/components/youtube-player";
import { useAutoplay } from "./use-autoplay";

export function LessonBody({
  lesson,
  contentHtml,
  video,
}: {
  lesson: {
    id: number;
    title: string;
    videoUrl: string | null;
    durationMinutes: number | null;
  };
  contentHtml: string | null;
  video: {
    lastWatchPosition: number;
    watchProgress: number;
    trackingEnabled: boolean;
  };
}) {
  const [autoplay, toggleAutoplay] = useAutoplay();

  return (
    <>
      {lesson.videoUrl && (
        <YouTubePlayer
          videoUrl={lesson.videoUrl}
          lessonId={lesson.id}
          title={lesson.title}
          startPosition={video.lastWatchPosition}
          durationMinutes={lesson.durationMinutes}
          watchProgress={video.watchProgress}
          trackingEnabled={video.trackingEnabled}
          autoplay={autoplay}
          onToggleAutoplay={toggleAutoplay}
        />
      )}

      {contentHtml && (
        <div
          className="prose prose-neutral dark:prose-invert mb-8 max-w-none"
          // oxlint-disable-next-line react/no-danger -- the instructor wrote this Markdown
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      )}

      {!contentHtml && !lesson.videoUrl && <NoContentCard />}
    </>
  );
}

function NoContentCard() {
  return (
    <Card className="mb-8">
      <CardContent className="py-12 text-center text-muted-foreground">
        No content has been added to this lesson yet.
      </CardContent>
    </Card>
  );
}
