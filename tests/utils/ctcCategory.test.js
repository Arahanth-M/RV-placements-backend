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
    it("uses only the CTC total key, not Base or other breakdown lines", () => {
      expect(
        sumCtcObjectToRupees({
          CTC: "8 LPA",
          Base: "6 LPA",
          stocks: 100_000,
        })
      ).toBe(800_000);
    });

    it("falls back to Base when CTC is absent", () => {
      expect(
        sumCtcObjectToRupees({
          Base: "7 LPA",
          jb: "2 LPA",
          stocks: 100_000,
        })
      ).toBe(700_000);
    });

    it("ignores other breakdown keys when neither CTC nor Base is present", () => {
      expect(
        sumCtcObjectToRupees({
          jb: "2 LPA",
          stocks: 100_000,
        })
      ).toBe(0);
    });

    it("reads legacy total key", () => {
      expect(sumCtcObjectToRupees({ total: "6 LPA" })).toBe(600_000);
    });

    it("handles Map with CTC key", () => {
      const m = new Map([
        ["CTC", "7 LPA"],
        ["Base", "5 LPA"],
      ]);
      expect(sumCtcObjectToRupees(m)).toBe(700_000);
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
    it("uses max role CTC total across roles", () => {
      const meta = getCompanyPlacementMeta({
        roles: [
          { ctc: { total: "6 LPA" } },
          { ctc: { CTC: "14 LPA", base: 12, jb: 2 } },
        ],
      });
      expect(meta.totalCtcRupees).toBe(1_400_000);
      expect(meta.category).toBe(PLACEMENT_CATEGORY.OPEN_DREAM);
    });

    it("does not inflate tier by summing Base with CTC on the same role", () => {
      const meta = getCompanyPlacementMeta({
        roles: [{ ctc: { CTC: "8 LPA", Base: "6 LPA" } }],
      });
      expect(meta.totalCtcRupees).toBe(800_000);
      expect(meta.category).toBe(PLACEMENT_CATEGORY.DREAM);
    });

    it("dream when no roles", () => {
      const meta = getCompanyPlacementMeta({ roles: [] });
      expect(meta.category).toBe(PLACEMENT_CATEGORY.DREAM);
    });

    it("for RVITM with empty pay, uses max CTC among RVCE roles", () => {
      const meta = getCompanyPlacementMeta(
        {
          roles: [
            { roleName: "SDE", collegeId: "rvitm", ctc: {} },
            { roleName: "SDE", collegeId: "rvce", ctc: { CTC: "8 LPA" } },
            { roleName: "SDE Intern", collegeId: "rvce", ctc: { CTC: "14 LPA" } },
          ],
        },
        { collegeId: "rvitm" }
      );
      expect(meta.totalCtcRupees).toBe(1_400_000);
      expect(meta.category).toBe(PLACEMENT_CATEGORY.OPEN_DREAM);
    });

    it("for RVITM with own CTC, does not fall back to RVCE", () => {
      const meta = getCompanyPlacementMeta(
        {
          roles: [
            { roleName: "SDE", collegeId: "rvitm", ctc: { CTC: "7 LPA" } },
            { roleName: "SDE", collegeId: "rvce", ctc: { CTC: "14 LPA" } },
          ],
        },
        { collegeId: "rvitm" }
      );
      expect(meta.totalCtcRupees).toBe(700_000);
      expect(meta.category).toBe(PLACEMENT_CATEGORY.DREAM);
    });

    it("for RVITM with internship stipend only, does not fall back to RVCE", () => {
      const meta = getCompanyPlacementMeta(
        {
          roles: [
            {
              roleName: "Intern",
              collegeId: "rvitm",
              ctc: {},
              internshipStipend: 50000,
            },
            { roleName: "SDE", collegeId: "rvce", ctc: { CTC: "14 LPA" } },
          ],
        },
        { collegeId: "rvitm" }
      );
      expect(meta.totalCtcRupees).toBe(0);
      expect(meta.category).toBe(PLACEMENT_CATEGORY.DREAM);
    });
  });
});
