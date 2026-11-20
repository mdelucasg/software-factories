import { describe, expect, it } from "vitest";
import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { describeNoteDraft } from "../index";

describe("describeNoteDraft", () => {
  it("offers nothing to save on an empty page with no Note", () => {
    expect(describeNoteDraft(null, "")).toEqual({
      length: 0,
      charactersLeft: MAX_NOTE_LENGTH,
      overLimit: false,
      unsaved: false,
      canSave: false,
    });
  });

  it("does not offer to save whitespace", () => {
    const status = describeNoteDraft(null, "   \n ");
    expect(status.length).toBe(0);
    expect(status.canSave).toBe(false);
  });

  it("offers to save a new draft", () => {
    const status = describeNoteDraft(null, "Generics are boxes");
    expect(status.unsaved).toBe(true);
    expect(status.canSave).toBe(true);
    expect(status.length).toBe(18);
    expect(status.charactersLeft).toBe(MAX_NOTE_LENGTH - 18);
  });

  it("treats a draft that matches the saved Note as saved", () => {
    const status = describeNoteDraft(
      "Generics are boxes",
      "Generics are boxes  "
    );
    expect(status.unsaved).toBe(false);
    expect(status.canSave).toBe(false);
  });

  it("offers to save an edit to the saved Note", () => {
    const status = describeNoteDraft(
      "Generics are boxes",
      "Generics are boxes!"
    );
    expect(status.unsaved).toBe(true);
    expect(status.canSave).toBe(true);
  });

  it("counts a draft exactly at the limit as savable", () => {
    const status = describeNoteDraft(null, "a".repeat(MAX_NOTE_LENGTH));
    expect(status.charactersLeft).toBe(0);
    expect(status.overLimit).toBe(false);
    expect(status.canSave).toBe(true);
  });

  it("refuses a draft over the limit", () => {
    const status = describeNoteDraft(null, "a".repeat(MAX_NOTE_LENGTH + 1));
    expect(status.charactersLeft).toBe(-1);
    expect(status.overLimit).toBe(true);
    expect(status.unsaved).toBe(true);
    expect(status.canSave).toBe(false);
  });

  it("does not offer to save an emptied Note, which the server refuses", () => {
    const status = describeNoteDraft("Old thought", "");
    expect(status.unsaved).toBe(true);
    expect(status.canSave).toBe(false);
  });
});
