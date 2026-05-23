import {
  buildTwoVisibleTwoHidden,
  parsePythonParamNames,
  validateTestCaseInputShape,
} from "../../scripts/lib/dsaTestCaseLayout.js";
import { normalizeExpectedOutput } from "../../utils/normalizeTestCaseExpectedOutput.js";

describe("normalizeExpectedOutput", () => {
  it("decodes HTML entities and parses JSON arrays", () => {
    expect(normalizeExpectedOutput('[[&quot;a&quot;]]')).toEqual([["a"]]);
  });
});

describe("buildTwoVisibleTwoHidden", () => {
  it("keeps two unique visible and two unique hidden", () => {
    const cases = [
      { input: { nums: [1, 2] }, expectedOutput: 3, isHidden: false },
      { input: { nums: [0] }, expectedOutput: 0, isHidden: false },
      { input: { nums: [1, 2] }, expectedOutput: 3, isHidden: false },
      { input: { nums: [-1, 1] }, expectedOutput: 0, isHidden: true },
      { input: { nums: [5] }, expectedOutput: 5, isHidden: true },
    ];
    const { testCases, visible, hidden } = buildTwoVisibleTwoHidden(cases);
    expect(visible).toHaveLength(2);
    expect(hidden).toHaveLength(2);
    expect(testCases).toHaveLength(4);
    expect(visible.every((tc) => tc.isHidden === false)).toBe(true);
    expect(hidden.every((tc) => tc.isHidden === true)).toBe(true);
  });
});

describe("parsePythonParamNames", () => {
  it("parses def signature parameters", () => {
    expect(parsePythonParamNames("def two_sum(nums, target):")).toEqual(["nums", "target"]);
  });
});

describe("validateTestCaseInputShape", () => {
  it("requires object keys to match signature", () => {
    const ok = validateTestCaseInputShape(
      { input: { nums: [1], target: 2 } },
      ["nums", "target"]
    );
    expect(ok.ok).toBe(true);
  });
});
