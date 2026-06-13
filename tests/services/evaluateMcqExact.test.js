import { evaluateMcqExact } from "../../services/evaluators/evaluateMcqExact.js";

const sampleMcq = {
  options: [
    { id: "A", text: "Stack", distractorReason: "" },
    { id: "B", text: "Queue", distractorReason: "Queues are FIFO." },
    { id: "C", text: "Heap", distractorReason: "" },
    { id: "D", text: "Graph", distractorReason: "" },
  ],
  correctOptionId: "A",
  explanation: "Stacks are LIFO.",
};

describe("evaluateMcqExact", () => {
  test("scores correct selection as 10", async () => {
    const result = await evaluateMcqExact({
      answer: "A",
      question: "Which structure is LIFO?",
      mcqMetadata: sampleMcq,
    });

    expect(result.score).toBe(10);
    expect(result.verdict).toBe("correct");
    expect(result.type).toBe("mcq");
    expect(result.feedback).toContain("Correct");
  });

  test("scores wrong selection as 1 with distractor feedback", async () => {
    const result = await evaluateMcqExact({
      answer: "B",
      question: "Which structure is LIFO?",
      mcqMetadata: sampleMcq,
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe("incorrect");
    expect(result.feedback).toContain("Incorrect");
    expect(result.feedback).toContain("Queues are FIFO.");
  });

  test("scores empty selection as 1", async () => {
    const result = await evaluateMcqExact({
      answer: "",
      question: "Which structure is LIFO?",
      mcqMetadata: sampleMcq,
    });

    expect(result.score).toBe(1);
    expect(result.verdict).toBe("incorrect");
    expect(result.evaluationTrace.mcq.selectedOptionId).toBeNull();
  });
});
