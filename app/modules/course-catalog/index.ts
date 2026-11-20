import {
  CATALOG_PATH,
  catalogHref,
  categoryFilterLinks,
  resultsSummary,
  type CatalogCategory,
  type CatalogFilters,
  type CategoryFilterLink,
} from "./lib/filters";

export type { CatalogCategory, CatalogFilters, CategoryFilterLink };

/**
 * What the Browse Courses page shows around its course grid, worked out from
 * the active filters (`?q=` search and `?category=` slug).
 */
export function describeCatalog({
  courseCount,
  categories,
  filters,
}: {
  courseCount: number;
  categories: CatalogCategory[];
  filters: CatalogFilters;
}): {
  /** One chip per category, plus "All" first. Each link keeps the search. */
  categoryLinks: CategoryFilterLink[];
  /** e.g. `2 courses in Design matching “tail”`. */
  summary: string;
  /** True when a search or category narrows the list. */
  isFiltered: boolean;
  /** Where "Clear filters" goes. */
  clearHref: string;
} {
  return {
    categoryLinks: categoryFilterLinks(categories, filters),
    summary: resultsSummary(courseCount, filters, categories),
    isFiltered: catalogHref(filters) !== CATALOG_PATH,
    clearHref: CATALOG_PATH,
  };
}
