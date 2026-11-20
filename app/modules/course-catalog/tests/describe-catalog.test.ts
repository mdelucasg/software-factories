import { describe, it, expect } from "vitest";
import { describeCatalog } from "../index";

const categories = [
  { slug: "design", name: "Design" },
  { slug: "programming", name: "Programming" },
];

function describeWith(
  courseCount: number,
  search: string | null,
  category: string | null
) {
  return describeCatalog({
    courseCount,
    categories,
    filters: { search, category },
  });
}

describe("describeCatalog", () => {
  describe("categoryLinks", () => {
    it("puts All first, then each category in order", () => {
      const { categoryLinks } = describeWith(3, null, null);
      expect(categoryLinks).toEqual([
        { label: "All", href: "/courses", active: true },
        { label: "Design", href: "/courses?category=design", active: false },
        {
          label: "Programming",
          href: "/courses?category=programming",
          active: false,
        },
      ]);
    });

    it("marks the selected category active, not All", () => {
      const { categoryLinks } = describeWith(1, null, "design");
      expect(categoryLinks.map((l) => [l.label, l.active])).toEqual([
        ["All", false],
        ["Design", true],
        ["Programming", false],
      ]);
    });

    it("keeps the search on every link", () => {
      const { categoryLinks } = describeWith(1, "react hooks", "design");
      expect(categoryLinks.map((l) => l.href)).toEqual([
        "/courses?q=react+hooks",
        "/courses?q=react+hooks&category=design",
        "/courses?q=react+hooks&category=programming",
      ]);
    });

    it("treats blank filters as no filter", () => {
      const { categoryLinks } = describeWith(1, "   ", "");
      expect(categoryLinks[0]).toEqual({
        label: "All",
        href: "/courses",
        active: true,
      });
    });
  });

  describe("summary", () => {
    it("counts courses with no filters", () => {
      expect(describeWith(4, null, null).summary).toBe("4 courses");
    });

    it("uses the singular for one course", () => {
      expect(describeWith(1, null, null).summary).toBe("1 course");
    });

    it("says zero courses in the plural", () => {
      expect(describeWith(0, null, null).summary).toBe("0 courses");
    });

    it("names the category, not its slug", () => {
      expect(describeWith(2, null, "design").summary).toBe(
        "2 courses in Design"
      );
    });

    it("falls back to the slug for an unknown category", () => {
      expect(describeWith(0, null, "cooking").summary).toBe(
        "0 courses in cooking"
      );
    });

    it("quotes the trimmed search", () => {
      expect(describeWith(1, "  tail  ", "design").summary).toBe(
        "1 course in Design matching “tail”"
      );
    });

    it("ignores a blank search", () => {
      expect(describeWith(3, "  ", null).summary).toBe("3 courses");
    });
  });

  describe("isFiltered and clearHref", () => {
    it("is not filtered without a search or category", () => {
      expect(describeWith(4, null, null).isFiltered).toBe(false);
      expect(describeWith(4, " ", "").isFiltered).toBe(false);
    });

    it("is filtered by a search alone", () => {
      expect(describeWith(1, "node", null).isFiltered).toBe(true);
    });

    it("is filtered by a category alone", () => {
      expect(describeWith(1, null, "design").isFiltered).toBe(true);
    });

    it("clears back to the unfiltered catalog", () => {
      expect(describeWith(1, "node", "design").clearHref).toBe("/courses");
    });
  });
});
