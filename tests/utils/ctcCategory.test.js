import {
  normalizeCtcComponentToRupees,
  parseCtcStringToRupees,
  sumCtcObjectToRupees,
  categorizeTotalRupees,
  getCompanyPlacementMeta,
  PLACEMENT_CATEGORY,
  OPEN_DREAM_MIN_RUPEES,
} from "../../utils/ctcCategory.js";

describe("ctcCategory", () => {
  describe("normalizeCtcComponentToRupees", () => {
    it("treats large numbers as rupees", () => {
      expect(normalizeCtcComponentToRupees(1_400_000)).toBe(1_400_000);
      expect(normalizeCtcComponentToRupees(900_000)).toBe(900_000);
    });

    it("treats small positive numbers as LPA", () => {
      expect(normalizeCtcComponentToRupees(7)).toBe(700_000);
      expect(normalizeCtcComponentToRupees(10)).toBe(1_000_000);
    });

    it("returns null for invalid", () => {
      expect(normalizeCtcComponentToRupees(null)).toBeNull();
      expect(normalizeCtcComponentToRupees("")).toBeNull();
      expect(normalizeCtcComponentToRupees(NaN)).toBeNull();
    });
  });

  describe("parseCtcStringToRupees", () => {
    it("parses LPA strings and ranges", () => {
      expect(parseCtcStringToRupees("30 to 32 LPA")).toBe(3_100_000);
      expect(parseCtcStringToRupees("7 LPA")).toBe(700_000);
      expect(parseCtcStringToRupees("10-12")).toBe(1_100_000);
    });

    it("parses rupee-style single large number without unit", () => {
      expect(parseCtcStringToRupees("1400000")).toBe(1_400_000);
    });
  });

  describe("sumCtcObjectToRupees", () => {
    it("sums arbitrary keys", () => {
      const total = sumCtcObjectToRupees({
        base: 500_000,
        jb: "2 LPA",
        stocks: 100_000,
      });
      expect(total).toBe(500_000 + 200_000 + 100_000);
    });

    it("handles Map", () => {
      const m = new Map([
        ["a", 5],
        ["b", "3 LPA"],
      ]);
      expect(sumCtcObjectToRupees(m)).toBe(500_000 + 300_000);
    });
  });

  describe("categorizeTotalRupees", () => {
    it("dream when under 10 LPA", () => {
      expect(categorizeTotalRupees(OPEN_DREAM_MIN_RUPEES - 1)).toBe(PLACEMENT_CATEGORY.DREAM);
      expect(categorizeTotalRupees(0)).toBe(PLACEMENT_CATEGORY.DREAM);
    });

    it("open dream at or above 10 LPA", () => {
      expect(categorizeTotalRupees(OPEN_DREAM_MIN_RUPEES)).toBe(PLACEMENT_CATEGORY.OPEN_DREAM);
      expect(categorizeTotalRupees(2_000_000)).toBe(PLACEMENT_CATEGORY.OPEN_DREAM);
    });

    it("respects custom cluster threshold", () => {
      expect(categorizeTotalRupees(900_000, 800_000)).toBe(PLACEMENT_CATEGORY.OPEN_DREAM);
      expect(categorizeTotalRupees(700_000, 800_000)).toBe(PLACEMENT_CATEGORY.DREAM);
    });
  });

  describe("getCompanyPlacementMeta", () => {
    it("uses max role total", () => {
      const meta = getCompanyPlacementMeta({
        roles: [
          { ctc: { total: "6 LPA" } },
          { ctc: { base: 12, jb: 2 } },
        ],
      });
      expect(meta.totalCtcRupees).toBe(1_400_000);
      expect(meta.category).toBe(PLACEMENT_CATEGORY.OPEN_DREAM);
    });

    it("dream when no roles", () => {
      const meta = getCompanyPlacementMeta({ roles: [] });
      expect(meta.category).toBe(PLACEMENT_CATEGORY.DREAM);
    });
  });
});
