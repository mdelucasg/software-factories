/** A Student on the roster whose Enrollment is Lapsed. */
export function isLapsed(student: { enrollmentId: number | null }): boolean {
  return student.enrollmentId === null;
}
