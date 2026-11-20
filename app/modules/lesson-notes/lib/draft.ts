export type NoteDraftStatus = {
  /** Characters the Student has typed, after trimming, as the server counts them. */
  length: number;
  /** Negative once the draft is over the limit. */
  charactersLeft: number;
  overLimit: boolean;
  /** The draft differs from the saved Note. */
  unsaved: boolean;
  canSave: boolean;
};

export function noteDraftStatus(
  savedBody: string,
  draft: string,
  maxLength: number
): NoteDraftStatus {
  const trimmed = draft.trim();
  const length = trimmed.length;
  const charactersLeft = maxLength - length;
  const overLimit = charactersLeft < 0;
  const unsaved = trimmed !== savedBody;
  return {
    length,
    charactersLeft,
    overLimit,
    unsaved,
    canSave: unsaved && length > 0 && !overLimit,
  };
}
