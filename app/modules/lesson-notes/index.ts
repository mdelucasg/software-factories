import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { noteDraftStatus, type NoteDraftStatus } from "./lib/draft";

export type { NoteDraftStatus };

/**
 * What the Lesson page's note editor shows for the Student's draft: how much
 * room is left, whether it differs from the saved Note, and whether Save
 * should be offered. Pass `null` when the Student has no Note yet.
 */
export function describeNoteDraft(
  savedBody: string | null,
  draft: string
): NoteDraftStatus {
  return noteDraftStatus(savedBody ?? "", draft, MAX_NOTE_LENGTH);
}
