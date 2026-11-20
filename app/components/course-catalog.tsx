import { Link } from "react-router";
import { BookOpen } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { CategoryFilterLink } from "~/modules/course-catalog";

export function CatalogHeader() {
  return (
    <header className="mb-8 border-b pb-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-primary">
        Course catalog
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Browse Courses</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
        Find courses to expand your skills. Search by topic, or pick a category
        to narrow the list.
      </p>
    </header>
  );
}

const CHIP_BASE =
  "inline-flex h-8 items-center rounded-full border px-3.5 text-sm font-medium transition-colors";
const CHIP_ACTIVE = "border-primary bg-primary text-primary-foreground";
const CHIP_IDLE =
  "border-input bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground";

export function CategoryChips({ links }: { links: CategoryFilterLink[] }) {
  return (
    <nav aria-label="Filter by category" className="mb-6">
      <ul className="flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              to={link.href}
              aria-current={link.active ? "page" : undefined}
              className={`${CHIP_BASE} ${link.active ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type CatalogStatusProps = {
  summary: string;
  isFiltered: boolean;
  clearHref: string;
};

export function CatalogSummary({
  summary,
  isFiltered,
  clearHref,
}: CatalogStatusProps) {
  return (
    <div className="mb-6 flex items-baseline gap-3 text-sm">
      <p className="font-medium" aria-live="polite">
        {summary}
      </p>
      {isFiltered && (
        <Link
          to={clearHref}
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}

export function CatalogEmptyState({
  isFiltered,
  clearHref,
}: Omit<CatalogStatusProps, "summary">) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-dashed p-8">
      <BookOpen className="size-10 shrink-0 text-muted-foreground/50" />
      <div>
        <h2 className="text-lg font-medium">No courses found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isFiltered
            ? "Try a different search or another category."
            : "No published courses are available yet."}
        </p>
        {isFiltered && (
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to={clearHref}>Clear filters</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
