import { describe, expect, it } from "vitest";
import { isLapsed } from "./enrollments";

describe("isLapsed", () => {
  it("is false while the Student still has an Active Enrollment", () => {
    expect(isLapsed({ enrollmentId: 12 })).toBe(false);
  });

  it("is true once the Student's Enrollment is Lapsed", () => {
    expect(isLapsed({ enrollmentId: null })).toBe(true);
  });
});
