import { describe, expect, it } from "@jest/globals";
import { normalizeMultilineText } from "../../utils/normalizeMultilineText.js";

describe("normalizeMultilineText", () => {
  it("preserves newlines instead of collapsing them", () => {
    expect(normalizeMultilineText("line1\\nline2")).toBe("line1\nline2");
    expect(normalizeMultilineText("a\nb")).toBe("a\nb");
  });
});
