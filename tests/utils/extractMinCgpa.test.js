import {
  extractMinCgpaFromEligibility,
  minCgpaFromEligibilityText,
} from "../../utils/extractMinCgpa.js";

describe("extractMinCgpaFromEligibility", () => {
  test("returns null for empty / missing", () => {
    expect(extractMinCgpaFromEligibility(null)).toBeNull();
    expect(extractMinCgpaFromEligibility("")).toBeNull();
    expect(extractMinCgpaFromEligibility("All branches")).toBeNull();
    expect(extractMinCgpaFromEligibility("CS/IT students")).toBeNull();
  });

  test("parses common CGPA phrasings", () => {
    expect(extractMinCgpaFromEligibility("7.5 CGPA, CSE/ECE")).toBe(7.5);
    expect(extractMinCgpaFromEligibility("CGPA: 8")).toBe(8);
    expect(extractMinCgpaFromEligibility("Minimum CGPA 7.0")).toBe(7);
    expect(extractMinCgpaFromEligibility("GPA of 7.5 required")).toBe(7.5);
    expect(extractMinCgpaFromEligibility(">= 7.5 CGPA")).toBe(7.5);
    expect(extractMinCgpaFromEligibility("8+ CGPA throughout")).toBe(8);
    expect(extractMinCgpaFromEligibility("7.0/10 CGPA")).toBe(7);
    expect(extractMinCgpaFromEligibility("cgpa cut-off 6.5")).toBe(6.5);
  });

  test("returns minimum when multiple cutoffs appear", () => {
    expect(
      extractMinCgpaFromEligibility("CSE 7.5 CGPA, ECE 8 CGPA")
    ).toBe(7.5);
  });

  test("ignores implausible numbers", () => {
    expect(extractMinCgpaFromEligibility("Batch 2024 CGPA not mentioned")).toBeNull();
    expect(extractMinCgpaFromEligibility("11 CGPA")).toBeNull();
  });

  test("minCgpaFromEligibilityText clears on empty", () => {
    expect(minCgpaFromEligibilityText("")).toBeNull();
    expect(minCgpaFromEligibilityText("7 CGPA")).toBe(7);
  });
});
