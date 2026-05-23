import { dedupeTestCases, testCaseDedupeKey } from "../../utils/dedupeTestCases.js";

describe("dedupeTestCases", () => {
  it("returns empty array for non-arrays", () => {
    expect(dedupeTestCases(null)).toEqual([]);
    expect(dedupeTestCases(undefined)).toEqual([]);
  });

  it("removes exact duplicate input/output pairs", () => {
    const a = { input: { x: 1 }, expectedOutput: "2", isHidden: false, weight: 1 };
    const b = { input: { x: 1 }, expectedOutput: "2", isHidden: true, weight: 1 };
    const out = dedupeTestCases([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].isHidden).toBe(false);
  });

  it("keeps distinct cases in order", () => {
    const cases = [
      { input: { n: 1 }, expectedOutput: "a", isHidden: false },
      { input: { n: 2 }, expectedOutput: "b", isHidden: false },
      { input: { n: 1 }, expectedOutput: "a", isHidden: true },
    ];
    expect(dedupeTestCases(cases)).toHaveLength(2);
    expect(dedupeTestCases(cases)[0].input).toEqual({ n: 1 });
    expect(dedupeTestCases(cases)[1].input).toEqual({ n: 2 });
  });

  it("prefers visible when duplicate appears later", () => {
    const hidden = { input: [1], expectedOutput: "1", isHidden: true };
    const visible = { input: [1], expectedOutput: "1", isHidden: false };
    const out = dedupeTestCases([hidden, visible]);
    expect(out).toHaveLength(1);
    expect(out[0].isHidden).toBe(false);
  });

  it("testCaseDedupeKey ignores isHidden and weight", () => {
    const k1 = testCaseDedupeKey({ input: 1, expectedOutput: 2, isHidden: false, weight: 3 });
    const k2 = testCaseDedupeKey({ input: 1, expectedOutput: 2, isHidden: true, weight: 9 });
    expect(k1).toBe(k2);
  });
});
