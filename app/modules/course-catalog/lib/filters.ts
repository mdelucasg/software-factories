export type CatalogFilters = {
  search: string | null;
  category: string | null;
};

export type CatalogCategory = { slug: string; name: string };

export type CategoryFilterLink = {
  label: string;
  href: string;
  active: boolean;
};

function clean(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export const CATALOG_PATH = "/courses";

export function catalogHref(filters: CatalogFilters): string {
  const params = new URLSearchParams();
  const search = clean(filters.search);
  const category = clean(filters.category);
  if (search) params.set("q", search);
  if (category) params.set("category", category);
  const query = params.toString();
  return query ? `${CATALOG_PATH}?${query}` : CATALOG_PATH;
}

export function categoryFilterLinks(
  categories: CatalogCategory[],
  filters: CatalogFilters
): CategoryFilterLink[] {
  const active = clean(filters.category);
  const all: CategoryFilterLink = {
    label: "All",
    href: catalogHref({ search: filters.search, category: null }),
    active: active === null,
  };
  return [
    all,
    ...categories.map((category) => ({
      label: category.name,
      href: catalogHref({ search: filters.search, category: category.slug }),
      active: category.slug === active,
    })),
  ];
}

export function resultsSummary(
  count: number,
  filters: CatalogFilters,
  categories: CatalogCategory[]
): string {
  const noun = count === 1 ? "course" : "courses";
  const search = clean(filters.search);
  const slug = clean(filters.category);
  const categoryName = slug
    ? (categories.find((c) => c.slug === slug)?.name ?? slug)
    : null;

  let summary = `${count} ${noun}`;
  if (categoryName) summary += ` in ${categoryName}`;
  if (search) summary += ` matching “${search}”`;
  return summary;
}
