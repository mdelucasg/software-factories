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

export function describeCatalog({
  courseCount,
  categories,
  filters,
}: {
  courseCount: number;
  categories: CatalogCategory[];
  filters: CatalogFilters;
}): {
  categoryLinks: CategoryFilterLink[];
  summary: string;
  isFiltered: boolean;
  clearHref: string;
} {
  return {
    categoryLinks: categoryFilterLinks(categories, filters),
    summary: resultsSummary(courseCount, filters, categories),
    isFiltered: catalogHref(filters) !== CATALOG_PATH,
    clearHref: CATALOG_PATH,
  };
}
