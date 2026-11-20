import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { CourseImage } from "~/components/course-image";
import { UserAvatar } from "~/components/user-avatar";
import { StarRating } from "~/components/star-rating";
import { formatPrice } from "~/lib/utils";

export type CourseCardCourse = {
  slug: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  categoryName: string;
  instructorId: number;
  instructorName: string;
  instructorAvatarUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  progress: number | null;
  completedLessons: number | null;
  lessonCount: number;
  price: number;
  pppPrice: number;
};

type CourseCardProps = {
  course: CourseCardCourse;
  currentUserId: number | null;
};

export function CourseCard({ course, currentUserId }: CourseCardProps) {
  return (
    <Link to={`/courses/${course.slug}`} className="group">
      <Card className="h-full overflow-hidden pt-0 transition-shadow group-hover:shadow-md">
        <div className="aspect-video overflow-hidden">
          <CourseImage
            src={course.coverImageUrl}
            alt={course.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </div>
        <CourseCardTitle course={course} currentUserId={currentUserId} />
        <CardContent>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {course.description}
          </p>
        </CardContent>
        {course.progress !== null && course.progress > 0 && (
          <CourseCardProgress
            progress={course.progress}
            completedLessons={course.completedLessons}
            lessonCount={course.lessonCount}
          />
        )}
        <CourseCardFooter course={course} />
      </Card>
    </Link>
  );
}

function CourseCardTitle({ course, currentUserId }: CourseCardProps) {
  return (
    <CardHeader>
      <div className="mb-1 flex items-center gap-2 text-xs font-medium">
        <span className="text-primary">{course.categoryName}</span>
        {currentUserId !== null && course.instructorId === currentUserId && (
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Your Course
          </span>
        )}
      </div>
      <h3 className="text-lg font-semibold leading-tight group-hover:text-primary">
        {course.title}
      </h3>
      <StarRating
        average={course.ratingAverage}
        count={course.ratingCount}
        className="mt-1"
      />
    </CardHeader>
  );
}

function CourseCardProgress({
  progress,
  completedLessons,
  lessonCount,
}: {
  progress: number;
  completedLessons: number | null;
  lessonCount: number;
}) {
  return (
    <CardContent className="pt-0">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {completedLessons} / {lessonCount} lessons
        </span>
        <span className="font-medium">{progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </CardContent>
  );
}

function CourseCardFooter({ course }: { course: CourseCardCourse }) {
  return (
    <CardFooter className="flex items-center justify-between text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <UserAvatar
          name={course.instructorName}
          avatarUrl={course.instructorAvatarUrl}
          className="size-5"
        />
        {course.instructorName}
      </span>
      <span className="font-semibold text-foreground">
        {course.pppPrice < course.price ? (
          <span className="flex items-center gap-1.5">
            <span className="text-xs line-through text-muted-foreground font-normal">
              {formatPrice(course.price)}
            </span>
            {formatPrice(course.pppPrice)}
          </span>
        ) : (
          formatPrice(course.price)
        )}
      </span>
    </CardFooter>
  );
}

export function CourseCardSkeleton() {
  return (
    <Card className="h-full">
      <Skeleton className="aspect-video rounded-b-none rounded-t-lg" />
      <CardHeader>
        <Skeleton className="mb-1 h-3 w-16" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="mt-1 h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="mb-1 h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
      </CardFooter>
    </Card>
  );
}
