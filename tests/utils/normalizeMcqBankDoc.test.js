import {
  buildClientMcqPayload,
  normalizeMcqBankDoc,
  parseMcqSelectedOptionId,
} from "../../utils/normalizeMcqBankDoc.js";

describe("normalizeMcqBankDoc", () => {
  test("normalizes flat bank fields (options_A … correctOptionId)", () => {
    const doc = {
      questionId: "Q040",
      options_A: "Stack",
      options_B: "Queue",
      options_C: "Heap",
      options_D: "Graph",
      distractorReason_B: "Queues are FIFO, not LIFO.",
      correctOptionId: "B",
      explanation: "A stack is LIFO.",
      shuffleOptions: true,
      verified: true,
    };

    expect(normalizeMcqBankDoc(doc)).toEqual({
      options: [
        { id: "A", text: "Stack", distractorReason: "" },
        { id: "B", text: "Queue", distractorReason: "Queues are FIFO, not LIFO." },
        { id: "C", text: "Heap", distractorReason: "" },
        { id: "D", text: "Graph", distractorReason: "" },
      ],
      correctOptionId: "B",
      allowMultiple: false,
      shuffleOptions: true,
      explanation: "A stack is LIFO.",
      explanationRequired: false,
      selectionWeight: 1,
      explanationWeight: 0,
    });
  });

  test("returns null when options or correct key are missing", () => {
    expect(normalizeMcqBankDoc({ options_A: "Only one" })).toBeNull();
    expect(normalizeMcqBankDoc({ options_A: "A", options_B: "B" })).toBeNull();
  });

  test("buildClientMcqPayload strips grading secrets", () => {
    const meta = normalizeMcqBankDoc({
      options_A: "One",
      options_B: "Two",
      correctOptionId: "A",
    });
    expect(buildClientMcqPayload(meta)).toEqual({
      options: [
        { id: "A", text: "One" },
        { id: "B", text: "Two" },
      ],
      allowMultiple: false,
      shuffleOptions: true,
    });
    expect(buildClientMcqPayload(meta).correctOptionId).toBeUndefined();
  });

  test("parseMcqSelectedOptionId accepts letter answers", () => {
    expect(parseMcqSelectedOptionId("B")).toBe("B");
    expect(parseMcqSelectedOptionId("option c")).toBe("C");
    expect(parseMcqSelectedOptionId("")).toBe("");
  });
});
